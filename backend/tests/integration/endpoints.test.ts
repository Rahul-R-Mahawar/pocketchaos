import dns from 'node:dns';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import request from 'supertest';
import { createApp } from '../../src/app';
import { ChaosEndpoint } from '../../src/models/ChaosEndpoint';
import { RequestLog } from '../../src/models/RequestLog';
import { User } from '../../src/models/User';
import {
  app,
  bearer,
  createEndpoint,
  expectErrorEnvelope,
  registerUser,
  sampleMock,
  type RegisteredUser,
} from '../helpers/api';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

const SECRET = () => process.env.JWT_SECRET as string;

describe('JWT protection on /api/endpoints', () => {
  let alice: RegisteredUser;
  beforeEach(async () => {
    alice = await registerUser();
  });

  it('rejects a request with no Authorization header (401 UNAUTHORIZED)', async () => {
    const res = await request(app).get('/api/endpoints').expect(401);
    expectErrorEnvelope(res.body, 'UNAUTHORIZED');
  });

  it.each([['Token abc'], ['Bearer'], ['Bearer '], ['Basic dXNlcjpwYXNz']])(
    'rejects malformed Authorization header %p (401 UNAUTHORIZED)',
    async (header) => {
      const res = await request(app).get('/api/endpoints').set('Authorization', header).expect(401);
      expectErrorEnvelope(res.body, 'UNAUTHORIZED');
    },
  );

  it('rejects an expired JWT with 401 TOKEN_EXPIRED', async () => {
    const expired = jwt.sign({ exp: Math.floor(Date.now() / 1000) - 60 }, SECRET(), { subject: alice.user.id });
    const res = await request(app).get('/api/endpoints').set(bearer(expired)).expect(401);
    expectErrorEnvelope(res.body, 'TOKEN_EXPIRED');
  });

  it.each([
    ['garbage token', () => 'not.a.jwt'],
    ['token signed with another secret', () => jwt.sign({}, 'x'.repeat(64), { subject: 'a'.repeat(24) })],
    ['unsigned alg=none token', () => jwt.sign({}, '', { algorithm: 'none', subject: 'a'.repeat(24) })],
    ['HS512 token (algorithm not allowed)', () => jwt.sign({}, SECRET(), { algorithm: 'HS512', subject: 'a'.repeat(24) })],
    ['token without a subject', () => jwt.sign({ foo: 'bar' }, SECRET())],
    ['token whose subject is not an ObjectId', () => jwt.sign({}, SECRET(), { subject: 'admin' })],
    ['token whose payload is a string', () => jwt.sign('just-a-string', SECRET())],
  ])('rejects a %s with 401 INVALID_TOKEN', async (_label, makeToken) => {
    const res = await request(app).get('/api/endpoints').set(bearer(makeToken())).expect(401);
    expectErrorEnvelope(res.body, 'INVALID_TOKEN');
  });

  it('rejects creating an endpoint with a valid token for a deleted account', async () => {
    await User.deleteOne({ _id: alice.user.id });
    const res = await request(app)
      .post('/api/endpoints')
      .set(bearer(alice.token))
      .send({ name: 'Ghost', path: '/ghost', method: 'GET' })
      .expect(401);
    expectErrorEnvelope(res.body, 'UNAUTHORIZED');
  });
});

describe('POST /api/endpoints', () => {
  let alice: RegisteredUser;
  beforeEach(async () => {
    alice = await registerUser();
  });

  it('creates a mock endpoint with defaults, a normalised path and the owner projectKey', async () => {
    const res = await request(app)
      .post('/api/endpoints')
      .set(bearer(alice.token))
      .send({ name: '  Profile  ', path: '/users//profile/', method: 'get', mockResponseJson: sampleMock })
      .expect(201);

    expect(res.body).toMatchObject({ success: true, error: null });
    expect(res.body.data).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{24}$/),
      projectKey: alice.projectKey,
      name: 'Profile',
      method: 'GET',
      path: '/users/profile',
      mode: 'mock',
      targetUrl: null,
      mockResponseJson: sampleMock,
      chaosConfig: { enabled: false, delayMs: 0, failureRate: 0, overrideStatusCode: null, corruptJson: false },
      proxyPath: `/proxy/${alice.projectKey}/users/profile`,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toContain('userId');
  });

  it('defaults mockResponseJson to {} and keeps it on read-back', async () => {
    const endpoint = await createEndpoint(alice.token, { path: '/empty', mockResponseJson: undefined });
    expect(endpoint.mockResponseJson).toEqual({});
    const list = await request(app).get('/api/endpoints').set(bearer(alice.token)).expect(200);
    expect(list.body.data[0].mockResponseJson).toEqual({});
  });

  it('creates a forward endpoint for a public target URL', async () => {
    const endpoint = await createEndpoint(alice.token, { path: '/dns', targetUrl: 'https://8.8.8.8/resolve' });
    expect(endpoint.mode).toBe('forward');
    expect(endpoint.targetUrl).toBe('https://8.8.8.8/resolve');
  });

  it('merges a partial chaosConfig with defaults', async () => {
    const endpoint = await createEndpoint(alice.token, { chaosConfig: { enabled: true, delayMs: 250 } });
    expect(endpoint.chaosConfig).toEqual({
      enabled: true,
      delayMs: 250,
      failureRate: 0,
      overrideStatusCode: null,
      corruptJson: false,
    });
  });

  it.each([
    ['delayMs = 0', { delayMs: 0 }],
    ['delayMs = 10000 (max)', { delayMs: 10_000 }],
    ['failureRate = 0', { failureRate: 0 }],
    ['failureRate = 100', { failureRate: 100 }],
    ['fractional failureRate', { failureRate: 12.5 }],
    ['overrideStatusCode = 200 (min)', { overrideStatusCode: 200 }],
    ['overrideStatusCode = 599 (max)', { overrideStatusCode: 599 }],
    ['overrideStatusCode = null', { overrideStatusCode: null }],
  ])('accepts boundary value %s', async (_label, chaosConfig) => {
    const endpoint = await createEndpoint(alice.token, { chaosConfig });
    expect(endpoint.chaosConfig).toMatchObject(chaosConfig);
  });

  it('rejects a duplicate method + path with 409 ENDPOINT_EXISTS, but allows another method', async () => {
    await createEndpoint(alice.token, { path: '/orders', method: 'GET' });
    const dup = await request(app)
      .post('/api/endpoints')
      .set(bearer(alice.token))
      .send({ name: 'Dup', path: '/orders/', method: 'get' })
      .expect(409);
    expectErrorEnvelope(dup.body, 'ENDPOINT_EXISTS');

    await createEndpoint(alice.token, { path: '/orders', method: 'POST' });
  });

  it('lets two different users register the same path', async () => {
    const bob = await registerUser();
    await createEndpoint(alice.token, { path: '/shared' });
    await createEndpoint(bob.token, { path: '/shared' });
  });

  it('enforces the per-user endpoint cap (409 ENDPOINT_LIMIT_REACHED)', async () => {
    await ChaosEndpoint.insertMany(
      Array.from({ length: 100 }, (_, i) => ({
        userId: alice.user.id,
        projectKey: alice.projectKey,
        name: `bulk ${i}`,
        path: `/bulk/${i}`,
        method: 'GET',
      })),
    );
    const res = await request(app)
      .post('/api/endpoints')
      .set(bearer(alice.token))
      .send({ name: 'One too many', path: '/overflow', method: 'GET' })
      .expect(409);
    expectErrorEnvelope(res.body, 'ENDPOINT_LIMIT_REACHED');
  });

  const nest = (depth: number): unknown => {
    let value: unknown = 'leaf';
    for (let i = 0; i < depth; i += 1) value = { child: value };
    return value;
  };

  it.each([
    ['delayMs as a string', { chaosConfig: { delayMs: '500' } }],
    ['negative delayMs', { chaosConfig: { delayMs: -1 } }],
    ['delayMs above 10000', { chaosConfig: { delayMs: 10_001 } }],
    ['fractional delayMs', { chaosConfig: { delayMs: 1.5 } }],
    ['failureRate above 100', { chaosConfig: { failureRate: 100.01 } }],
    ['negative failureRate', { chaosConfig: { failureRate: -1 } }],
    ['failureRate as a string', { chaosConfig: { failureRate: '50' } }],
    ['overrideStatusCode below 200', { chaosConfig: { overrideStatusCode: 199 } }],
    ['overrideStatusCode above 599', { chaosConfig: { overrideStatusCode: 600 } }],
    ['overrideStatusCode as a string', { chaosConfig: { overrideStatusCode: '503' } }],
    ['enabled as a string', { chaosConfig: { enabled: 'true' } }],
    ['unknown chaosConfig key', { chaosConfig: { explode: true } }],
    ['chaosConfig as an array', { chaosConfig: [] }],
    ['path without a leading slash', { path: 'users' }],
    ['path with a query string', { path: '/users?id=1' }],
    ['path with spaces', { path: '/users/my profile' }],
    ['path longer than 200 chars', { path: `/${'a'.repeat(200)}` }],
    ['empty name', { name: '   ' }],
    ['unsupported method', { method: 'TRACE' }],
    ['method as a number', { method: 1 }],
    ['projectKey in the body (mass assignment)', { projectKey: 'AAAAAA' }],
    ['userId in the body (mass assignment)', { userId: new Types.ObjectId().toString() }],
    ['targetUrl as a number', { targetUrl: 42 }],
    ['mockResponseJson nested deeper than 20 levels', { mockResponseJson: nest(21) }],
    ['mockResponseJson nested 150 levels', { mockResponseJson: nest(150) }],
  ])('rejects %s with 400 VALIDATION_ERROR', async (_label, overrides) => {
    const res = await request(app)
      .post('/api/endpoints')
      .set(bearer(alice.token))
      .send({ name: 'Bad', path: '/bad', method: 'GET', ...overrides })
      .expect(400);
    expectErrorEnvelope(res.body, 'VALIDATION_ERROR');
    expect(await ChaosEndpoint.countDocuments()).toBe(0);
  });

  it('accepts mockResponseJson nested exactly 20 levels', async () => {
    await createEndpoint(alice.token, { path: '/deep', mockResponseJson: nest(20) });
  });

  it('rejects a 40,000-level nested payload with 400 instead of crashing', async () => {
    const res = await request(app)
      .post('/api/endpoints')
      .set(bearer(alice.token))
      .set('Content-Type', 'application/json')
      .send(`{"name":"Deep","path":"/deep","method":"GET","mockResponseJson":${'['.repeat(40_000)}${']'.repeat(40_000)}}`);
    expect(res.status).toBe(400);
  });
});

describe('SSRF protection on targetUrl', () => {
  let alice: RegisteredUser;
  beforeEach(async () => {
    alice = await registerUser();
  });

  async function expectTargetRejected(targetUrl: string, reason: RegExp) {
    const res = await request(app)
      .post('/api/endpoints')
      .set(bearer(alice.token))
      .send({ name: 'SSRF', path: '/ssrf', method: 'GET', targetUrl })
      .expect(400);
    expectErrorEnvelope(res.body, 'VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      { path: 'targetUrl', message: expect.stringMatching(reason) },
    ]);
  }

  it.each([
    ['http://localhost:8080/api', /internal network/],
    ['http://127.0.0.1:8080', /private, loopback/],
    ['http://127.1.2.3/', /private, loopback/],
    ['http://169.254.169.254/latest/meta-data/iam/security-credentials/', /private, loopback/],
    ['http://10.0.0.5/admin', /private, loopback/],
    ['http://172.16.0.1/', /private, loopback/],
    ['http://192.168.0.1/', /private, loopback/],
    ['http://100.64.0.1/', /private, loopback/],
    ['http://0.0.0.0:27017/', /private, loopback/],
    ['http://2130706433/', /private, loopback/],
    ['http://0x7f000001/', /private, loopback/],
    ['http://[::1]:8080/', /private, loopback/],
    ['http://[::ffff:169.254.169.254]/', /private, loopback/],
    ['http://[fd00::1]/', /private, loopback/],
    ['http://metadata.google.internal/', /internal network/],
    ['http://kubernetes.default.svc.cluster.local/', /internal network/],
    ['http://mongo:27017/', /internal network/],
    ['http://admin:pw@8.8.8.8/', /credentials/],
    ['file:///etc/passwd', /only http and https/],
    ['gopher://8.8.8.8/', /only http and https/],
  ])('rejects %s', async (targetUrl, reason) => {
    await expectTargetRejected(targetUrl, reason);
  });

  it('rejects a hostname that resolves to a private IP', async () => {
    const lookup = jest
      .spyOn(dns.promises, 'lookup')
      .mockResolvedValue([{ address: '192.168.10.20', family: 4 }] as never);
    await expectTargetRejected('https://intranet.example.com/api', /resolves to a private or reserved address/);
    expect(lookup).toHaveBeenCalledWith('intranet.example.com', expect.anything());
  });

  it('accepts a hostname whose DNS answers are all public', async () => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.215.14', family: 4 }] as never);
    const endpoint = await createEndpoint(alice.token, { path: '/public', targetUrl: 'https://api.example.com/v1' });
    expect(endpoint.mode).toBe('forward');
  });
});

describe('GET /api/endpoints', () => {
  it("lists only the caller's endpoints, newest first", async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await createEndpoint(alice.token, { path: '/first' });
    await createEndpoint(alice.token, { path: '/second' });
    await createEndpoint(bob.token, { path: '/bobs' });

    const res = await request(app).get('/api/endpoints').set(bearer(alice.token)).expect(200);
    expect(res.body.data.map((e: { path: string }) => e.path)).toEqual(['/second', '/first']);
  });
});

describe('PATCH /api/endpoints/:id/chaos', () => {
  let alice: RegisteredUser;
  let endpointId: string;
  beforeEach(async () => {
    alice = await registerUser();
    endpointId = (await createEndpoint(alice.token)).id;
  });

  const patch = (id: string, body: unknown, token = alice.token) =>
    request(app).patch(`/api/endpoints/${id}/chaos`).set(bearer(token)).send(body as object);

  it('updates only the provided fields', async () => {
    await patch(endpointId, { enabled: true, delayMs: 1500 }).expect(200);
    const res = await patch(endpointId, { failureRate: 25 }).expect(200);
    expect(res.body.data.chaosConfig).toEqual({
      enabled: true,
      delayMs: 1500,
      failureRate: 25,
      overrideStatusCode: null,
      corruptJson: false,
    });
  });

  it('can clear overrideStatusCode back to null', async () => {
    await patch(endpointId, { overrideStatusCode: 503 }).expect(200);
    const res = await patch(endpointId, { overrideStatusCode: null }).expect(200);
    expect(res.body.data.chaosConfig.overrideStatusCode).toBeNull();
  });

  it.each([
    ['delayMs = 0', { delayMs: 0 }],
    ['delayMs = 10000', { delayMs: 10_000 }],
    ['failureRate = 100', { failureRate: 100 }],
  ])('accepts boundary %s', async (_label, body) => {
    const res = await patch(endpointId, body).expect(200);
    expect(res.body.data.chaosConfig).toMatchObject(body);
  });

  it.each([
    ['an empty body', {}],
    ['delayMs = 10001', { delayMs: 10_001 }],
    ['delayMs as a string', { delayMs: '500' }],
    ['negative delayMs', { delayMs: -100 }],
    ['failureRate = 101', { failureRate: 101 }],
    ['an unknown key next to a valid one', { enabled: true, explode: 1 }],
    ['a nested chaosConfig wrapper', { chaosConfig: { enabled: true } }],
    ['a Mongo operator', { $set: { 'chaosConfig.delayMs': 999_999 } }],
    ['a JSON array', [{ enabled: true }]],
  ])('rejects %s with 400 VALIDATION_ERROR and leaves the endpoint unchanged', async (_label, body) => {
    const res = await patch(endpointId, body).expect(400);
    expectErrorEnvelope(res.body, 'VALIDATION_ERROR');
    const stored = await ChaosEndpoint.findById(endpointId).lean();
    expect(stored?.chaosConfig).toMatchObject({ enabled: false, delayMs: 0, failureRate: 0 });
  });

  it.each([['not-an-id'], ['aaaaaaaaaaaa'], ['123'], [`${'a'.repeat(24)}x`]])(
    'rejects malformed id %p with 400 VALIDATION_ERROR (not a 500 CastError)',
    async (id) => {
      const res = await patch(id, { enabled: true }).expect(400);
      expectErrorEnvelope(res.body, 'VALIDATION_ERROR');
    },
  );

  it('rejects a malformed percent-encoded id with 400, not 500', async () => {
    const res = await patch('%E0%A4%A', { enabled: true }).expect(400);
    expectErrorEnvelope(res.body, 'BAD_REQUEST');
  });

  it('returns 404 for a well-formed id that does not exist', async () => {
    const res = await patch(new Types.ObjectId().toString(), { enabled: true }).expect(404);
    expectErrorEnvelope(res.body, 'ENDPOINT_NOT_FOUND');
  });

  it("returns 404 when User B tries to toggle User A's endpoint, and changes nothing", async () => {
    const bob = await registerUser();
    const res = await patch(endpointId, { enabled: true, failureRate: 100 }, bob.token).expect(404);
    expectErrorEnvelope(res.body, 'ENDPOINT_NOT_FOUND');
    const stored = await ChaosEndpoint.findById(endpointId).lean();
    expect(stored?.chaosConfig).toMatchObject({ enabled: false, failureRate: 0 });
  });
});

describe('DELETE /api/endpoints/:id', () => {
  it('deletes the endpoint and its request logs', async () => {
    const alice = await registerUser();
    const endpoint = await createEndpoint(alice.token);
    await request(app).get(`/proxy/${alice.projectKey}/users/profile`).expect(200);
    expect(await RequestLog.countDocuments({ endpointId: endpoint.id })).toBe(1);

    const res = await request(app).delete(`/api/endpoints/${endpoint.id}`).set(bearer(alice.token)).expect(200);
    expect(res.body.data).toEqual({ id: endpoint.id, deleted: true });
    expect(await ChaosEndpoint.countDocuments()).toBe(0);
    expect(await RequestLog.countDocuments({ endpointId: endpoint.id })).toBe(0);

    await request(app).delete(`/api/endpoints/${endpoint.id}`).set(bearer(alice.token)).expect(404);
  });

  it("returns 404 when User B tries to delete User A's endpoint", async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const endpoint = await createEndpoint(alice.token);
    const res = await request(app).delete(`/api/endpoints/${endpoint.id}`).set(bearer(bob.token)).expect(404);
    expectErrorEnvelope(res.body, 'ENDPOINT_NOT_FOUND');
    expect(await ChaosEndpoint.countDocuments({ _id: endpoint.id })).toBe(1);
  });
});

describe('mockResponseJson with hostile keys', () => {
  it.each([
    ['a Mongo operator key', '{"$where": "sleep(1000)"}'],
    ['a dotted key', '{"a.b": 1}'],
    ['a __proto__ key', '{"__proto__": {"polluted": "yes"}}'],
    ['a constructor.prototype key', '{"constructor": {"prototype": {"polluted": "yes"}}}'],
  ])('handles %s without a 500 or prototype pollution', async (_label, mockJson) => {
    const alice = await registerUser();
    const res = await request(app)
      .post('/api/endpoints')
      .set(bearer(alice.token))
      .set('Content-Type', 'application/json')
      .send(`{"name":"Hostile","path":"/hostile","method":"GET","mockResponseJson":${mockJson},"chaosConfig":{"enabled":true,"corruptJson":true}}`);

    expect([201, 400]).toContain(res.status);
    if (res.status === 201) {
      for (let i = 0; i < 5; i += 1) {
        await request(app).get(`/proxy/${alice.projectKey}/hostile`).expect(200);
      }
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('rate limiting on authenticated routes (default app configuration)', () => {
  it('applies a rate limit policy to /api/endpoints', async () => {
    const alice = await registerUser();
    const res = await request(createApp()).get('/api/endpoints').set(bearer(alice.token)).expect(200);
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });
});
