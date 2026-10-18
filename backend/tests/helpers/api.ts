import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app';

/** Shared app for most tests. Rate limiting is covered separately against a default `createApp()`. */
export const app = createApp({ rateLimit: false });

export const TEST_PASSWORD = 'correct-horse-battery-1';

export interface RegisteredUser {
  token: string;
  projectKey: string;
  user: { id: string; email: string; projectKey: string; createdAt: string };
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export async function registerUser(email = uniqueEmail()): Promise<RegisteredUser> {
  const res = await request(app).post('/api/auth/register').send({ email, password: TEST_PASSWORD });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as RegisteredUser;
}

export const sampleMock = {
  user: { id: 42, name: 'Ada Lovelace', email: 'ada@example.com', address: { city: 'Pune', zip: '411001' } },
  roles: ['admin', 'editor'],
  active: true,
  score: 9.5,
};

export interface EndpointDto {
  id: string;
  projectKey: string;
  name: string;
  method: string;
  path: string;
  mode: 'mock' | 'forward';
  targetUrl: string | null;
  mockResponseJson: unknown;
  chaosConfig: {
    enabled: boolean;
    delayMs: number;
    failureRate: number;
    overrideStatusCode: number | null;
    corruptJson: boolean;
  };
  proxyPath: string;
}

export async function createEndpoint(token: string, body: Record<string, unknown> = {}): Promise<EndpointDto> {
  const res = await request(app)
    .post('/api/endpoints')
    .set(bearer(token))
    .send({ name: 'Profile', path: '/users/profile', method: 'GET', mockResponseJson: sampleMock, ...body });
  if (res.status !== 201) throw new Error(`create endpoint failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as EndpointDto;
}

export async function setChaos(token: string, endpointId: string, chaos: Record<string, unknown>): Promise<void> {
  const res = await request(app).patch(`/api/endpoints/${endpointId}/chaos`).set(bearer(token)).send(chaos);
  if (res.status !== 200) throw new Error(`patch chaos failed: ${res.status} ${JSON.stringify(res.body)}`);
}

/** Every PocketChaos-generated error body must match the standard envelope. */
export function expectErrorEnvelope(body: unknown, code: string): void {
  expect(body).toEqual({
    success: false,
    data: null,
    error: expect.objectContaining({ code, message: expect.any(String) }),
  });
}
