import axios, { AxiosHeaders, type AxiosAdapter } from 'axios';

/**
 * One HTTP attempt. Never throws for HTTP status codes and never parses the body: a chaotic response
 * (injected 5xx, corrupted or non-JSON body) must reach the app as data, not as an exception.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpRequest {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  latencyMs: number;
}

export type TransportErrorKind = 'timeout' | 'network' | 'cancelled';

export class TransportError extends Error {
  readonly kind: TransportErrorKind;
  readonly latencyMs: number;

  constructor(kind: TransportErrorKind, message: string, latencyMs: number) {
    super(message);
    this.name = 'TransportError';
    this.kind = kind;
    this.latencyMs = latencyMs;
  }
}

export type Transport = (request: HttpRequest) => Promise<HttpResponse>;

export interface TransportOptions {
  now?: () => number;
  /** Test seam: replaces the XHR transport. */
  adapter?: AxiosAdapter;
}

function flattenHeaders(raw: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  const source = raw instanceof AxiosHeaders ? raw.toJSON() : (raw as Record<string, unknown> | undefined);
  for (const [name, value] of Object.entries(source ?? {})) {
    if (value === undefined || value === null) continue;
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return headers;
}

export function createTransport(options: TransportOptions = {}): Transport {
  const now = options.now ?? (() => Date.now());
  const http = axios.create({
    validateStatus: () => true,
    responseType: 'text',
    transformResponse: [(data: unknown) => data],
    // Report timeouts as ETIMEDOUT so they are not confused with user cancellation.
    transitional: { clarifyTimeoutError: true },
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });

  return async (request) => {
    const started = now();
    try {
      const response = await http.request<unknown>({
        url: request.url,
        method: request.method,
        headers: request.headers,
        data: request.body,
        timeout: request.timeoutMs,
        signal: request.signal,
      });
      return {
        status: response.status,
        headers: flattenHeaders(response.headers),
        bodyText: typeof response.data === 'string' ? response.data : response.data == null ? '' : String(response.data),
        latencyMs: Math.max(0, Math.round(now() - started)),
      };
    } catch (error) {
      const latencyMs = Math.max(0, Math.round(now() - started));
      if (axios.isCancel(error)) throw new TransportError('cancelled', 'Request cancelled', latencyMs);
      if (axios.isAxiosError(error) && (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED')) {
        throw new TransportError('timeout', `No response within ${request.timeoutMs} ms`, latencyMs);
      }
      throw new TransportError('network', 'Network request failed (server unreachable or offline)', latencyMs);
    }
  };
}
