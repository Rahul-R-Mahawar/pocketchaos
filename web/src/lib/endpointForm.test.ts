import { describe, expect, it } from 'vitest';
import { EMPTY_ENDPOINT_FORM, MAX_MOCK_BYTES, parseMockJson, validateEndpointForm, type EndpointFormValues } from './endpointForm';

const valid: EndpointFormValues = {
  ...EMPTY_ENDPOINT_FORM,
  name: 'User profile',
  path: '/users/profile',
  mockJson: '{"id": 1, "name": "Ada"}',
};

function nest(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let i = 0; i < depth; i += 1) value = { child: value };
  return value;
}

describe('validateEndpointForm', () => {
  it('builds a payload with the mock parsed into an object, never a JSON string', () => {
    const result = validateEndpointForm(valid);
    expect(result).toEqual({
      ok: true,
      payload: { name: 'User profile', method: 'GET', path: '/users/profile', mockResponseJson: { id: 1, name: 'Ada' } },
    });
  });

  it('omits an empty or whitespace-only targetUrl instead of sending ""', () => {
    const result = validateEndpointForm({ ...valid, targetUrl: '   ' });
    expect(result.ok && 'targetUrl' in result.payload).toBe(false);
  });

  it('includes a public targetUrl, trimmed', () => {
    const result = validateEndpointForm({ ...valid, targetUrl: '  https://api.example.com/users/1  ' });
    expect(result.ok && result.payload.targetUrl).toBe('https://api.example.com/users/1');
  });

  it('omits a blank mock so the server default {} applies', () => {
    const result = validateEndpointForm({ ...valid, mockJson: '  ' });
    expect(result.ok && 'mockResponseJson' in result.payload).toBe(false);
  });

  it('trims the name and path', () => {
    const result = validateEndpointForm({ ...valid, name: '  Orders ', path: ' /orders ' });
    expect(result.ok && result.payload).toMatchObject({ name: 'Orders', path: '/orders' });
  });

  it.each([
    ['', 'Name is required'],
    ['   ', 'Name is required'],
    ['x'.repeat(101), 'at most 100'],
  ])('rejects name %j', (name, message) => {
    const result = validateEndpointForm({ ...valid, name });
    expect(result.ok ? null : result.errors.name).toMatch(message);
  });

  it.each([
    ['users', /start with/],
    ['', /start with/],
    ['/users?id=1', /query string/],
    ['/my profile', /no spaces/],
    ['/users#top', /fragment/],
    [`/${'a'.repeat(200)}`, /at most 200/],
  ])('rejects path %j', (path, message) => {
    const result = validateEndpointForm({ ...valid, path });
    expect(result.ok ? null : result.errors.path).toMatch(message);
  });

  it.each([
    ['not a url', /full URL/],
    ['ftp://files.example.com/a', /http:\/\/ and https:\/\//],
    ['https://user:pw@api.example.com', /credentials/],
    ['http://localhost:4000/api', /SSRF guard/],
    ['http://127.0.0.1:8080', /SSRF guard/],
    ['http://192.168.1.10/', /SSRF guard/],
    ['http://10.0.0.5/', /SSRF guard/],
    ['http://172.20.0.1/', /SSRF guard/],
    ['http://169.254.169.254/latest/meta-data', /SSRF guard/],
    ['http://[::1]:3000/', /SSRF guard/],
  ])('rejects targetUrl %j', (targetUrl, message) => {
    const result = validateEndpointForm({ ...valid, targetUrl });
    expect(result.ok ? null : result.errors.targetUrl).toMatch(message);
  });

  it('reports every invalid field at once', () => {
    const result = validateEndpointForm({ ...valid, name: '', path: 'x', mockJson: '{' });
    expect(result.ok ? [] : Object.keys(result.errors).sort()).toEqual(['mockJson', 'name', 'path']);
  });
});

describe('parseMockJson', () => {
  it('reports JSON syntax errors', () => {
    const result = parseMockJson('{"id": 1,}');
    expect(result.ok ? null : result.error).toMatch(/^Invalid JSON/);
  });

  it('accepts 20 levels of nesting and rejects 21 (same limit as the API)', () => {
    expect(parseMockJson(JSON.stringify(nest(20))).ok).toBe(true);
    const tooDeep = parseMockJson(JSON.stringify(nest(21)));
    expect(tooDeep.ok ? null : tooDeep.error).toMatch(/20 levels/);
  });

  it('rejects payloads over the size limit', () => {
    const result = parseMockJson(JSON.stringify({ blob: 'x'.repeat(MAX_MOCK_BYTES) }));
    expect(result.ok ? null : result.error).toMatch(/under 90 kb/);
  });

  it('accepts arrays, primitives and null', () => {
    expect(parseMockJson('[1, 2]')).toEqual({ ok: true, value: [1, 2] });
    expect(parseMockJson('null')).toEqual({ ok: true, value: null });
  });
});
