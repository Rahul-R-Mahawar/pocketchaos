import { describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, makeEndpoint } from '../test/fixtures';
import { fail, fakeAdapter, ok, type FakeReply } from '../test/fakeAdapter';
import { createApiClient } from './client';
import { ApiError } from './errors';

function setup(handler: Parameters<typeof fakeAdapter>[0], token: string | null = 'jwt-token') {
  const transport = fakeAdapter(handler);
  const onSessionExpired = vi.fn();
  const api = createApiClient({ baseURL: API_BASE_URL, getToken: () => token, onSessionExpired, adapter: transport.adapter });
  return { api, onSessionExpired, requests: transport.requests };
}

const header = (config: { headers: { get: (name: string) => unknown } }, name: string) => config.headers.get(name);

describe('createApiClient', () => {
  it('attaches the Bearer JWT to API calls and unwraps { success, data }', async () => {
    const endpoint = makeEndpoint();
    const { api, requests } = setup(() => ok([endpoint]));

    await expect(api.listEndpoints()).resolves.toEqual([endpoint]);
    expect(requests[0]?.baseURL).toBe(API_BASE_URL);
    expect(requests[0]?.url).toBe('/api/endpoints');
    expect(header(requests[0]!, 'Authorization')).toBe('Bearer jwt-token');
  });

  it('never sends a JWT to the auth routes', async () => {
    const { api, requests } = setup(() => ok({ token: 't', projectKey: 'K7Q2XM', user: {} }));
    await api.login({ email: 'a@b.co', password: 'secret123' });
    expect(header(requests[0]!, 'Authorization')).toBeUndefined();
  });

  it('sends no Authorization header when signed out', async () => {
    const { api, requests } = setup(() => ok({ projectKey: 'K7Q2XM', logs: [] }), null);
    await api.getLogs('K7Q2XM');
    expect(header(requests[0]!, 'Authorization')).toBeUndefined();
  });

  it('turns an error envelope into a typed ApiError with field details', async () => {
    const { api } = setup(() =>
      fail(400, 'VALIDATION_ERROR', 'Request validation failed', [
        { location: 'body', path: 'targetUrl', message: 'targetUrl rejected: private address' },
      ]),
    );
    const error = await api.createEndpoint({ name: 'x', method: 'GET', path: '/x' }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: [{ location: 'body', path: 'targetUrl', message: 'targetUrl rejected: private address' }],
    });
  });

  it.each(['TOKEN_EXPIRED', 'INVALID_TOKEN', 'UNAUTHORIZED'])('ends the session on a 401 %s from an API route', async (code) => {
    const { api, onSessionExpired } = setup(() => fail(401, code));
    await expect(api.listEndpoints()).rejects.toMatchObject({ code });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('does not end the session on INVALID_CREDENTIALS from the login form', async () => {
    const { api, onSessionExpired } = setup(() => fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password'));
    await expect(api.login({ email: 'a@b.co', password: 'nope' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('does not end the session on other errors', async () => {
    const { api, onSessionExpired } = setup(() => fail(404, 'ENDPOINT_NOT_FOUND'));
    await expect(api.deleteEndpoint('x')).rejects.toMatchObject({ status: 404 });
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('reports an unreachable backend as NETWORK_ERROR, naming the API origin', async () => {
    const { api } = setup(() => 'network-error');
    await expect(api.listEndpoints()).rejects.toMatchObject({
      status: null,
      code: 'NETWORK_ERROR',
      message: expect.stringContaining(API_BASE_URL),
    });
  });

  it('rejects a 2xx body that is not the success envelope', async () => {
    const { api } = setup((): FakeReply => ({ status: 200, data: '<html>proxy page</html>' }));
    await expect(api.listEndpoints()).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
  });

  it.each([
    ['null', null],
    ['an object', { endpoints: [] }],
  ])('rejects an endpoint list that is %s (malformed 2xx) instead of passing it to the UI', async (_label, data) => {
    const { api } = setup(() => ok(data));
    await expect(api.listEndpoints()).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
  });

  it.each([
    ['null data', null],
    ['logs that are not an array', { projectKey: 'K7Q2XM', logs: 'x' }],
  ])('rejects a logs response with %s', async (_label, data) => {
    const { api } = setup(() => ok(data));
    await expect(api.getLogs('K7Q2XM')).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
  });

  it('PATCHes only the five chaos keys, keeping numbers as numbers', async () => {
    const { api, requests } = setup(() => ok(makeEndpoint()));
    await api.updateChaos('abc', { delayMs: 2500, failureRate: 30, ...({ saveState: 'saving' } as object) });
    expect(requests[0]?.method).toBe('patch');
    expect(requests[0]?.url).toBe('/api/endpoints/abc/chaos');
    expect(JSON.parse(requests[0]?.data as string)).toEqual({ delayMs: 2500, failureRate: 30 });
  });

  it('URL-encodes ids and project keys', async () => {
    const { api, requests } = setup(() => ok({ projectKey: 'K7Q2XM', logs: [] }));
    await api.getLogs('../admin');
    expect(requests[0]?.url).toBe('/api/logs/..%2Fadmin');
  });
});
