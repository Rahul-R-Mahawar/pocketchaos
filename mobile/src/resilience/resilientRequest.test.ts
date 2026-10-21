import { TransportError, type HttpRequest } from '../api/http';
import { json, scriptedTransport, type Scripted } from '../test/fakes';
import { backoffDelayMs, executeResilient, MAX_BACKOFF_MS, retryAfterMs } from './resilientRequest';

const request: HttpRequest = { url: 'http://x/proxy/K7Q2XM/a', method: 'GET', headers: {}, timeoutMs: 4000 };

function run(replies: Scripted[], policy = { enabled: true, maxRetries: 3 }, random = () => 1) {
  const { transport, requests } = scriptedTransport((_req, call) => replies[Math.min(call, replies.length) - 1] ?? json({}));
  const waits: number[] = [];
  const outcome = executeResilient(request, transport, policy, {
    sleep: async (ms) => {
      waits.push(ms);
    },
    random,
  });
  return { outcome, requests, waits };
}

const status = (code: number, headers: Record<string, string> = {}): Scripted => ({ status: code, headers });

describe('executeResilient', () => {
  it('returns a success immediately, with one attempt', async () => {
    const { outcome, requests } = run([json({ ok: true })]);
    await expect(outcome).resolves.toMatchObject({ kind: 'response', response: { status: 200 } });
    expect(requests).toHaveLength(1);
  });

  it('retries 5xx with exponential backoff, then succeeds', async () => {
    const { outcome, requests, waits } = run([status(503), status(500), json({ ok: true })]);
    const result = await outcome;
    expect(result).toMatchObject({ kind: 'response', response: { status: 200 } });
    expect(requests).toHaveLength(3);
    expect(waits).toEqual([300, 600]);
    expect(result.attempts.map((a) => [a.attempt, a.status, a.waitedMs])).toEqual([
      [1, 503, 0],
      [2, 500, 300],
      [3, 200, 600],
    ]);
  });

  it('gives up after maxRetries and returns the last response', async () => {
    const { outcome, requests } = run([status(503)], { enabled: true, maxRetries: 2 });
    await expect(outcome).resolves.toMatchObject({ kind: 'response', response: { status: 503 } });
    expect(requests).toHaveLength(3);
  });

  it('never retries when the toggle is off, whatever maxRetries says', async () => {
    const { outcome, requests } = run([status(503)], { enabled: false, maxRetries: 3 });
    await outcome;
    expect(requests).toHaveLength(1);
  });

  it.each([400, 401, 403, 404, 422])('does not retry a client error %i', async (code) => {
    const { outcome, requests } = run([status(code)]);
    await expect(outcome).resolves.toMatchObject({ response: { status: code } });
    expect(requests).toHaveLength(1);
  });

  it('retries 429', async () => {
    const { requests, outcome } = run([status(429), json({})]);
    await outcome;
    expect(requests).toHaveLength(2);
  });

  it('honours Retry-After (seconds) instead of the computed backoff', async () => {
    const { waits, outcome } = run([status(503, { 'retry-after': '2' }), json({})]);
    await outcome;
    expect(waits).toEqual([2000]);
  });

  it('retries timeouts and network errors, then reports the last failure', async () => {
    const timeout = new TransportError('timeout', 'No response within 4000 ms', 4000);
    const network = new TransportError('network', 'offline', 3);
    const { outcome, requests } = run([timeout, network, timeout], { enabled: true, maxRetries: 2 });
    const result = await outcome;
    expect(result).toMatchObject({ kind: 'timeout', message: 'No response within 4000 ms' });
    expect(result.attempts.map((a) => a.error)).toEqual(['timeout', 'network', 'timeout']);
    expect(requests).toHaveLength(3);
  });

  it('clamps maxRetries to 3', async () => {
    const { requests, outcome } = run([status(500)], { enabled: true, maxRetries: 9 });
    await outcome;
    expect(requests).toHaveLength(4);
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { transport, requests } = scriptedTransport(() => json({}));
    const result = await executeResilient({ ...request, signal: controller.signal }, transport, { enabled: true, maxRetries: 3 });
    expect(result.kind).toBe('cancelled');
    expect(requests).toHaveLength(0);
  });

  it('rethrows programming errors instead of hiding them as retries', async () => {
    const transport = async () => {
      throw new TypeError('bug');
    };
    await expect(executeResilient(request, transport, { enabled: true, maxRetries: 3 })).rejects.toThrow('bug');
  });
});

describe('backoff helpers', () => {
  it('doubles from 300 ms with jitter in [50%, 100%] and caps', () => {
    expect([1, 2, 3].map((n) => backoffDelayMs(n, () => 1))).toEqual([300, 600, 1200]);
    expect([1, 2, 3].map((n) => backoffDelayMs(n, () => 0))).toEqual([150, 300, 600]);
    expect(backoffDelayMs(10, () => 1)).toBe(MAX_BACKOFF_MS);
  });

  it('parses Retry-After seconds only, capped', () => {
    expect(retryAfterMs({ 'retry-after': '1' })).toBe(1000);
    expect(retryAfterMs({ 'retry-after': '120' })).toBe(MAX_BACKOFF_MS);
    expect(retryAfterMs({ 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' })).toBeNull();
    expect(retryAfterMs({})).toBeNull();
  });
});
