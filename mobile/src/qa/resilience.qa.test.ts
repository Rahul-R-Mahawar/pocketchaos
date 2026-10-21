/**
 * QA: Client Resilience Wrapper — timeout boundaries, unreachable servers, happy-path batches.
 *
 * Axios only enforces `timeout` inside its built-in XHR/HTTP adapters, so a custom fake adapter never times
 * out. `deadlineTransport` stands in for the XHR adapter instead: it answers after a scripted latency, or
 * fails with a timeout once the request's own `timeoutMs` elapses first, on (fake) timers.
 */
import { AxiosError } from 'axios';
import { createTransport, TransportError, type HttpRequest, type HttpResponse, type Transport } from '../api/http';
import { createPocketChaosApi } from '../api/pocketChaosApi';
import { defaultSleep, executeResilient, type ResilientOutcome } from '../resilience/resilientRequest';
import { IntegrityTracker, runBatch, summarize, type BatchPlan, type RunResult } from '../runner/batchRunner';
import { fakeAdapter, json, makePairedEndpoint, scriptedTransport, sequentialIds } from '../test/fakes';

const BASE = 'http://192.168.1.20:4000';
const request: HttpRequest = { url: `${BASE}/proxy/K7Q2XM/users/profile`, method: 'GET', headers: {}, timeoutMs: 4000 };
const realClock = { sleep: defaultSleep, random: () => 1 };

function deadlineTransport(latencyFor: (request: HttpRequest, call: number) => number, reply: Partial<HttpResponse> = {}) {
  const requests: HttpRequest[] = [];
  const transport: Transport = (req) =>
    new Promise((resolve, reject) => {
      requests.push(req);
      const latency = latencyFor(req, requests.length);
      if (latency >= req.timeoutMs) {
        setTimeout(() => reject(new TransportError('timeout', `No response within ${req.timeoutMs} ms`, req.timeoutMs)), req.timeoutMs);
      } else {
        setTimeout(() => resolve({ status: 200, headers: {}, bodyText: '', latencyMs: latency, ...reply }), latency);
      }
    });
  return { transport, requests };
}

function track(promise: Promise<ResilientOutcome>) {
  const state: { outcome?: ResilientOutcome } = {};
  void promise.then((outcome) => (state.outcome = outcome));
  return state;
}

function batchDeps(transport: Transport, enqueue = jest.fn(async () => undefined)) {
  return {
    baseUrl: BASE,
    platform: 'ios',
    projectKey: 'K7Q2XM',
    transport,
    tracker: new IntegrityTracker(),
    newId: sequentialIds(),
    isOffline: () => false,
    enqueue,
    resilience: realClock,
  };
}

const plan = (overrides: Partial<BatchPlan> = {}): BatchPlan => ({
  endpoints: [makePairedEndpoint()],
  requestsPerEndpoint: 1,
  timeoutMs: 2000,
  retry: { enabled: false, maxRetries: 0 },
  payload: '{}',
  ...overrides,
});

describe('timeout boundaries', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('accepts a response 1 ms inside the deadline on the first attempt, without retrying', async () => {
    const { transport, requests } = deadlineTransport(() => 3999);
    const state = track(executeResilient(request, transport, { enabled: true, maxRetries: 3 }, realClock));
    await jest.advanceTimersByTimeAsync(3999);
    expect(state.outcome).toMatchObject({ kind: 'response', attempts: [{ attempt: 1, status: 200, latencyMs: 3999 }] });
    expect(requests).toHaveLength(1);
  });

  it('times out exactly at the deadline, gives every retry the full timeout, and stops after maxRetries', async () => {
    const { transport, requests } = deadlineTransport(() => 4000);
    const state = track(executeResilient(request, transport, { enabled: true, maxRetries: 2 }, realClock));

    // 3 × 4000 ms attempts + 300 ms + 600 ms backoff (jitter pinned to 100%) = 12 900 ms worst case.
    await jest.advanceTimersByTimeAsync(12_899);
    expect(state.outcome).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);

    expect(state.outcome).toEqual({
      kind: 'timeout',
      message: 'No response within 4000 ms',
      attempts: [
        { attempt: 1, status: null, error: 'timeout', latencyMs: 4000, waitedMs: 0 },
        { attempt: 2, status: null, error: 'timeout', latencyMs: 4000, waitedMs: 300 },
        { attempt: 3, status: null, error: 'timeout', latencyMs: 4000, waitedMs: 600 },
      ],
    });
    expect(requests.map((r) => r.timeoutMs)).toEqual([4000, 4000, 4000]);
  });

  it('recovers when only the first attempt is too slow', async () => {
    const { transport } = deadlineTransport((_r, call) => (call === 1 ? 10_000 : 120));
    const state = track(executeResilient(request, transport, { enabled: true, maxRetries: 3 }, realClock));
    await jest.advanceTimersByTimeAsync(4000 + 300 + 120);
    expect(state.outcome).toMatchObject({ kind: 'response', attempts: [{ error: 'timeout' }, { status: 200, waitedMs: 300 }] });
  });

  it('in a batch, a delay 1 ms under the timeout succeeds and one at the timeout is a Timeout that is never queued', async () => {
    const fast = makePairedEndpoint({ id: 'fast', path: '/fast' });
    const slow = makePairedEndpoint({ id: 'slow', path: '/slow' });
    const { transport } = deadlineTransport((req) => (req.url.endsWith('/fast') ? 1999 : 2000));
    const enqueue = jest.fn(async () => undefined);

    const running = runBatch(plan({ endpoints: [fast, slow] }), batchDeps(transport, enqueue), () => undefined);
    await jest.advanceTimersByTimeAsync(1999 + 2000);
    const results = await running;

    expect(results.map((r) => [r.path, r.outcome, r.status, r.errorMessage])).toEqual([
      ['/fast', 'success', 200, null],
      ['/slow', 'timeout', null, 'No response within 2000 ms'],
    ]);
    expect(results[1]?.queued).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
    expect(summarize(results)).toMatchObject({ timeouts: 1, queued: 0, avgLatencyMs: 1999 });
  });
});

describe('unreachable server URL', () => {
  it('maps a refused/unroutable connection (and any unknown adapter failure) to a network TransportError', async () => {
    const refused = createTransport({ adapter: fakeAdapter(() => new AxiosError('Network Error', AxiosError.ERR_NETWORK)).adapter });
    await expect(refused(request)).rejects.toMatchObject({ name: 'TransportError', kind: 'network' });

    const broken = createTransport({
      adapter: async () => {
        throw new TypeError('Network request failed');
      },
    });
    await expect(broken(request)).rejects.toMatchObject({ kind: 'network' });
  });

  it('pairing names the URL it could not reach', async () => {
    const { transport } = scriptedTransport(() => new TransportError('network', 'Network request failed', 3));
    await expect(createPocketChaosApi('http://10.0.0.99:4000', transport).pair('K7Q2XM')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: expect.stringContaining('Cannot reach http://10.0.0.99:4000'),
    });
  });

  it('a batch retries, then reports Network error and auto-queues every request for replay', async () => {
    const { transport, requests } = scriptedTransport(() => new TransportError('network', 'Network request failed (server unreachable or offline)', 2));
    const enqueue = jest.fn(async () => undefined);
    const results = await runBatch(
      plan({ requestsPerEndpoint: 3, retry: { enabled: true, maxRetries: 2 } }),
      { ...batchDeps(transport, enqueue), resilience: { sleep: async () => undefined, random: () => 1 } },
      () => undefined,
    );

    expect(requests).toHaveLength(9);
    expect(results.every((r) => r.outcome === 'network_error' && r.queued === 'network_error' && r.attempts.length === 3)).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(3);
    expect(summarize(results)).toMatchObject({ success: 0, networkErrors: 3, queued: 3, avgLatencyMs: null });
  });
});

describe('happy path batch execution', () => {
  it('runs every endpoint in order with one idempotency key per request and learns a clean baseline', async () => {
    const endpoints = [makePairedEndpoint({ id: 'e1', path: '/users/profile' }), makePairedEndpoint({ id: 'e2', name: 'Orders', method: 'POST', path: '/orders' })];
    const { transport, requests } = scriptedTransport((req) =>
      req.method === 'POST' ? json({ orderId: 1, ok: true }, { 'x-pocketchaos-applied': 'none' }) : json({ id: 7, name: 'Ada' }, { 'x-pocketchaos-applied': 'none' }),
    );
    const streamed: RunResult[] = [];
    const results = await runBatch(plan({ endpoints, requestsPerEndpoint: 5, payload: '{"qty":1}' }), batchDeps(transport), (r) => streamed.push(r));

    expect(requests.map((r) => `${r.method} ${r.url.replace(BASE, '')}`)).toEqual([
      ...Array(5).fill('GET /proxy/K7Q2XM/users/profile'),
      ...Array(5).fill('POST /proxy/K7Q2XM/orders'),
    ]);
    expect(new Set(requests.map((r) => r.headers['Idempotency-Key'])).size).toBe(10);
    expect(requests.filter((r) => r.method === 'POST').every((r) => r.body === '{"qty":1}')).toBe(true);
    expect(streamed).toHaveLength(10);
    expect(results.every((r) => r.outcome === 'success' && r.integrity?.verdict === 'INTACT' && r.integrity.basis === 'clean')).toBe(true);
    expect(summarize(results)).toMatchObject({ total: 10, successPct: 100, avgLatencyMs: 10, queued: 0, corruptedCaught: 0 });
  });
});
