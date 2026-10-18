import { HTTP_METHODS, type CreateEndpointPayload, type HttpMethod } from '../api/types';

/**
 * Client-side mirror of backend/src/validators/endpoint.schema.ts, for instant feedback.
 * The server stays the authority (including the real SSRF guard); its field errors are shown too.
 */
export interface EndpointFormValues {
  name: string;
  method: HttpMethod;
  path: string;
  targetUrl: string;
  mockJson: string;
}

export type EndpointFormField = keyof EndpointFormValues;
export type EndpointFormErrors = Partial<Record<EndpointFormField, string>>;

export const MAX_MOCK_DEPTH = 20;
/** The API accepts JSON bodies up to 100 kb; leave room for the other fields. */
export const MAX_MOCK_BYTES = 90 * 1024;
const PATH_PATTERN = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/;

export const DEFAULT_MOCK_JSON = JSON.stringify(
  { id: 42, name: 'Ada Lovelace', email: 'ada@example.com', roles: ['admin', 'editor'], active: true },
  null,
  2,
);

export const EMPTY_ENDPOINT_FORM: EndpointFormValues = {
  name: '',
  method: 'GET',
  path: '/',
  targetUrl: '',
  mockJson: DEFAULT_MOCK_JSON,
};

/** Same rule as the API: an object/array nested `maxDepth` levels below the root is too deep. */
export function exceedsDepth(value: unknown, maxDepth: number): boolean {
  const stack: Array<[unknown, number]> = [[value, 0]];
  for (let entry = stack.pop(); entry; entry = stack.pop()) {
    const [node, depth] = entry;
    if (node === null || typeof node !== 'object') continue;
    if (depth >= maxDepth) return true;
    for (const child of Object.values(node)) stack.push([child, depth + 1]);
  }
  return false;
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host)
  );
}

function validateTargetUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Enter a full URL, e.g. https://api.example.com/users/1';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Only http:// and https:// URLs are supported';
  if (url.username || url.password) return 'URLs with embedded credentials are not allowed';
  if (raw.length > 2048) return 'URL is too long (max 2048 characters)';
  if (isLocalOrPrivateHost(url.hostname)) {
    return 'Local and private addresses are blocked by the proxy SSRF guard; use a public URL or a mock';
  }
  return undefined;
}

type MockResult = { ok: true; value: unknown } | { ok: false; error: string } | { ok: true; value: undefined };

export function parseMockJson(text: string): MockResult {
  if (text.trim() === '') return { ok: true, value: undefined };
  if (new TextEncoder().encode(text).length > MAX_MOCK_BYTES) {
    return { ok: false, error: `Mock response must be under ${MAX_MOCK_BYTES / 1024} kb` };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `Invalid JSON: ${error instanceof Error ? error.message : 'parse error'}` };
  }
  if (exceedsDepth(value, MAX_MOCK_DEPTH)) {
    return { ok: false, error: `JSON must not be nested more than ${MAX_MOCK_DEPTH} levels deep` };
  }
  return { ok: true, value };
}

export type EndpointFormResult =
  | { ok: true; payload: CreateEndpointPayload }
  | { ok: false; errors: EndpointFormErrors };

export function validateEndpointForm(values: EndpointFormValues): EndpointFormResult {
  const errors: EndpointFormErrors = {};
  const name = values.name.trim();
  const path = values.path.trim();
  const targetUrl = values.targetUrl.trim();

  if (!name) errors.name = 'Name is required';
  else if (name.length > 100) errors.name = 'Name must be at most 100 characters';

  if (!(HTTP_METHODS as readonly string[]).includes(values.method)) errors.method = 'Choose an HTTP method';

  if (!path.startsWith('/')) errors.path = 'Path must start with "/"';
  else if (path.length > 200) errors.path = 'Path must be at most 200 characters';
  else if (!PATH_PATTERN.test(path)) {
    errors.path = 'Use URL path characters only (no spaces, query string or #fragment)';
  }

  const targetError = targetUrl ? validateTargetUrl(targetUrl) : undefined;
  if (targetError) errors.targetUrl = targetError;

  const mock = parseMockJson(values.mockJson);
  if (!mock.ok) errors.mockJson = mock.error;

  if (Object.keys(errors).length > 0 || !mock.ok) return { ok: false, errors };

  // Empty targetUrl is omitted, never sent as "" (the API would reject it as an invalid URL).
  // The mock is sent parsed: sending the raw textarea string would be stored and served as a JSON string.
  const payload: CreateEndpointPayload = { name, method: values.method, path };
  if (targetUrl) payload.targetUrl = targetUrl;
  if (mock.value !== undefined) payload.mockResponseJson = mock.value;
  return { ok: true, payload };
}
