import { TransportError, type HttpRequest } from '../api/http';
import type { EnqueueInput } from '../queue/offlineQueue';
import { json, makePairedEndpoint, scriptedTransport, sequentialIds, type Scripted } from '../test/fakes';
import {
  IntegrityTracker,
  MAX_ATTEMPTS_PER_BATCH,
  planCost,
  runBatch,
  summarize,
  validatePlan,
  type BatchPlan,
  type RunResult,
} from './batchRunner';

const BASE = 'http://10.0.2.2:4000';
const profile = { id: 7, name: 'Ada', email: 'ada@example.com', active: true, roles: ['admin'] };

function plan(overrides: Partial<BatchPlan> = {}): BatchPlan {
  return {
    endpoints: [makePairedEndpoint()],
    requestsPerEndpoint: 5,
    timeoutMs: 4000,
    retry: { enabled: false, maxRetries: 0 },
    payload: '{"source":"pocketchaos-mobile"}',
    ...overrides,
  };
}

async function run(batch: BatchPlan, script: (request: HttpRequest, call: number) => Scripted, options: { offline?: boolean } = {}) {
  const { transport, requests } = scriptedTransport(script);
  const enqueued: EnqueueInput[] = [];
  const streamed: RunResult[] = [];
  const tracker = new IntegrityTracker();
  const results = await runBatch(
    batch,
    {
      baseUrl: BASE,
      platform: 'android',
      projectKey: 'K7Q2XM',
      transport,
      tracker,
      newId: sequentialIds(),
      isOffline: () => options.offline ?? false,
      enqueue: async (item) => {
        enqueued.push(item);
      },
      resilience: { sleep: async () => undefined, random: () => 1 },
    },
    (result) => streamed.push(result),
  );
  return { results, streamed, requests, enqueued, summary: summarize(results), tracker };
}

describe('runBatch requests', () => {
  it('targets the proxy URL with the required client headers and one idempotency key per request', async () => {
    const { requests } = await run(plan({ requestsPerEndpoint: 2 }), () => json(profile));
    expect(requests.map((r) => r.url)).toEqual([`${BASE}/proxy/K7Q2XM/users/profile`, `${BASE}/proxy/K7Q2XM/users/profile`]);
    expect(requests[0]?.headers).toEqual({
      Accept: 'application/json',
      'x-client-platform': 'react-native',
      'x-pocketchaos-platform': 'android',
      'Idempotency-Key': 'id-1',
    });
    expect(requests[1]?.headers['Idempotency-Key']).toBe('id-2');
    expect(requests[0]?.body).toBeUndefined();
    expect(requests[0]?.timeoutMs).toBe(4000);
  });

  it('sends the JSON payload for write methods', async () => {
    const { requests } = await run(plan({ endpoints: [makePairedEndpoint({ method: 'POST', path: '/orders' })], requestsPerEndpoint: 1 }), () => ({ status: 201 }));
    expect(requests[0]).toMatchObject({ method: 'POST', body: '{"source":"pocketchaos-mobile"}' });
    expect(requests[0]?.headers['Content-Type']).toBe('application/json');
  });

  it('"Run All" fires the batch against every endpoint in order', async () => {
    const endpoints = [makePairedEndpoint({ id: 'a', path: '/a' }), makePairedEndpoint({ id: 'b', path: '/b' })];
    const { requests } = await run(plan({ endpoints, requestsPerEndpoint: 2 }), () => json({}));
    expect(requests.map((r) => r.url.split('/').pop())).toEqual(['a', 'a', 'b', 'b']);
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    const { transport, requests } = scriptedTransport((_r, call) => {
      if (call === 2) controller.abort();
      return json({});
    });
    const results = await runBatch(
      plan({ requestsPerEndpoint: 10 }),
      { baseUrl: BASE, platform: 'ios', projectKey: 'K7Q2XM', transport, tracker: new IntegrityTracker(), newId: sequentialIds(), isOffline: () => false, enqueue: async () => undefined, signal: controller.signal },
      () => undefined,
    );
    expect(requests).toHaveLength(2);
    expect(results).toHaveLength(2);
  });
});

describe('runBatch outcomes', () => {
  it('classifies injected faults, rate limiting, timeouts and network errors', async () => {
    const replies: Scripted[] = [
      { status: 503, headers: { 'x-pocketchaos-applied': 'failure:503' }, bodyText: '{"chaosFault":true}' },
      { status: 401, headers: { 'x-pocketchaos-applied': 'failure:401' } },
      { status: 429, headers: { 'x-pocketchaos-applied': 'failure:429' } },
      { status: 429, headers: { 'x-pocketchaos-applied': 'none' } },
      new TransportError('timeout', 'No response within 4000 ms', 4000),
      new TransportError('network', 'offline', 2),
    ];
    const { results, summary } = await run(plan({ requestsPerEndpoint: replies.length }), (_r, call) => replies[call - 1] as Scripted);
    expect(results.map((r) => r.outcome)).toEqual(['http_5xx', 'http_4xx', 'http_4xx', 'rate_limited', 'timeout', 'network_error']);
    expect(summary).toMatchObject({ total: 6, success: 0, faults5xx: 1, faults4xx: 2, rateLimited: 1, timeouts: 1, networkErrors: 1 });
  });

  it('auto-queues network errors and 503s (not timeouts) with the relative path', async () => {
    const replies: Scripted[] = [
      { status: 503 },
      new TransportError('network', 'offline', 1),
      new TransportError('timeout', 'slow', 4000),
      { status: 500 },
    ];
    const { results, enqueued } = await run(plan({ endpoints: [makePairedEndpoint({ method: 'POST', path: '/orders' })], requestsPerEndpoint: 4 }), (_r, call) => replies[call - 1] as Scripted);
    expect(results.map((r) => r.queued)).toEqual(['http_503', 'network_error', null, null]);
    expect(enqueued).toEqual([
      expect.objectContaining({ projectKey: 'K7Q2XM', method: 'POST', path: '/orders', body: '{"source":"pocketchaos-mobile"}', reason: 'http_503' }),
      expect.objectContaining({ reason: 'network_error' }),
    ]);
  });

  it('queues everything without touching the network in simulated offline mode', async () => {
    const { results, requests, enqueued, summary } = await run(plan({ requestsPerEndpoint: 3 }), () => json({}), { offline: true });
    expect(requests).toHaveLength(0);
    expect(results.every((r) => r.outcome === 'queued_offline')).toBe(true);
    expect(enqueued).toHaveLength(3);
    expect(summary.queued).toBe(3);
  });

  it('records retries in the attempt history', async () => {
    const replies: Scripted[] = [{ status: 503 }, { status: 503 }, json(profile)];
    const { results, summary } = await run(plan({ requestsPerEndpoint: 1, retry: { enabled: true, maxRetries: 3 } }), (_r, call) => replies[call - 1] as Scripted);
    expect(results[0]).toMatchObject({ outcome: 'success', status: 200 });
    expect(results[0]?.attempts).toHaveLength(3);
    expect(summary.retries).toBe(2);
  });
});

describe('runBatch payload integrity', () => {
  const clean = (body = profile) => json(body, { 'x-pocketchaos-applied': 'none' });
  const corrupted = (body: unknown, fields: number) => json(body, { 'x-pocketchaos-applied': `corrupt_json:${fields}` });

  it('learns from a clean response and flags corrupted ones as SCHEMA_CORRUPTION_DETECTED', async () => {
    const replies = [
      clean(),
      corrupted({ ...profile, id: '7' }, 1),
      corrupted({ ...profile, email: null }, 1),
      clean(),
      corrupted({ ...profile, roles: {} }, 1),
    ];
    const { results, summary } = await run(plan({ requestsPerEndpoint: 5 }), (_r, call) => replies[call - 1] as Scripted);

    expect(results.map((r) => r.outcome)).toEqual(['success', 'schema_corruption', 'schema_corruption', 'success', 'schema_corruption']);
    expect(results[1]?.integrity).toMatchObject({ verdict: 'SCHEMA_CORRUPTION_DETECTED', basis: 'clean', deviations: [{ path: 'id', kind: 'type_changed' }] });
    expect(summary).toMatchObject({ corruptedCaught: 3, injectedCorruptions: 3, detectedOfInjected: 3, falsePositives: 0 });
  });

  it('with corruption on every request, catches corruption by consensus once the batch completes', async () => {
    const replies = [
      corrupted({ ...profile, id: '7' }, 1),
      corrupted({ ...profile, name: 12345 }, 1),
      corrupted({ ...profile, email: null }, 1),
      corrupted({ ...profile, active: 'true' }, 1),
      corrupted({ id: profile.id, name: profile.name, email: profile.email, roles: profile.roles }, 1),
    ];
    const { results, streamed, summary } = await run(plan({ requestsPerEndpoint: 5 }), (_r, call) => replies[call - 1] as Scripted);

    expect(streamed[0]?.integrity?.verdict).toBe('UNVERIFIED');
    expect(results.every((r) => r.outcome === 'schema_corruption')).toBe(true);
    expect(results.every((r) => r.integrity?.basis === 'consensus')).toBe(true);
    expect(summary).toMatchObject({ detectedOfInjected: 5, injectedCorruptions: 5, falsePositives: 0 });
  });

  it('reports invalid JSON separately and never throws on it', async () => {
    const { results, summary } = await run(plan({ requestsPerEndpoint: 1 }), () => ({ status: 200, headers: { 'content-type': 'application/json' }, bodyText: '{"broken": ' }));
    expect(results[0]?.outcome).toBe('invalid_json');
    expect(summary.corruptedCaught).toBe(1);
  });

  it('keeps baselines across batches', async () => {
    const tracker = new IntegrityTracker();
    const deps = { baseUrl: BASE, platform: 'ios', projectKey: 'K7Q2XM', tracker, newId: sequentialIds(), isOffline: () => false, enqueue: async () => undefined };
    await runBatch(plan({ requestsPerEndpoint: 1 }), { ...deps, transport: scriptedTransport(() => clean()).transport }, () => undefined);
    const second = await runBatch(plan({ requestsPerEndpoint: 1 }), { ...deps, transport: scriptedTransport(() => corrupted({ ...profile, id: null }, 1)).transport }, () => undefined);
    expect(second[0]).toMatchObject({ outcome: 'schema_corruption', integrity: { basis: 'clean' } });
  });
});

describe('plan validation and summary', () => {
  it('enforces the per-batch attempt budget (proxy rate limit) and valid JSON payloads', () => {
    expect(validatePlan(plan())).toBeNull();
    expect(validatePlan(plan({ endpoints: [] }))).toMatch(/Pair a project/);
    expect(validatePlan(plan({ requestsPerEndpoint: 26 }))).toMatch(/1–25/);
    const many = Array.from({ length: 20 }, (_, i) => makePairedEndpoint({ id: String(i) }));
    expect(planCost(plan({ endpoints: many, requestsPerEndpoint: 10, retry: { enabled: true, maxRetries: 3 } })).worstCaseAttempts).toBe(800);
    expect(validatePlan(plan({ endpoints: many, requestsPerEndpoint: 10, retry: { enabled: true, maxRetries: 3 } }))).toMatch(String(MAX_ATTEMPTS_PER_BATCH));
    expect(validatePlan(plan({ endpoints: [makePairedEndpoint({ method: 'POST' })], payload: '{oops' }))).toMatch(/valid JSON/);
  });

  it('computes success % and average latency over responses only', () => {
    const base = { attempts: [], injectedCorruption: 0, queued: null, integrity: null } as unknown as RunResult;
    const summary = summarize([
      { ...base, outcome: 'success', status: 200, latencyMs: 100 },
      { ...base, outcome: 'success', status: 200, latencyMs: 300 },
      { ...base, outcome: 'http_5xx', status: 503, latencyMs: 200 },
      { ...base, outcome: 'timeout', status: null, latencyMs: null },
    ]);
    expect(summary).toMatchObject({ total: 4, success: 2, successPct: 50, avgLatencyMs: 200 });
  });

  it('handles an empty run', () => {
    expect(summarize([])).toMatchObject({ total: 0, successPct: 0, avgLatencyMs: null });
  });
});
