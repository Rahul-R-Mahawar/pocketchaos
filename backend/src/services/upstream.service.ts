import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { safeLookup, type VettedUrl } from '../utils/ssrf';

export const UPSTREAM_TIMEOUT_MS = 10_000;
export const MAX_UPSTREAM_BODY_BYTES = 2 * 1024 * 1024;

// Request headers worth passing to the developer's API; everything else (cookies, hop-by-hop, Host) is dropped.
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'if-modified-since',
  'if-none-match',
  'user-agent',
];

// Response headers worth returning to the client. Encoding/length headers are recomputed by Express.
const RETURNED_RESPONSE_HEADERS = [
  'cache-control',
  'content-type',
  'etag',
  'last-modified',
  'location',
  'retry-after',
  'www-authenticate',
];

export type UpstreamErrorCode =
  | 'SSRF_BLOCKED'
  | 'UPSTREAM_DNS_ERROR'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_TOO_LARGE'
  | 'UPSTREAM_ERROR';

const DNS_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENODATA']);

export class UpstreamError extends Error {
  readonly code: UpstreamErrorCode;

  constructor(code: UpstreamErrorCode, message: string) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
  }
}

export interface UpstreamRequest {
  /** Must come from `checkExternalUrl`: IP literals never reach `safeLookup`, so this is their only check. */
  url: VettedUrl;
  method: string;
  headers: http.IncomingHttpHeaders;
  body?: Buffer;
  timeoutMs?: number;
}

export interface UpstreamResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

function pickHeaders(source: http.IncomingHttpHeaders, allowed: readonly string[]): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of allowed) {
    const value = source[name];
    if (typeof value === 'string') picked[name] = value;
    else if (Array.isArray(value)) picked[name] = value.join(', ');
  }
  return picked;
}

function decodeBody(body: Buffer, encoding: string | undefined): Buffer {
  const options = { maxOutputLength: MAX_UPSTREAM_BODY_BYTES };
  switch ((encoding ?? 'identity').trim().toLowerCase()) {
    case 'identity':
    case '':
      return body;
    case 'gzip':
    case 'x-gzip':
      return zlib.gunzipSync(body, options);
    case 'deflate':
      return zlib.inflateSync(body, options);
    case 'br':
      return zlib.brotliDecompressSync(body, options);
    default:
      throw new UpstreamError('UPSTREAM_ERROR', `Unsupported upstream content-encoding "${encoding}"`);
  }
}

/**
 * Sends one request to an already-validated URL. Never follows redirects (3xx is returned as-is),
 * connects only to addresses approved by `safeLookup`, and bounds both time and response size.
 */
export function forwardRequest(request: UpstreamRequest): Promise<UpstreamResponse> {
  const { url, method, body, timeoutMs = UPSTREAM_TIMEOUT_MS } = request;
  const transport = url.protocol === 'https:' ? https : http;
  const signal = AbortSignal.timeout(timeoutMs);
  const headers: http.OutgoingHttpHeaders = {
    ...pickHeaders(request.headers, FORWARDED_REQUEST_HEADERS),
    'accept-encoding': 'gzip, deflate, br',
  };
  if (body) headers['content-length'] = body.length;

  return new Promise<UpstreamResponse>((resolve, reject) => {
    const outgoing = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        lookup: safeLookup,
        signal,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        let received = 0;

        incoming.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_UPSTREAM_BODY_BYTES) {
            incoming.destroy();
            reject(new UpstreamError('UPSTREAM_TOO_LARGE', 'Upstream response exceeded the 2 MB limit'));
            return;
          }
          chunks.push(chunk);
        });
        incoming.on('error', (err) => reject(toUpstreamError(err, signal, timeoutMs)));
        incoming.on('end', () => {
          try {
            resolve({
              status: incoming.statusCode ?? 502,
              headers: pickHeaders(incoming.headers, RETURNED_RESPONSE_HEADERS),
              body: decodeBody(Buffer.concat(chunks), incoming.headers['content-encoding']),
            });
          } catch (err) {
            reject(err instanceof UpstreamError ? err : new UpstreamError('UPSTREAM_TOO_LARGE', 'Upstream response could not be decoded within the size limit'));
          }
        });
      },
    );

    outgoing.on('error', (err) => reject(toUpstreamError(err, signal, timeoutMs)));
    outgoing.end(body);
  });
}

function toUpstreamError(err: unknown, signal: AbortSignal, timeoutMs: number): UpstreamError {
  if (err instanceof UpstreamError) return err;
  if ((err as { code?: unknown }).code === 'SSRF_BLOCKED') {
    return new UpstreamError('SSRF_BLOCKED', (err as Error).message);
  }
  if (DNS_ERROR_CODES.has(String((err as { code?: unknown }).code))) {
    return new UpstreamError('UPSTREAM_DNS_ERROR', 'Upstream hostname could not be resolved');
  }
  if (signal.aborted) {
    return new UpstreamError('UPSTREAM_TIMEOUT', `Upstream did not respond within ${timeoutMs} ms`);
  }
  return new UpstreamError('UPSTREAM_ERROR', 'Could not reach the upstream server');
}
