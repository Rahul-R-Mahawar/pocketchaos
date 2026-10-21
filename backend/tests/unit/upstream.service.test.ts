import dns from 'node:dns';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import {
  forwardRequest,
  MAX_UPSTREAM_BODY_BYTES,
  UpstreamError,
  type UpstreamRequest,
} from '../../src/services/upstream.service';
import type { VettedUrl } from '../../src/utils/ssrf';

/**
 * forwardRequest is the transport layer: it trusts its caller to pass a URL vetted by checkExternalUrl.
 * These tests talk to a local server, so they cast the loopback URL to VettedUrl explicitly.
 */
let server: http.Server;
let baseUrl: string;
let handler: http.RequestListener;

beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function send(path: string, overrides: Partial<UpstreamRequest> = {}) {
  return forwardRequest({
    url: new URL(path, baseUrl) as VettedUrl,
    method: 'GET',
    headers: {},
    ...overrides,
  });
}

describe('forwardRequest', () => {
  it('forwards only allow-listed request headers', async () => {
    let received: http.IncomingHttpHeaders = {};
    handler = (req, res) => {
      received = req.headers;
      res.end('{}');
    };

    await send('/headers', {
      headers: {
        authorization: 'Bearer upstream-token',
        accept: 'application/json',
        'user-agent': 'okhttp/4.12.0',
        cookie: 'session=pocketchaos-dashboard',
        'x-forwarded-for': '10.0.0.1',
        host: 'evil.internal',
        'idempotency-key': '8f3c2a1e-0b9d-4c5e-9f7a-1d2e3f4a5b6c',
        'x-client-platform': 'react-native',
      },
    });

    expect(received.authorization).toBe('Bearer upstream-token');
    expect(received.accept).toBe('application/json');
    expect(received['user-agent']).toBe('okhttp/4.12.0');
    expect(received.cookie).toBeUndefined();
    expect(received['x-forwarded-for']).toBeUndefined();
    expect(received.host).toBe(new URL(baseUrl).host);
    // Replays from the mobile offline queue reuse one key so the upstream API can drop duplicates.
    expect(received['idempotency-key']).toBe('8f3c2a1e-0b9d-4c5e-9f7a-1d2e3f4a5b6c');
    // PocketChaos-internal client hints stay internal.
    expect(received['x-client-platform']).toBeUndefined();
  });

  it('forwards the method and body with an explicit content-length', async () => {
    let seen = { method: '', body: '', length: '' };
    handler = (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen = { method: req.method ?? '', body: Buffer.concat(chunks).toString(), length: req.headers['content-length'] ?? '' };
        res.end();
      });
    };
    await send('/body', { method: 'PUT', body: Buffer.from('{"a":1}'), headers: { 'content-type': 'application/json' } });
    expect(seen).toEqual({ method: 'PUT', body: '{"a":1}', length: '7' });
  });

  it('returns only allow-listed response headers (never Set-Cookie)', async () => {
    handler = (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('ETag', '"abc"');
      res.setHeader('Set-Cookie', 'upstream_session=1');
      res.setHeader('X-Powered-By', 'PHP/5.4');
      res.end('{"ok":true}');
    };
    const response = await send('/response-headers');
    expect(response.headers).toEqual({ 'content-type': 'application/json', etag: '"abc"' });
    expect(response.body.toString()).toBe('{"ok":true}');
  });

  it('does not follow redirects (a public host cannot bounce the proxy inward)', async () => {
    let hits = 0;
    handler = (_req, res) => {
      hits += 1;
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }).end();
    };
    const response = await send('/redirect');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('http://169.254.169.254/latest/meta-data/');
    expect(hits).toBe(1);
  });

  it.each([
    ['gzip', zlib.gzipSync],
    ['deflate', zlib.deflateSync],
    ['br', zlib.brotliCompressSync],
  ] as const)('decodes %s responses', async (encoding, compress) => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': encoding });
      res.end(compress(Buffer.from('{"compressed":true}')));
    };
    const response = await send('/compressed');
    expect(response.body.toString()).toBe('{"compressed":true}');
  });

  it('rejects bodies over the 2 MB cap with UPSTREAM_TOO_LARGE', async () => {
    handler = (_req, res) => res.end(Buffer.alloc(MAX_UPSTREAM_BODY_BYTES + 1));
    await expect(send('/huge')).rejects.toMatchObject({ code: 'UPSTREAM_TOO_LARGE' });
  });

  it('rejects decompression bombs with UPSTREAM_TOO_LARGE', async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(MAX_UPSTREAM_BODY_BYTES * 4));
    expect(bomb.length).toBeLessThan(MAX_UPSTREAM_BODY_BYTES);
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip' });
      res.end(bomb);
    };
    await expect(send('/bomb')).rejects.toMatchObject({ code: 'UPSTREAM_TOO_LARGE' });
  });

  it('rejects an unsupported content-encoding with UPSTREAM_ERROR', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'compress' });
      res.end('xx');
    };
    await expect(send('/weird-encoding')).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('times out slow upstreams with UPSTREAM_TIMEOUT', async () => {
    handler = () => {
      /* never responds */
    };
    const error = await send('/slow', { timeoutMs: 200 }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
  });

  it('reports a hostname that fails to resolve at connect time as UPSTREAM_DNS_ERROR', async () => {
    jest.spyOn(dns, 'lookup').mockImplementation(((_h: string, _o: unknown, callback: (err: Error) => void) =>
      callback(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }))) as unknown as typeof dns.lookup);
    const error = await forwardRequest({
      url: new URL('https://vanished.example.com/api') as VettedUrl,
      method: 'GET',
      headers: {},
    }).catch((err: unknown) => err);
    expect(error).toMatchObject({ code: 'UPSTREAM_DNS_ERROR' });
  });

  it('reports a refused connection as UPSTREAM_ERROR without leaking socket details', async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const error = await forwardRequest({
      url: new URL(`http://127.0.0.1:${port}/`) as VettedUrl,
      method: 'GET',
      headers: {},
    }).catch((err: unknown) => err);
    expect(error).toMatchObject({ code: 'UPSTREAM_ERROR', message: 'Could not reach the upstream server' });
  });
});
