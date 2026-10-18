import axios, { type AxiosAdapter } from 'axios';
import type { HttpMethod } from './types';

/**
 * "Test in Browser": fires one request at a proxy URL, the way the mobile app would.
 *
 * Deliberately a separate axios instance with no interceptors: the proxy forwards `Authorization` to the
 * user's upstream, so the dashboard's PocketChaos JWT must never be attached here.
 */
// Worst case: 10 s injected delay + 10 s upstream timeout, plus headroom.
export const PROXY_TEST_TIMEOUT_MS = 25_000;
const PREVIEW_LIMIT = 4_000;
const WRITE_METHODS: ReadonlySet<HttpMethod> = new Set(['POST', 'PUT', 'PATCH']);

export type ProxyTestResult =
  | {
      kind: 'response';
      status: number;
      latencyMs: number;
      chaosApplied: string | null;
      contentType: string | null;
      /** Raw text only: in forward mode this is whatever the upstream sent, so it is never rendered as HTML. */
      bodyPreview: string;
      truncated: boolean;
    }
  | { kind: 'error'; latencyMs: number; message: string };

export interface ProxyTesterOptions {
  now?: () => number;
  adapter?: AxiosAdapter;
}

function prettify(text: string, contentType: string | null): string {
  if (!contentType || !/[/+]json\b/i.test(contentType)) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function createProxyTester(options: ProxyTesterOptions = {}) {
  const now = options.now ?? (() => performance.now());
  const http = axios.create({
    timeout: PROXY_TEST_TIMEOUT_MS,
    validateStatus: () => true,
    responseType: 'text',
    transformResponse: [(data: unknown) => data],
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });

  return async function testProxy(url: string, method: HttpMethod): Promise<ProxyTestResult> {
    const started = now();
    const sendsBody = WRITE_METHODS.has(method);
    try {
      const response = await http.request<string>({
        url,
        method,
        headers: { Accept: 'application/json', ...(sendsBody ? { 'Content-Type': 'application/json' } : {}) },
        ...(sendsBody ? { data: '{}' } : {}),
      });
      const contentType = (response.headers['content-type'] as string | undefined) ?? null;
      const text = prettify(typeof response.data === 'string' ? response.data : '', contentType);
      return {
        kind: 'response',
        status: response.status,
        latencyMs: Math.round(now() - started),
        chaosApplied: (response.headers['x-pocketchaos-applied'] as string | undefined) ?? null,
        contentType,
        bodyPreview: text.slice(0, PREVIEW_LIMIT),
        truncated: text.length > PREVIEW_LIMIT,
      };
    } catch (error) {
      const timedOut = axios.isAxiosError(error) && error.code === 'ECONNABORTED';
      return {
        kind: 'error',
        latencyMs: Math.round(now() - started),
        message: timedOut
          ? `No response within ${PROXY_TEST_TIMEOUT_MS / 1000} s`
          : 'Request failed before a response arrived (backend down or blocked by CORS)',
      };
    }
  };
}

export type ProxyTester = ReturnType<typeof createProxyTester>;
