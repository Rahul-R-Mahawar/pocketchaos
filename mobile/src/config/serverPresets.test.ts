import { parseMobileEnv } from './env';
import {
  buildPresets,
  DEFAULT_API_PORT,
  defaultPresetId,
  hostFromHostUri,
  normalizeBaseUrl,
  parsePort,
} from './serverPresets';

describe('hostFromHostUri', () => {
  it.each([
    ['192.168.1.20:8081', '192.168.1.20'],
    ['exp://10.0.0.5:8081', '10.0.0.5'],
    ['localhost:8081', 'localhost'],
    ['[fe80::1]:8081', '[fe80::1]'],
    ['My-Mac.local:8081/path', 'my-mac.local'],
    ['', null],
    [undefined, null],
  ])('%p -> %p', (input, expected) => {
    expect(hostFromHostUri(input)).toBe(expected);
  });
});

describe('buildPresets', () => {
  const byId = (presets: ReturnType<typeof buildPresets>) => Object.fromEntries(presets.map((p) => [p.id, p.baseUrl]));

  it('builds emulator, localhost and LAN URLs on the configured port', () => {
    expect(byId(buildPresets({ port: 4000, hostUri: '192.168.1.20:8081' }))).toEqual({
      lan: 'http://192.168.1.20:4000',
      'android-emulator': 'http://10.0.2.2:4000',
      localhost: 'http://localhost:4000',
      cloud: null,
      custom: null,
    });
  });

  it('honours a different backend port', () => {
    expect(byId(buildPresets({ port: 8080 }))['android-emulator']).toBe('http://10.0.2.2:8080');
  });

  it('disables the LAN preset without an Expo host, or when the host is loopback', () => {
    expect(byId(buildPresets({ port: 4000 })).lan).toBeNull();
    expect(byId(buildPresets({ port: 4000, hostUri: 'localhost:8081' })).lan).toBeNull();
    expect(byId(buildPresets({ port: 4000, hostUri: '127.0.0.1:8081' })).lan).toBeNull();
  });

  it('offers the cloud preset only when configured', () => {
    expect(byId(buildPresets({ port: 4000, cloudUrl: 'https://api.pocketchaos.dev' })).cloud).toBe('https://api.pocketchaos.dev');
  });

  it('defaults to port 4000 (backend default; 5000 is AirPlay on macOS)', () => {
    expect(DEFAULT_API_PORT).toBe(4000);
  });
});

describe('defaultPresetId', () => {
  it('prefers the detected LAN host, otherwise the platform loopback alias', () => {
    expect(defaultPresetId('ios', buildPresets({ port: 4000, hostUri: '192.168.1.20:8081' }))).toBe('lan');
    expect(defaultPresetId('android', buildPresets({ port: 4000 }))).toBe('android-emulator');
    expect(defaultPresetId('ios', buildPresets({ port: 4000 }))).toBe('localhost');
  });
});

describe('normalizeBaseUrl', () => {
  it.each([
    ['http://192.168.1.20:4000', 'http://192.168.1.20:4000'],
    ['  HTTP://API.Example.com/  ', 'http://api.example.com'],
    ['https://api.example.com/pocketchaos//', 'https://api.example.com/pocketchaos'],
    ['http://10.0.2.2:4000/', 'http://10.0.2.2:4000'],
    ['http://[::1]:4000', 'http://[::1]:4000'],
    ['http://my-mac.local:4000', 'http://my-mac.local:4000'],
  ])('accepts %p as %p', (input, expected) => {
    expect(normalizeBaseUrl(input)).toEqual({ ok: true, url: expected });
  });

  it.each([
    ['', /Enter the backend URL/],
    ['192.168.1.20:4000', /including http/],
    ['localhost:4000', /including http/],
    ['ftp://example.com', /Only http/],
    ['http://user:pw@example.com', /credentials/],
    ['http://example.com/?debug=1', /query string/],
    ['http://example.com/#x', /query string/],
    ['http://exa mple.com', /including http|not a valid/],
    ['http://-bad-.com', /not a valid/],
    ['http://example.com:99999', /Port must be/],
    ['http://', /including http/],
  ])('rejects %p', (input, message) => {
    const result = normalizeBaseUrl(input);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toMatch(message);
  });
});

describe('parsePort', () => {
  it.each([
    ['4000', 4000],
    ['65535', 65535],
    ['0', null],
    ['70000', null],
    ['40a0', null],
    ['', null],
  ])('%p -> %p', (input, expected) => {
    expect(parsePort(input)).toBe(expected);
  });
});

describe('parseMobileEnv', () => {
  it('uses the backend default port and no cloud URL when unset', () => {
    expect(parseMobileEnv({})).toEqual({ cloudUrl: null, defaultPort: 4000 });
  });

  it('reads and normalises EXPO_PUBLIC_* values', () => {
    expect(parseMobileEnv({ EXPO_PUBLIC_API_BASE_URL: 'https://api.pocketchaos.dev/', EXPO_PUBLIC_API_PORT: '4100' })).toEqual({
      cloudUrl: 'https://api.pocketchaos.dev',
      defaultPort: 4100,
    });
  });

  it('ignores invalid values instead of crashing', () => {
    expect(parseMobileEnv({ EXPO_PUBLIC_API_BASE_URL: 'not a url', EXPO_PUBLIC_API_PORT: 'abc' })).toEqual({
      cloudUrl: null,
      defaultPort: 4000,
    });
  });
});
