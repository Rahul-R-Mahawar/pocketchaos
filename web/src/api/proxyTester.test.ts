import { describe, expect, it } from 'vitest';
import { fakeAdapter } from '../test/fakeAdapter';
import { createProxyTester, PROXY_TEST_TIMEOUT_MS } from './proxyTester';

const PROXY_URL = 'http://localhost:4000/proxy/K7Q2XM/users';

function setup(reply: Parameters<typeof fakeAdapter>[0]) {
  let clock = 1_000;
  const transport = fakeAdapter((config) => {
    clock += 250;
    return reply(config);
  });
  const testProxy = createProxyTester({ adapter: transport.adapter, now: () => clock });
  return { testProxy, requests: transport.requests };
}

describe('createProxyTester ("Test in Browser")', () => {
  it('never sends the dashboard JWT to the proxy (it would be forwarded upstream)', async () => {
    localStorage.setItem('pocketchaos.session', JSON.stringify({ token: 'secret-jwt' }));
    const { testProxy, requests } = setup(() => ({ status: 200, data: '{}' }));
    await testProxy(PROXY_URL, 'GET');
    expect(requests[0]?.headers.get('Authorization')).toBeUndefined();
  });

  it('reports injected faults as results, not exceptions, with status, latency and chaos header', async () => {
    const { testProxy, requests } = setup(() => ({
      status: 503,
      data: '{"chaosFault":true,"message":"Injected by PocketChaos"}',
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-pocketchaos-applied': 'failure:503' },
    }));

    const result = await testProxy(PROXY_URL, 'GET');
    expect(result).toEqual({
      kind: 'response',
      status: 503,
      latencyMs: 250,
      chaosApplied: 'failure:503',
      contentType: 'application/json; charset=utf-8',
      bodyPreview: '{\n  "chaosFault": true,\n  "message": "Injected by PocketChaos"\n}',
      truncated: false,
    });
    expect(requests[0]?.timeout).toBe(PROXY_TEST_TIMEOUT_MS);
  });

  it('sends "{}" as JSON for write methods and no body for GET', async () => {
    const { testProxy, requests } = setup(() => ({ status: 201, data: '' }));
    await testProxy(PROXY_URL, 'POST');
    await testProxy(PROXY_URL, 'GET');
    expect(requests[0]?.data).toBe('{}');
    expect(requests[0]?.headers.get('Content-Type')).toBe('application/json');
    expect(requests[0]?.headers.get('Accept')).toBe('application/json');
    expect(requests[1]?.data).toBeUndefined();
  });

  it('keeps non-JSON bodies as raw text and truncates long ones', async () => {
    const html = `<script>alert(1)</script>${'x'.repeat(5_000)}`;
    const { testProxy } = setup(() => ({ status: 200, data: html, headers: { 'content-type': 'text/html' } }));
    const result = await testProxy(PROXY_URL, 'GET');
    expect(result.kind === 'response' && result.bodyPreview.startsWith('<script>alert(1)</script>')).toBe(true);
    expect(result.kind === 'response' && result.truncated).toBe(true);
  });

  it('returns an error result when no response arrives', async () => {
    const { testProxy } = setup(() => 'network-error');
    await expect(testProxy(PROXY_URL, 'GET')).resolves.toMatchObject({ kind: 'error', message: expect.stringMatching(/CORS/) });
  });
});
