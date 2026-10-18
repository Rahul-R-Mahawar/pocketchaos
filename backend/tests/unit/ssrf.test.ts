import dns from 'node:dns';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { checkExternalUrl, isPublicIp, isSafeExternalUrl, safeLookup } from '../../src/utils/ssrf';

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function mockDnsPromises(addresses: string[]) {
  return jest
    .spyOn(dns.promises, 'lookup')
    .mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })) as never);
}

function mockDnsCallback(addresses: string[]) {
  return jest.spyOn(dns, 'lookup').mockImplementation(((
    _hostname: string,
    _options: LookupOptions,
    callback: LookupCallback,
  ) => {
    callback(null, addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
  }) as unknown as typeof dns.lookup);
}

function runSafeLookup(hostname: string, options: LookupOptions) {
  return new Promise<{ err: NodeJS.ErrnoException | null; address: string | LookupAddress[]; family?: number }>(
    (resolve) => {
      safeLookup(hostname, options, (err, address, family) => resolve({ err, address, family }));
    },
  );
}

describe('isPublicIp', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '198.18.0.1',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:8.8.8.8',
    'fd00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '64:ff9b::7f00:1',
    'not-an-ip',
    '',
  ])('blocks %s', (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.215.14', '172.32.0.1', '2606:4700:4700::1111', '2a00:1450:4001::200e'])(
    'allows public address %s',
    (address) => {
      expect(isPublicIp(address)).toBe(true);
    },
  );
});

describe('checkExternalUrl', () => {
  it.each([
    ['http://127.0.0.1:8080', /private, loopback/],
    ['http://169.254.169.254/latest/meta-data', /private, loopback/],
    ['http://10.0.0.5/admin', /private, loopback/],
    ['http://192.168.1.1', /private, loopback/],
    ['http://2130706433/', /127\.0\.0\.1/], // decimal-encoded loopback
    ['http://0x7f.0.0.1/', /127\.0\.0\.1/], // hex-encoded loopback
    ['http://0177.0.0.1/', /127\.0\.0\.1/], // octal-encoded loopback
    ['http://0/', /0\.0\.0\.0/],
    ['http://[::1]:3000/', /private, loopback/],
    ['http://[::ffff:127.0.0.1]/', /private, loopback/],
    ['http://[fd12:3456::1]/', /private, loopback/],
    ['http://localhost:4000', /internal network/],
    ['http://LOCALHOST./', /internal network/],
    ['http://api.localhost/', /internal network/],
    ['http://printer.local/', /internal network/],
    ['http://metadata.google.internal/computeMetadata/v1', /internal network/],
    ['http://redis:6379', /internal network/],
    ['http://user:secret@8.8.8.8/', /credentials/],
    ['ftp://8.8.8.8/file', /only http and https/],
    ['file:///etc/passwd', /only http and https/],
    ['javascript:alert(1)', /only http and https/],
    ['gopher://8.8.8.8:70/', /only http and https/],
    ['not a url', /not a valid absolute URL/],
    ['', /not a valid absolute URL/],
  ])('blocks %s without needing DNS', async (url, reason) => {
    const lookup = jest.spyOn(dns.promises, 'lookup');
    const result = await checkExternalUrl(url);
    expect(result).toEqual({ safe: false, code: 'SSRF_BLOCKED', reason: expect.stringMatching(reason) });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('allows a public IP literal', async () => {
    const result = await checkExternalUrl('https://8.8.8.8/resolve?name=example.com');
    expect(result.safe).toBe(true);
  });

  it('blocks a hostname that resolves to a private address (DNS-based SSRF)', async () => {
    const lookup = mockDnsPromises(['10.1.2.3']);
    const result = await checkExternalUrl('https://internal-api.example.com/users');
    expect(lookup).toHaveBeenCalledWith('internal-api.example.com', expect.objectContaining({ all: true }));
    expect(result).toEqual({
      safe: false,
      code: 'SSRF_BLOCKED',
      reason: expect.stringMatching(/resolves to a private or reserved address/),
    });
  });

  it('blocks when any one of several DNS answers is private', async () => {
    mockDnsPromises(['93.184.215.14', '127.0.0.1']);
    expect(await isSafeExternalUrl('https://mixed.example.com/')).toBe(false);
  });

  it('does not echo the resolved private address (no internal DNS oracle)', async () => {
    mockDnsPromises(['10.99.88.77']);
    const result = await checkExternalUrl('https://oracle.example.com/');
    expect(JSON.stringify(result)).not.toContain('10.99.88.77');
  });

  it('allows a hostname whose DNS answers are all public', async () => {
    mockDnsPromises(['93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c']);
    const result = await checkExternalUrl('https://api.example.com/v1');
    expect(result.safe).toBe(true);
  });

  it('rejects a hostname that cannot be resolved, flagged as a DNS failure rather than an attack', async () => {
    jest.spyOn(dns.promises, 'lookup').mockRejectedValue(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
    const result = await checkExternalUrl('https://does-not-exist.example.com/');
    expect(result).toEqual({ safe: false, code: 'DNS_LOOKUP_FAILED', reason: expect.stringMatching(/could not be resolved/) });
  });
});

describe('safeLookup (connection-time pinning)', () => {
  it('refuses to connect when DNS answers with a private address (rebinding defence)', async () => {
    mockDnsCallback(['127.0.0.1']);
    const { err } = await runSafeLookup('rebind.example.com', { all: true });
    expect(err).toMatchObject({ code: 'SSRF_BLOCKED' });
  });

  it('refuses when any answer is private', async () => {
    mockDnsCallback(['8.8.8.8', '169.254.169.254']);
    const { err } = await runSafeLookup('rebind.example.com', {});
    expect(err).toMatchObject({ code: 'SSRF_BLOCKED' });
  });

  it('returns every vetted address when called with all: true', async () => {
    mockDnsCallback(['8.8.8.8', '2606:4700:4700::1111']);
    const { err, address } = await runSafeLookup('public.example.com', { all: true });
    expect(err).toBeNull();
    expect(address).toEqual([
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
  });

  it('returns the first vetted address and family for single lookups', async () => {
    mockDnsCallback(['8.8.4.4']);
    const { err, address, family } = await runSafeLookup('public.example.com', {});
    expect(err).toBeNull();
    expect(address).toBe('8.8.4.4');
    expect(family).toBe(4);
  });

  it('passes DNS errors through unchanged', async () => {
    const dnsError = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    jest.spyOn(dns, 'lookup').mockImplementation(((_h: string, _o: LookupOptions, callback: LookupCallback) =>
      callback(dnsError, '')) as unknown as typeof dns.lookup);
    const { err } = await runSafeLookup('missing.example.com', {});
    expect(err).toBe(dnsError);
  });
});
