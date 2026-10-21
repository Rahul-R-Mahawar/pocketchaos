import { AxiosError } from 'axios';
import { fakeAdapter } from '../test/fakes';
import { createTransport, TransportError } from './http';

function setup(handler: Parameters<typeof fakeAdapter>[0]) {
  let clock = 1_000;
  const fake = fakeAdapter((config) => {
    clock += 120;
    return handler(config);
  });
  return { transport: createTransport({ adapter: fake.adapter, now: () => clock }), requests: fake.requests };
}

const request = { url: 'http://localhost:4000/proxy/K7Q2XM/x', method: 'GET' as const, headers: { 'x-client-platform': 'react-native' }, timeoutMs: 4000 };

describe('createTransport', () => {
  it('returns injected 5xx faults as data, never as exceptions', async () => {
    const { transport } = setup(() => ({ status: 503, data: '{"chaosFault":true}', headers: { 'X-PocketChaos-Applied': 'failure:503' } }));
    await expect(transport(request)).resolves.toEqual({
      status: 503,
      headers: { 'x-pocketchaos-applied': 'failure:503' },
      bodyText: '{"chaosFault":true}',
      latencyMs: 120,
    });
  });

  it('never parses the body (a corrupted payload cannot throw here)', async () => {
    const { transport } = setup(() => ({ status: 200, data: '{"broken": ', headers: { 'content-type': 'application/json' } }));
    await expect(transport(request)).resolves.toMatchObject({ bodyText: '{"broken": ' });
  });

  it('sends the method, headers, body and timeout it is given', async () => {
    const { transport, requests } = setup(() => ({ status: 201 }));
    await transport({ ...request, method: 'POST', body: '{"a":1}', timeoutMs: 2500 });
    expect(requests[0]).toMatchObject({ method: 'post', data: '{"a":1}', timeout: 2500 });
    expect(requests[0]?.headers.get('x-client-platform')).toBe('react-native');
  });

  it.each([
    ['ETIMEDOUT', 'timeout'],
    ['ECONNABORTED', 'timeout'],
    ['ERR_NETWORK', 'network'],
  ])('maps axios %s to a %s TransportError with latency', async (code, kind) => {
    const { transport } = setup((config) => new AxiosError('boom', code, config));
    const error = await transport(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ kind, latencyMs: 120 });
  });

  it('maps cancellation to a cancelled TransportError', async () => {
    const controller = new AbortController();
    controller.abort();
    const { transport } = setup(() => ({ status: 200 }));
    await expect(transport({ ...request, signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' });
  });
});
