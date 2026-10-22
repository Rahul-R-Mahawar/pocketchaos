import { describe, expect, it } from 'vitest';
import { DEV_API_URL, parseWebEnv } from './env';

describe('parseWebEnv', () => {
  it('accepts an http(s) API origin in VITE_API_URL and strips trailing slashes', () => {
    expect(parseWebEnv({ VITE_API_URL: 'https://api.pocketchaos.dev/' })).toEqual({
      ok: true,
      env: { apiBaseUrl: 'https://api.pocketchaos.dev' },
    });
  });

  it('still reads the legacy VITE_API_BASE_URL, with VITE_API_URL taking precedence', () => {
    expect(parseWebEnv({ VITE_API_BASE_URL: 'http://10.0.0.5:4000' })).toMatchObject({ ok: true, env: { apiBaseUrl: 'http://10.0.0.5:4000' } });
    expect(parseWebEnv({ VITE_API_URL: 'https://a.dev', VITE_API_BASE_URL: 'https://b.dev' })).toMatchObject({ env: { apiBaseUrl: 'https://a.dev' } });
  });

  it('falls back to the local backend only on the dev server', () => {
    expect(parseWebEnv({ DEV: true })).toEqual({ ok: true, env: { apiBaseUrl: DEV_API_URL } });
    expect(parseWebEnv({ DEV: true, VITE_API_URL: '' })).toEqual({ ok: true, env: { apiBaseUrl: DEV_API_URL } });
  });

  it.each([
    ['missing in a production build', { DEV: false }],
    ['not a URL', { VITE_API_URL: 'localhost:4000' }],
    ['a non-http protocol', { VITE_API_URL: 'ftp://example.com' }],
  ])('reports a problem when VITE_API_URL is %s', (_label, source) => {
    const result = parseWebEnv(source);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems[0]).toMatch(/VITE_API_URL/);
  });
});
