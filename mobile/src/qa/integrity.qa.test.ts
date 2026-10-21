/**
 * QA: Schema Integrity Detector — 100% corrupted batches and malformed JSON from the proxy.
 */
import type { HttpRequest } from '../api/http';
import { createPocketChaosApi } from '../api/pocketChaosApi';
import { formatBody } from '../components/InspectorModal';
import { addSample, assessIntegrity, emptyStats, expectationFromConsensus, parseBody } from '../integrity/schemaIntegrity';
import { IntegrityTracker, runBatch, summarize, type BatchPlan, type RunResult } from '../runner/batchRunner';
import { json, makePairedEndpoint, scriptedTransport, sequentialIds, type Scripted } from '../test/fakes';

const profile = { id: 7, name: 'Ada', email: 'ada@example.com', active: true };
const corrupted = (body: unknown, fields = 1): Scripted => json(body, { 'x-pocketchaos-applied': `corrupt_json:${fields}` });

async function runOnce(replies: Scripted[], tracker = new IntegrityTracker()) {
  const { transport } = scriptedTransport((_request: HttpRequest, call) => replies[call - 1] ?? replies[replies.length - 1]!);
  const plan: BatchPlan = { endpoints: [makePairedEndpoint()], requestsPerEndpoint: replies.length, timeoutMs: 4000, retry: { enabled: false, maxRetries: 0 }, payload: '{}' };
  const results = await runBatch(
    plan,
    { baseUrl: 'http://192.168.1.20:4000', platform: 'ios', projectKey: 'K7Q2XM', transport, tracker, newId: sequentialIds(), isOffline: () => false, enqueue: async () => undefined },
    () => undefined,
  );
  return { results, summary: summarize(results) };
}

const verdicts = (results: RunResult[]) => results.map((r) => r.integrity?.verdict);

describe('100% corrupted JSON payloads (no clean baseline)', () => {
  it('catches every corrupted body by consensus when corruption hits different fields', async () => {
    const { results, summary } = await runOnce([
      corrupted({ ...profile, id: '7' }),
      corrupted({ ...profile, name: null }),
      corrupted({ id: 7, name: 'Ada', active: true }), // email removed
      corrupted({ ...profile, active: 'true' }),
      corrupted({ ...profile, id: null }),
    ]);
    expect(verdicts(results)).toEqual(Array(5).fill('SCHEMA_CORRUPTION_DETECTED'));
    expect(results.map((r) => r.integrity?.deviations.map((d) => `${d.path}:${d.kind}`))).toEqual([
      ['id:type_changed'],
      ['name:unexpected_null'],
      ['email:missing_field'],
      ['active:type_changed'],
      ['id:unexpected_null'],
    ]);
    expect(summary).toMatchObject({ injectedCorruptions: 5, detectedOfInjected: 5, falsePositives: 0, successPct: 0 });
  });

  it('never calls a corrupted body INTACT when the batch cannot agree on a field: it is UNVERIFIED instead', async () => {
    // "active" is corrupted in 3 of 5 bodies, into 2 different wrong types: no strict majority for it.
    const { results, summary } = await runOnce([
      corrupted({ ...profile, active: 'true' }),
      corrupted({ ...profile, active: 1 }),
      corrupted({ ...profile, id: '7' }),
      corrupted({ ...profile, name: null }),
      corrupted({ ...profile, active: 'true' }),
    ]);
    expect(verdicts(results)).toEqual(['UNVERIFIED', 'UNVERIFIED', 'SCHEMA_CORRUPTION_DETECTED', 'SCHEMA_CORRUPTION_DETECTED', 'UNVERIFIED']);
    expect(results[0]?.integrity?.unverifiedPaths).toEqual(['active']);
    expect(summary).toMatchObject({ detectedOfInjected: 2, unverified: 3, falsePositives: 0 });
  });

  it('treats a field the batch cannot agree is present as unverifiable when it is missing', () => {
    const stats = emptyStats();
    const bodies = [{ ...profile }, { ...profile }, { id: 7, name: 'Ada', active: true }, { id: 7, name: 'Ada', active: true }];
    for (const body of bodies) addSample(stats, body);
    const expectation = expectationFromConsensus(stats);
    const report = assessIntegrity({ kind: 'json', value: bodies[2] }, expectation);
    expect(report).toMatchObject({ verdict: 'UNVERIFIED', unverifiedPaths: ['email'] });
  });

  it('flags every body once a clean baseline exists from an earlier batch', async () => {
    const tracker = new IntegrityTracker();
    await runOnce([json(profile, { 'x-pocketchaos-applied': 'none' })], tracker);
    const { results, summary } = await runOnce(
      [corrupted({ ...profile, active: 'true' }), corrupted({ ...profile, active: 1 }), corrupted({ ...profile, active: 'true' })],
      tracker,
    );
    expect(results.every((r) => r.outcome === 'schema_corruption' && r.integrity?.basis === 'clean')).toBe(true);
    expect(summary).toMatchObject({ detectedOfInjected: 3, injectedCorruptions: 3 });
  });

  it('handles a batch where every body is broken JSON: no crash, no baseline learned, 0% success', async () => {
    const tracker = new IntegrityTracker();
    const broken: Scripted = { status: 200, headers: { 'content-type': 'application/json', 'x-pocketchaos-applied': 'none' }, bodyText: '{"id": 7, "name": "Ad' };
    const { results, summary } = await runOnce(Array(5).fill(broken), tracker);
    expect(results.every((r) => r.outcome === 'invalid_json' && r.integrity?.verdict === 'INVALID_JSON')).toBe(true);
    expect(summary).toMatchObject({ success: 0, corruptedCaught: 5 });
    expect(tracker.expectation('e1', [])).toBeNull();
  });
});

describe('malformed JSON from the proxy', () => {
  const declaredJson = (bodyText: string): Scripted => ({ status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'x-pocketchaos-applied': 'none' }, bodyText });

  it.each([
    ['truncated object', '{"id": 7, "name": "Ada"'],
    ['empty body', ''],
    ['HTML error page', '<html><body>502 Bad Gateway</body></html>'],
    ['NaN literal', '{"id": NaN}'],
    ['two concatenated documents', '{"id":7}{"id":8}'],
    ['trailing comma', '{"id":7,}'],
    ['single quotes', "{'id': 7}"],
  ])('%s → INVALID_JSON, never a crash', async (_name, bodyText) => {
    const { results } = await runOnce([declaredJson(bodyText)]);
    expect(results[0]).toMatchObject({ outcome: 'invalid_json', status: 200, integrity: { verdict: 'INVALID_JSON' } });
  });

  it('keeps an injected 5xx with a garbage body as a 5xx fault (integrity is not judged on errors)', async () => {
    const { results } = await runOnce([{ status: 503, headers: { 'content-type': 'application/json' }, bodyText: '{"chaosFault":tru' }]);
    expect(results[0]).toMatchObject({ outcome: 'http_5xx', integrity: null });
  });

  it('shows deeply nested JSON verbatim in the inspector instead of failing to pretty-print it', () => {
    const depth = 9_000;
    const bodyText = '['.repeat(depth) + ']'.repeat(depth);
    expect(parseBody(bodyText, 'application/json').kind).toBe('json');
    const result = { bodyText, responseHeaders: { 'content-type': 'application/json' } } as Pick<RunResult, 'bodyText' | 'responseHeaders'> as RunResult;
    expect(() => formatBody(result)).not.toThrow();
    expect(formatBody(result)).toBe(bodyText);
  });

  it.each([
    ['truncated JSON', '{"success": true, "data": {'],
    ['bare JSON array', '[]'],
    ['JSON null', 'null'],
    ['success envelope without endpoints', JSON.stringify({ success: true, data: { projectKey: 'K7Q2XM', proxyBasePath: '/proxy/K7Q2XM' } })],
    ['error envelope without a message', JSON.stringify({ success: false, error: { code: 'X' } })],
    ['proxy path that climbs out of /proxy', JSON.stringify({ success: true, data: { projectKey: 'K7Q2XM', proxyBasePath: '/proxy/K7Q2XM', endpoints: [makePairedEndpoint({ proxyPath: '/proxy/K7Q2XM/../../api/auth/login' })] } })],
  ])('pairing rejects a %s as UNEXPECTED_RESPONSE', async (_name, bodyText) => {
    const { transport } = scriptedTransport(() => ({ status: 200, headers: { 'content-type': 'application/json' }, bodyText }));
    await expect(createPocketChaosApi('http://192.168.1.20:4000', transport).pair('K7Q2XM')).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
  });
});
