import { describe, expect, it } from 'vitest';
import { parseWebEnv } from './env';

describe('parseWebEnv', () => {
  it('accepts an http(s) API origin and strips trailing slashes', () => {
    expect(parseWebEnv({ VITE_API_BASE_URL: 'https://api.pocketchaos.dev/' })).toEqual({
      ok: true,
      env: { apiBaseUrl: 'https://api.pocketchaos.dev' },
    });
  });

  it.each([
    ['missing', {}],
    ['not a URL', { VITE_API_BASE_URL: 'localhost:4000' }],
    ['a non-http protocol', { VITE_API_BASE_URL: 'ftp://example.com' }],
  ])('reports a problem when VITE_API_BASE_URL is %s', (_label, source) => {
    const result = parseWebEnv(source);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems[0]).toMatch(/VITE_API_BASE_URL/);
  });
});
