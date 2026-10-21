import { json, makePairedEndpoint, scriptedTransport } from '../test/fakes';
import { TransportError } from './http';
import { createPocketChaosApi } from './pocketChaosApi';

const BASE = 'http://10.0.2.2:4000';
const pairData = { projectKey: 'K7Q2XM', proxyBasePath: '/proxy/K7Q2XM', endpoints: [makePairedEndpoint()] };

describe('createPocketChaosApi', () => {
  it('pairs with GET /api/mobile/pair/:projectKey and validates the response', async () => {
    const { transport, requests } = scriptedTransport(() => json({ success: true, data: pairData }));
    await expect(createPocketChaosApi(BASE, transport).pair('K7Q2XM')).resolves.toEqual(pairData);
    expect(requests[0]?.url).toBe(`${BASE}/api/mobile/pair/K7Q2XM`);
  });

  it('rejects malformed keys without a network call', async () => {
    const { transport, requests } = scriptedTransport(() => json({}));
    await expect(createPocketChaosApi(BASE, transport).pair('k7q2')).rejects.toMatchObject({ code: 'INVALID_PROJECT_KEY' });
    expect(requests).toHaveLength(0);
  });

  it('surfaces API error envelopes (e.g. unknown key)', async () => {
    const { transport } = scriptedTransport(() => ({
      status: 404,
      bodyText: JSON.stringify({ success: false, error: { code: 'PROJECT_NOT_FOUND', message: 'No project found for this key', details: [] } }),
    }));
    await expect(createPocketChaosApi(BASE, transport).pair('ZZZZZZ')).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND', status: 404 });
  });

  it.each([
    ['an HTML page (wrong URL, captive portal)', { status: 200, bodyText: '<html>login</html>' }],
    ['a success envelope with the wrong shape', json({ success: true, data: { endpoints: 'nope' } })],
    ['an endpoint with an unknown method', json({ success: true, data: { ...pairData, endpoints: [{ ...makePairedEndpoint(), method: 'TRACE' }] } })],
  ])('treats %s as UNEXPECTED_RESPONSE instead of crashing', async (_label, reply) => {
    const { transport } = scriptedTransport(() => reply);
    await expect(createPocketChaosApi(BASE, transport).pair('K7Q2XM')).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
  });

  it('explains unreachable backends, naming the URL', async () => {
    const { transport } = scriptedTransport(() => new TransportError('network', 'down', 5));
    await expect(createPocketChaosApi(BASE, transport).pair('K7Q2XM')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: expect.stringContaining(BASE),
    });
  });

  it('reports timeouts', async () => {
    const { transport } = scriptedTransport(() => new TransportError('timeout', 'slow', 8000));
    await expect(createPocketChaosApi(BASE, transport).health()).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('checks /health', async () => {
    const { transport, requests } = scriptedTransport(() => ({ ...json({ success: true, data: { status: 'ok' } }), latencyMs: 42 }));
    await expect(createPocketChaosApi(BASE, transport).health()).resolves.toEqual({ latencyMs: 42 });
    expect(requests[0]?.url).toBe(`${BASE}/health`);
  });
});
