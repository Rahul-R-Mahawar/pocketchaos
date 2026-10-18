import request from 'supertest';
import { createApp } from '../../src/app';
import { RequestLog } from '../../src/models/RequestLog';
import { app, createEndpoint, expectErrorEnvelope, registerUser, type RegisteredUser } from '../helpers/api';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

let alice: RegisteredUser;
beforeEach(async () => {
  alice = await registerUser();
});

describe('GET /api/mobile/pair/:projectKey', () => {
  it('returns the project endpoints with chaos settings and proxy paths, oldest first', async () => {
    await createEndpoint(alice.token, { name: 'Profile', path: '/users/profile' });
    await createEndpoint(alice.token, {
      name: 'Orders',
      path: '/orders',
      method: 'POST',
      targetUrl: 'https://8.8.8.8/orders',
      chaosConfig: { enabled: true, delayMs: 2_000, failureRate: 25 },
    });

    const res = await request(app).get(`/api/mobile/pair/${alice.projectKey}`).expect(200);
    expect(res.body).toMatchObject({ success: true, error: null });
    expect(res.body.data).toEqual({
      projectKey: alice.projectKey,
      proxyBasePath: `/proxy/${alice.projectKey}`,
      endpoints: [
        {
          id: expect.any(String),
          name: 'Profile',
          method: 'GET',
          path: '/users/profile',
          mode: 'mock',
          chaosConfig: { enabled: false, delayMs: 0, failureRate: 0, overrideStatusCode: null, corruptJson: false },
          proxyPath: `/proxy/${alice.projectKey}/users/profile`,
        },
        {
          id: expect.any(String),
          name: 'Orders',
          method: 'POST',
          path: '/orders',
          mode: 'forward',
          chaosConfig: { enabled: true, delayMs: 2_000, failureRate: 25, overrideStatusCode: null, corruptJson: false },
          proxyPath: `/proxy/${alice.projectKey}/orders`,
        },
      ],
    });
  });

  it('does not expose owner ids, upstream URLs or mock payloads to key-only callers', async () => {
    await createEndpoint(alice.token, { path: '/secret', targetUrl: 'https://8.8.8.8/internal-admin-api' });
    const res = await request(app).get(`/api/mobile/pair/${alice.projectKey}`).expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/userId|targetUrl|mockResponseJson|internal-admin-api|Ada Lovelace/);
    expect(body).not.toContain(alice.user.id);
  });

  it('accepts a lowercase key (typed on a phone)', async () => {
    const res = await request(app).get(`/api/mobile/pair/${alice.projectKey.toLowerCase()}`).expect(200);
    expect(res.body.data.projectKey).toBe(alice.projectKey);
  });

  it('returns an empty endpoint list for a project with no endpoints', async () => {
    const res = await request(app).get(`/api/mobile/pair/${alice.projectKey}`).expect(200);
    expect(res.body.data.endpoints).toEqual([]);
  });

  it("never includes another project's endpoints", async () => {
    const bob = await registerUser();
    await createEndpoint(bob.token, { path: '/bob-only' });
    const res = await request(app).get(`/api/mobile/pair/${alice.projectKey}`).expect(200);
    expect(res.body.data.endpoints).toEqual([]);
  });

  it('returns 404 PROJECT_NOT_FOUND for an unknown key', async () => {
    const res = await request(app).get('/api/mobile/pair/ZZZZZZ').expect(404);
    expectErrorEnvelope(res.body, 'PROJECT_NOT_FOUND');
  });

  it.each(['ABC', 'ABCDEFG', 'AB$CDE', '%24ne'])('returns 400 VALIDATION_ERROR for malformed key %p', async (key) => {
    const res = await request(app).get(`/api/mobile/pair/${key}`).expect(400);
    expectErrorEnvelope(res.body, 'VALIDATION_ERROR');
  });
});

describe('GET /api/logs/:projectKey', () => {
  async function seedLogs(projectKey: string, count: number) {
    const base = Date.now() - count * 1000;
    await RequestLog.insertMany(
      Array.from({ length: count }, (_, i) => ({
        projectKey,
        timestamp: new Date(base + i * 1000),
        method: 'GET',
        path: `/seq/${i}`,
        statusReturned: 200,
        latencyMs: i,
        chaosApplied: 'none',
      })),
    );
  }

  it('returns at most the 50 newest logs, newest first', async () => {
    await seedLogs(alice.projectKey, 60);
    const res = await request(app).get(`/api/logs/${alice.projectKey}`).expect(200);
    const logs = res.body.data.logs as Array<{ path: string; timestamp: string }>;

    expect(res.body.data.projectKey).toBe(alice.projectKey);
    expect(logs).toHaveLength(50);
    expect(logs[0]?.path).toBe('/seq/59');
    expect(logs[49]?.path).toBe('/seq/10');
    const times = logs.map((log) => Date.parse(log.timestamp));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('returns proxy telemetry in the documented shape', async () => {
    const endpoint = await createEndpoint(alice.token, { chaosConfig: { enabled: true, overrideStatusCode: 503 } });
    await request(app).get(`/proxy/${alice.projectKey}/users/profile`).set('X-PocketChaos-Platform', 'ios').expect(503);

    const res = await request(app).get(`/api/logs/${alice.projectKey}`).expect(200);
    expect(res.body.data.logs).toEqual([
      {
        id: expect.any(String),
        endpointId: endpoint.id,
        projectKey: alice.projectKey,
        timestamp: expect.any(String),
        method: 'GET',
        path: '/users/profile',
        statusReturned: 503,
        latencyMs: expect.any(Number),
        chaosApplied: 'status:503',
        clientPlatform: 'ios',
      },
    ]);
  });

  it("only returns the requested project's logs", async () => {
    const bob = await registerUser();
    await seedLogs(bob.projectKey, 5);
    const res = await request(app).get(`/api/logs/${alice.projectKey}`).expect(200);
    expect(res.body.data.logs).toEqual([]);
  });

  it('returns 404 PROJECT_NOT_FOUND for an unknown key', async () => {
    const res = await request(app).get('/api/logs/ZZZZZZ').expect(404);
    expectErrorEnvelope(res.body, 'PROJECT_NOT_FOUND');
  });

  it.each(['ABC', 'ABCDEFG', '%7B%22%24gt%22%3A%22%22%7D'])('returns 400 VALIDATION_ERROR for malformed key %p', async (key) => {
    const res = await request(app).get(`/api/logs/${key}`).expect(400);
    expectErrorEnvelope(res.body, 'VALIDATION_ERROR');
  });
});

describe('rate limiting on key-only routes (default app configuration)', () => {
  it('applies a rate limit policy to pairing and logs', async () => {
    const limitedApp = createApp();
    const pair = await request(limitedApp).get(`/api/mobile/pair/${alice.projectKey}`).expect(200);
    const logs = await request(limitedApp).get(`/api/logs/${alice.projectKey}`).expect(200);
    expect(pair.headers['ratelimit-policy']).toBeDefined();
    expect(logs.headers['ratelimit-policy']).toBeDefined();
  });
});
