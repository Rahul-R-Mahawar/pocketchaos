import dns from 'node:dns';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { Types } from 'mongoose';
import request from 'supertest';
import { ChaosEndpoint, type ChaosConfig } from '../../src/models/ChaosEndpoint';
import { RequestLog } from '../../src/models/RequestLog';
import * as chaosService from '../../src/services/chaos.service';
import * as upstream from '../../src/services/upstream.service';
import {
  app,
  createEndpoint,
  expectErrorEnvelope,
  registerUser,
  sampleMock,
  setChaos,
  type RegisteredUser,
} from '../helpers/api';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

let alice: RegisteredUser;
beforeEach(async () => {
  alice = await registerUser();
});

const proxyUrl = (path: string, key = alice.projectKey) => `/proxy/${key}${path}`;
const appliedChaos = (res: request.Response) => res.headers['x-pocketchaos-applied'];

/** Reads the body as text, so deliberately broken JSON is not parsed (and rejected) client-side. */
const rawText = ((res: NodeJS.ReadableStream, callback: (err: Error | null, body: string) => void) => {
  let text = '';
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => (text += chunk));
  res.on('end', () => callback(null, text));
}) as unknown as Parameters<request.Test['parse']>[0];

/** Records requested delays and resolves immediately, so 10-second boundaries run instantly. */
const spySleep = () => jest.spyOn(chaosService, 'sleep').mockResolvedValue(undefined);

/** Writes straight to MongoDB, bypassing Zod and Mongoose validation, to simulate tampered or legacy data. */
async function insertRawEndpoint(fields: { path: string; targetUrl?: string | null; chaosConfig?: Partial<ChaosConfig> }) {
  const now = new Date();
  await ChaosEndpoint.collection.insertOne({
    userId: new Types.ObjectId(alice.user.id),
    projectKey: alice.projectKey,
    name: 'raw',
    method: 'GET',
    path: fields.path,
    targetUrl: fields.targetUrl ?? null,
    mockResponseJson: sampleMock,
    chaosConfig: { enabled: false, delayMs: 0, failureRate: 0, overrideStatusCode: null, corruptJson: false, ...fields.chaosConfig },
    createdAt: now,
    updatedAt: now,
  });
}

function mockUpstream(response: Partial<upstream.UpstreamResponse> & { body?: Buffer }) {
  return jest.spyOn(upstream, 'forwardRequest').mockResolvedValue({
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from('{}'),
    ...response,
  });
}

describe('mock mode', () => {
  it('returns the raw mock body (not the API envelope) when chaos is disabled', async () => {
    await createEndpoint(alice.token);
    const res = await request(app).get(proxyUrl('/users/profile')).expect(200);
    expect(res.body).toEqual(sampleMock);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(appliedChaos(res)).toBe('none');
  });

  it('matches lowercase keys, trailing slashes and ignores query strings', async () => {
    await createEndpoint(alice.token);
    const res = await request(app).get(proxyUrl('/users/profile/?page=2', alice.projectKey.toLowerCase())).expect(200);
    expect(res.body).toEqual(sampleMock);
  });

  it('serves a root "/" endpoint at /proxy/KEY and /proxy/KEY/', async () => {
    await createEndpoint(alice.token, { path: '/', mockResponseJson: { root: true } });
    await request(app).get(proxyUrl('')).expect(200, { root: true });
    await request(app).get(proxyUrl('/')).expect(200, { root: true });
  });

  it('serves array mock bodies', async () => {
    await createEndpoint(alice.token, { path: '/list', mockResponseJson: [1, 2, 3] });
    await request(app).get(proxyUrl('/list')).expect(200, [1, 2, 3]);
  });

  it('applies no chaos while disabled, even when chaos values are set', async () => {
    const sleep = spySleep();
    await createEndpoint(alice.token, {
      chaosConfig: { enabled: false, delayMs: 5_000, failureRate: 100, overrideStatusCode: 503, corruptJson: true },
    });
    const res = await request(app).get(proxyUrl('/users/profile')).expect(200);
    expect(res.body).toEqual(sampleMock);
    expect(sleep).not.toHaveBeenCalled();
    expect(appliedChaos(res)).toBe('none');
  });

  it('records a RequestLog row for each proxied call', async () => {
    const endpoint = await createEndpoint(alice.token);
    await request(app).get(proxyUrl('/users/profile')).set('User-Agent', 'okhttp/4.12.0').expect(200);

    const logs = await RequestLog.find().lean();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      projectKey: alice.projectKey,
      method: 'GET',
      path: '/users/profile',
      statusReturned: 200,
      chaosApplied: 'none',
      clientPlatform: 'android',
    });
    expect(logs[0]?.endpointId?.toString()).toBe(endpoint.id);
    expect(logs[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it.each([
    ['okhttp/4.12.0', undefined, 'android'],
    ['Dalvik/2.1.0 (Linux; U; Android 14)', undefined, 'android'],
    ['MyApp/1 CFNetwork/1490.0.4 Darwin/23.2.0', undefined, 'ios'],
    ['Mozilla/5.0 (Macintosh)', undefined, 'web'],
    ['curl/8.4.0', undefined, 'unknown'],
    ['okhttp/4.12.0', 'ios', 'ios'],
    ['curl/8.4.0', 'smart-fridge', 'unknown'],
  ])('detects platform from UA %p and header %p as %p', async (userAgent, platformHeader, expected) => {
    await createEndpoint(alice.token);
    const req = request(app).get(proxyUrl('/users/profile')).set('User-Agent', userAgent);
    if (platformHeader) req.set('X-PocketChaos-Platform', platformHeader);
    await req.expect(200);
    expect((await RequestLog.findOne().lean())?.clientPlatform).toBe(expected);
  });
});

describe('delayMs boundaries', () => {
  it('delayMs = 0 never sleeps and adds no delay tag', async () => {
    const sleep = spySleep();
    await createEndpoint(alice.token, { chaosConfig: { enabled: true, delayMs: 0 } });
    const res = await request(app).get(proxyUrl('/users/profile')).expect(200);
    expect(sleep).not.toHaveBeenCalled();
    expect(appliedChaos(res)).toBe('none');
  });

  // Timeout well under 10 s: if the spy failed to intercept, the test would fail instead of passing slowly.
  it('delayMs = 10000 sleeps exactly 10000 ms', async () => {
    const sleep = spySleep();
    await createEndpoint(alice.token, { chaosConfig: { enabled: true, delayMs: 10_000 } });
    const res = await request(app).get(proxyUrl('/users/profile')).expect(200);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(10_000);
    expect(appliedChaos(res)).toBe('delay:10000ms');
  }, 5_000);

  it('caps a stored delay above the limit (validation bypassed) at 10000 ms', async () => {
    const sleep = spySleep();
    await insertRawEndpoint({ path: '/tampered', chaosConfig: { enabled: true, delayMs: 999_999 } });
    const res = await request(app).get(proxyUrl('/tampered')).expect(200);
    expect(sleep).toHaveBeenCalledWith(10_000);
    expect(appliedChaos(res)).toBe('delay:10000ms');
  }, 5_000);

  it('really holds the response for the configured latency', async () => {
    await createEndpoint(alice.token, { chaosConfig: { enabled: true, delayMs: 250 } });
    const started = Date.now();
    await request(app).get(proxyUrl('/users/profile')).expect(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(240);
    expect((await RequestLog.findOne().lean())?.latencyMs).toBeGreaterThanOrEqual(240);
  });
});

describe('failureRate boundaries', () => {
  it('failureRate = 100 fails every request with an injected 500 in the standard envelope', async () => {
    await createEndpoint(alice.token, { chaosConfig: { enabled: true, failureRate: 100 } });
    for (let i = 0; i < 20; i += 1) {
      const res = await request(app).get(proxyUrl('/users/profile')).expect(500);
      expectErrorEnvelope(res.body, 'CHAOS_INJECTED_FAILURE');
      expect(appliedChaos(res)).toBe('failure:500');
    }
    expect(await RequestLog.countDocuments({ statusReturned: 500, chaosApplied: 'failure:500' })).toBe(20);
  });

  it('failureRate = 100 short-circuits before the upstream is called', async () => {
    const forward = jest.spyOn(upstream, 'forwardRequest');
    await createEndpoint(alice.token, {
      path: '/upstream',
      targetUrl: 'https://8.8.8.8/api',
      chaosConfig: { enabled: true, failureRate: 100 },
    });
    await request(app).get(proxyUrl('/upstream')).expect(500);
    expect(forward).not.toHaveBeenCalled();
  });

  it('failureRate = 0 never fails, even when random() returns 0', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    await createEndpoint(alice.token, { chaosConfig: { enabled: true, failureRate: 0 } });
    for (let i = 0; i < 20; i += 1) {
      await request(app).get(proxyUrl('/users/profile')).expect(200);
    }
  });

  it('fails exactly when random() * 100 is below failureRate', async () => {
    const random = jest.spyOn(Math, 'random');
    await createEndpoint(alice.token, { chaosConfig: { enabled: true, failureRate: 30 } });
    random.mockReturnValue(0.29);
    await request(app).get(proxyUrl('/users/profile')).expect(500);
    random.mockReturnValue(0.3);
    await request(app).get(proxyUrl('/users/profile')).expect(200);
  });

  it('applies the delay before the injected failure', async () => {
    const sleep = spySleep();
    await createEndpoint(alice.token, { chaosConfig: { enabled: true, delayMs: 1_500, failureRate: 100 } });
    const res = await request(app).get(proxyUrl('/users/profile')).expect(500);
    expect(sleep).toHaveBeenCalledWith(1_500);
    expect(appliedChaos(res)).toBe('delay:1500ms,failure:500');
  });
});

describe('overrideStatusCode', () => {
  it.each([200, 401, 429, 503, 599])('rewrites the mock status to %i and keeps the body', async (status) => {
    await createEndpoint(alice.token, { chaosConfig: { enabled: true, overrideStatusCode: status } });
    const res = await request(app).get(proxyUrl('/users/profile')).expect(status);
    expect(res.body).toEqual(sampleMock);
    expect(appliedChaos(res)).toBe(`status:${status}`);
  });

  it('rewrites the upstream status in forward mode', async () => {
    mockUpstream({ status: 200, body: Buffer.from('{"ok":true}') });
    await createEndpoint(alice.token, {
      path: '/upstream',
      targetUrl: 'https://8.8.8.8/api',
      chaosConfig: { enabled: true, overrideStatusCode: 429 },
    });
    const res = await request(app).get(proxyUrl('/upstream')).expect(429);
    expect(res.body).toEqual({ ok: true });
  });

  it('is not applied on top of PocketChaos errors such as an SSRF block', async () => {
    await insertRawEndpoint({
      path: '/evil',
      targetUrl: 'http://127.0.0.1:27017/',
      chaosConfig: { enabled: true, overrideStatusCode: 200, corruptJson: true },
    });
    const res = await request(app).get(proxyUrl('/evil')).expect(403);
    expectErrorEnvelope(res.body, 'SSRF_BLOCKED');
  });
});

describe('corruptJson', () => {
  it('corrupts the response without touching the stored mock', async () => {
    const endpoint = await createEndpoint(alice.token, { chaosConfig: { enabled: true, corruptJson: true } });
    const res = await request(app).get(proxyUrl('/users/profile')).expect(200);
    expect(res.body).not.toEqual(sampleMock);
    expect(appliedChaos(res)).toMatch(/^corrupt_json:[1-9]\d*$/);

    const stored = await ChaosEndpoint.findById(endpoint.id).lean();
    expect(stored?.mockResponseJson).toEqual(sampleMock);
  });

  it('leaves an empty {} body unchanged (nothing to corrupt)', async () => {
    await createEndpoint(alice.token, { path: '/empty', mockResponseJson: {}, chaosConfig: { enabled: true, corruptJson: true } });
    const res = await request(app).get(proxyUrl('/empty')).expect(200, {});
    expect(appliedChaos(res)).toBe('corrupt_json:0');
  });

  it('corrupts upstream JSON in forward mode, including +json media types', async () => {
    mockUpstream({ headers: { 'content-type': 'application/problem+json' }, body: Buffer.from('{"a":1,"b":2,"c":3}') });
    await createEndpoint(alice.token, {
      path: '/upstream',
      targetUrl: 'https://8.8.8.8/api',
      chaosConfig: { enabled: true, corruptJson: true },
    });
    const res = await request(app).get(proxyUrl('/upstream')).expect(200);
    expect(appliedChaos(res)).toBe('corrupt_json:1');
    expect(res.body).not.toEqual({ a: 1, b: 2, c: 3 });
  });

  it.each([
    ['text/html', '<h1>hello</h1>', 'corrupt_json:skipped_non_json'],
    ['application/json', '{"broken": ', 'corrupt_json:skipped_invalid_json'],
  ])('skips %s bodies it cannot parse (%p)', async (contentType, body, tag) => {
    mockUpstream({ headers: { 'content-type': contentType }, body: Buffer.from(body) });
    await createEndpoint(alice.token, {
      path: '/upstream',
      targetUrl: 'https://8.8.8.8/api',
      chaosConfig: { enabled: true, corruptJson: true },
    });
    const res = await request(app).get(proxyUrl('/upstream')).buffer(true).parse(rawText).expect(200);
    expect(res.body).toBe(body);
    expect(appliedChaos(res)).toBe(tag);
  });

  it('passes pathologically deep upstream JSON through untouched instead of failing with a 500', async () => {
    const deepJson = `${'['.repeat(20_000)}${']'.repeat(20_000)}`;
    mockUpstream({ headers: { 'content-type': 'application/json' }, body: Buffer.from(deepJson) });
    await createEndpoint(alice.token, {
      path: '/upstream',
      targetUrl: 'https://8.8.8.8/api',
      chaosConfig: { enabled: true, corruptJson: true },
    });
    const res = await request(app).get(proxyUrl('/upstream')).buffer(true).parse(rawText).expect(200);
    expect(res.body).toBe(deepJson);
    expect(appliedChaos(res)).toBe('corrupt_json:skipped_too_deep');
  });
});

describe('forward mode', () => {
  it('forwards method, body and query string to the vetted target URL', async () => {
    const forward = mockUpstream({ status: 201, headers: { 'content-type': 'application/json', etag: '"v1"' }, body: Buffer.from('{"created":true}') });
    await createEndpoint(alice.token, { path: '/orders', method: 'POST', targetUrl: 'https://8.8.8.8/api/orders?source=pc' });

    const res = await request(app)
      .post(proxyUrl('/orders?expand=items'))
      .set('Content-Type', 'application/json')
      .send('{"sku":"A-1","qty":2}')
      .expect(201);

    expect(res.body).toEqual({ created: true });
    expect(res.headers.etag).toBe('"v1"');
    const call = forward.mock.calls[0]?.[0];
    expect(call?.method).toBe('POST');
    expect(call?.url.href).toBe('https://8.8.8.8/api/orders?source=pc&expand=items');
    expect(call?.body?.toString()).toBe('{"sku":"A-1","qty":2}');
  });

  it.each([
    ['UPSTREAM_TIMEOUT', 504],
    ['UPSTREAM_DNS_ERROR', 502],
    ['UPSTREAM_TOO_LARGE', 502],
    ['UPSTREAM_ERROR', 502],
    ['SSRF_BLOCKED', 403],
  ] as const)('maps %s from the forwarder to HTTP %i in the standard envelope', async (code, status) => {
    jest.spyOn(upstream, 'forwardRequest').mockRejectedValue(new upstream.UpstreamError(code, 'boom'));
    await createEndpoint(alice.token, { path: '/upstream', targetUrl: 'https://8.8.8.8/api' });
    const res = await request(app).get(proxyUrl('/upstream')).expect(status);
    expectErrorEnvelope(res.body, code);
    expect(appliedChaos(res)).toBe(code.toLowerCase());
  });
});

describe('SSRF at proxy time (validation bypassed by writing straight to MongoDB)', () => {
  it.each([
    'http://127.0.0.1:27017/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]:8080/',
    'http://10.0.0.1/',
    'http://192.168.1.1/admin',
    'http://localhost:4000/api/endpoints',
    'http://user:pw@8.8.8.8/',
    'file:///etc/passwd',
  ])('blocks %s with 403 SSRF_BLOCKED before any connection is made', async (targetUrl) => {
    const forward = jest.spyOn(upstream, 'forwardRequest');
    await insertRawEndpoint({ path: '/evil', targetUrl });

    const res = await request(app).get(proxyUrl('/evil')).expect(403);
    expectErrorEnvelope(res.body, 'SSRF_BLOCKED');
    expect(forward).not.toHaveBeenCalled();
    expect(await RequestLog.findOne().lean()).toMatchObject({ statusReturned: 403, chaosApplied: 'ssrf_blocked' });
  });

  it('defeats DNS rebinding: the check sees a public IP, the pinned connection sees 127.0.0.1', async () => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.215.14', family: 4 }] as never);
    const connectLookup = jest.spyOn(dns, 'lookup').mockImplementation(((
      _hostname: string,
      _options: LookupOptions,
      callback: LookupCallback,
    ) => callback(null, [{ address: '127.0.0.1', family: 4 }])) as unknown as typeof dns.lookup);

    // Passes write-time validation because the first resolution is public.
    await createEndpoint(alice.token, { path: '/rebind', targetUrl: 'http://rebind.example.com/' });

    const res = await request(app).get(proxyUrl('/rebind')).expect(403);
    expectErrorEnvelope(res.body, 'SSRF_BLOCKED');
    expect(connectLookup).toHaveBeenCalledWith('rebind.example.com', expect.anything(), expect.any(Function));
  });

  it('reports an unresolvable upstream host as 502 UPSTREAM_DNS_ERROR, not as an SSRF block', async () => {
    jest
      .spyOn(dns.promises, 'lookup')
      .mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    await insertRawEndpoint({ path: '/gone', targetUrl: 'https://gone.example.com/api' });
    const res = await request(app).get(proxyUrl('/gone')).expect(502);
    expectErrorEnvelope(res.body, 'UPSTREAM_DNS_ERROR');
  });
});

describe('unknown routes and malformed requests', () => {
  it('returns 404 ENDPOINT_NOT_FOUND for an unregistered subpath, and logs it', async () => {
    await createEndpoint(alice.token);
    const res = await request(app).get(proxyUrl('/does/not/exist')).expect(404);
    expectErrorEnvelope(res.body, 'ENDPOINT_NOT_FOUND');
    expect(appliedChaos(res)).toBe('no_match');
    expect(await RequestLog.findOne().lean()).toMatchObject({ endpointId: null, statusReturned: 404, chaosApplied: 'no_match' });
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const)(
    'returns 404 when a GET-only path is called with %s',
    async (method) => {
      await createEndpoint(alice.token);
      const verb = method.toLowerCase() as 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';
      await request(app)[verb](proxyUrl('/users/profile')).expect(method === 'OPTIONS' ? 204 : 404);
    },
  );

  it('returns 404 for /proxy/KEY when no root endpoint exists', async () => {
    await createEndpoint(alice.token);
    const res = await request(app).get(proxyUrl('')).expect(404);
    expectErrorEnvelope(res.body, 'ENDPOINT_NOT_FOUND');
  });

  it('returns 404 PROJECT_NOT_FOUND for an unknown projectKey and logs nothing', async () => {
    const res = await request(app).get('/proxy/ZZZZZZ/users/profile').expect(404);
    expectErrorEnvelope(res.body, 'PROJECT_NOT_FOUND');
    expect(await RequestLog.countDocuments()).toBe(0);
  });

  it.each(['abc', 'ABCDEFG', 'AB-CDE', 'ABC_DE'])('returns 400 INVALID_PROJECT_KEY for %p', async (key) => {
    const res = await request(app).get(`/proxy/${key}/users/profile`).expect(400);
    expectErrorEnvelope(res.body, 'INVALID_PROJECT_KEY');
  });

  it('returns 400 (not 500) for malformed percent-encoding in the path', async () => {
    const res = await request(app).get(proxyUrl('/%E0%A4%A')).expect(400);
    expectErrorEnvelope(res.body, 'BAD_REQUEST');
  });

  it('rejects request bodies over 1 MB with 413 PAYLOAD_TOO_LARGE', async () => {
    await createEndpoint(alice.token, { path: '/upload', method: 'POST' });
    const res = await request(app)
      .post(proxyUrl('/upload'))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(1_100_000))
      .expect(413);
    expectErrorEnvelope(res.body, 'PAYLOAD_TOO_LARGE');
  });
});

describe('response hardening', () => {
  const SANDBOX_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";

  it('sends a sandboxing CSP and nosniff on mock responses', async () => {
    await createEndpoint(alice.token);
    const res = await request(app).get(proxyUrl('/users/profile')).expect(200);
    expect(res.headers['content-security-policy']).toBe(SANDBOX_CSP);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('neutralises attacker-controlled HTML/JS from an upstream', async () => {
    mockUpstream({ headers: { 'content-type': 'text/html' }, body: Buffer.from('<script>alert(document.domain)</script>') });
    await createEndpoint(alice.token, { path: '/phish', targetUrl: 'https://8.8.8.8/evil' });
    const res = await request(app).get(proxyUrl('/phish')).expect(200);
    expect(res.headers['content-security-policy']).toBe(SANDBOX_CSP);
  });

  it('sends the same CSP on PocketChaos error responses', async () => {
    const res = await request(app).get('/proxy/ZZZZZZ/x').expect(404);
    expect(res.headers['content-security-policy']).toBe(SANDBOX_CSP);
  });

  it('never forwards upstream Set-Cookie headers to the client', async () => {
    mockUpstream({ headers: { 'content-type': 'application/json' }, body: Buffer.from('{}') });
    await createEndpoint(alice.token, { path: '/cookie', targetUrl: 'https://8.8.8.8/x' });
    const res = await request(app).get(proxyUrl('/cookie')).expect(200);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('telemetry robustness', () => {
  it('still records a log for paths longer than the 500-character log limit', async () => {
    await createEndpoint(alice.token);
    const longPath = `/${'segment/'.repeat(100)}end`;
    await request(app).get(proxyUrl(longPath)).expect(404);

    const log = await RequestLog.findOne().lean();
    expect(log).not.toBeNull();
    expect(log?.path.length).toBeLessThanOrEqual(500);
    expect(log?.path.startsWith('/segment/segment/')).toBe(true);
  });

  it('caps stored logs per project so one project cannot flood the database', async () => {
    const endpoint = await createEndpoint(alice.token);
    const base = Date.now() - 60 * 60 * 1000;
    await RequestLog.insertMany(
      Array.from({ length: 1_200 }, (_, i) => ({
        endpointId: endpoint.id,
        projectKey: alice.projectKey,
        timestamp: new Date(base + i * 1000),
        method: 'GET',
        path: '/users/profile',
        statusReturned: 200,
        latencyMs: 1,
        chaosApplied: 'none',
      })),
    );

    await request(app).get(proxyUrl('/users/profile')).expect(200);

    expect(await RequestLog.countDocuments({ projectKey: alice.projectKey })).toBeLessThanOrEqual(1_000);
    const newest = await RequestLog.findOne({ projectKey: alice.projectKey }).sort({ timestamp: -1 }).lean();
    expect(newest?.timestamp.getTime()).toBeGreaterThan(base + 1_199 * 1000);
  });

  it('does not trim logs belonging to other projects', async () => {
    const bob = await registerUser();
    await createEndpoint(alice.token);
    await RequestLog.insertMany(
      Array.from({ length: 1_100 }, (_, i) => ({
        projectKey: bob.projectKey,
        timestamp: new Date(Date.now() - i * 1000),
        method: 'GET',
        path: '/bob',
        statusReturned: 200,
        latencyMs: 1,
        chaosApplied: 'none',
      })),
    );
    await request(app).get(proxyUrl('/users/profile')).expect(200);
    expect(await RequestLog.countDocuments({ projectKey: bob.projectKey })).toBe(1_100);
  });
});

describe('chaos changes take effect immediately', () => {
  it('reflects a PATCH on the very next proxied request', async () => {
    const endpoint = await createEndpoint(alice.token);
    await request(app).get(proxyUrl('/users/profile')).expect(200);
    await setChaos(alice.token, endpoint.id, { enabled: true, overrideStatusCode: 503 });
    await request(app).get(proxyUrl('/users/profile')).expect(503);
    await setChaos(alice.token, endpoint.id, { enabled: false });
    await request(app).get(proxyUrl('/users/profile')).expect(200);
  });
});
