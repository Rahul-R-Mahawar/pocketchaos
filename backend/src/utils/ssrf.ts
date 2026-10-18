import dns from 'node:dns';
import net from 'node:net';

/**
 * SSRF guard for the Chaos Proxy.
 *
 * Layers:
 *  1. Syntax: WHATWG URL parsing (normalises tricks like http://2130706433 or http://0x7f.1 to 127.0.0.1),
 *     http/https only, no embedded credentials, no internal-looking or single-label hostnames.
 *  2. Address: IP literals and every DNS answer must be public unicast (blocks loopback, RFC1918,
 *     link-local / cloud metadata 169.254.169.254, CGNAT, multicast, reserved, ULA, IPv4-mapped IPv6...).
 *  3. Pinning: `safeLookup` is passed to http(s).request so the socket connects only to an address
 *     that passed the same check, which defeats DNS rebinding between "check" and "connect".
 * Redirects are never followed by the forwarder, so a public host cannot bounce us inward.
 */

const BLOCKED_IPV4_SUBNETS: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // RFC1918 private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // RFC1918 private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // RFC1918 private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

const BLOCKED_IPV6_SUBNETS: Array<[string, number]> = [
  ['::', 96], // unspecified, loopback and IPv4-compatible
  ['::ffff:0:0', 96], // IPv4-mapped (could smuggle 127.0.0.1 etc.)
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF protocol assignments, incl. Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embeds an IPv4 address)
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8], // multicast
];

// Separate lists per family: a single BlockList also matches IPv4 lookups against IPv4-mapped IPv6 rules,
// so the ::ffff:0:0/96 entry would otherwise block every IPv4 address.
const blockListV4 = new net.BlockList();
const blockListV6 = new net.BlockList();
for (const [address, prefix] of BLOCKED_IPV4_SUBNETS) blockListV4.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of BLOCKED_IPV6_SUBNETS) blockListV6.addSubnet(address, prefix, 'ipv6');

const BLOCKED_HOSTNAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback']);
const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.localdomain', '.internal', '.home.arpa', '.lan', '.intranet'];

declare const vetted: unique symbol;
/** A URL that passed `checkExternalUrl`. The brand makes forgetting the check a compile error. */
export type VettedUrl = URL & { readonly [vetted]: true };

export type UrlSafetyResult =
  | { safe: true; url: VettedUrl }
  /** DNS_LOOKUP_FAILED is not an attack signal, so callers can report it as an upstream problem instead. */
  | { safe: false; code: 'SSRF_BLOCKED' | 'DNS_LOOKUP_FAILED'; reason: string };

const blocked = (reason: string): UrlSafetyResult => ({ safe: false, code: 'SSRF_BLOCKED', reason });

export function isPublicIp(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  try {
    return family === 4 ? !blockListV4.check(address, 'ipv4') : !blockListV6.check(address, 'ipv6');
  } catch {
    return false;
  }
}

function normalizeHostname(hostname: string): string {
  // URL keeps IPv6 literals bracketed and tolerates a trailing root dot ("localhost.").
  return hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

function isBlockedHostname(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return true;
  // Single-label names ("mongo", "redis") only resolve inside private networks / container DNS.
  return !hostname.includes('.');
}

async function resolveAll(hostname: string): Promise<dns.LookupAddress[]> {
  return dns.promises.lookup(hostname, { all: true, verbatim: true });
}

/** Full check with a reason, used for validation messages and proxy-time errors. */
export async function checkExternalUrl(rawUrl: string): Promise<UrlSafetyResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return blocked('not a valid absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return blocked('only http and https URLs are allowed');
  }
  if (url.username || url.password) {
    return blocked('URLs with embedded credentials are not allowed');
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) return blocked('URL has no hostname');

  if (net.isIP(hostname) !== 0) {
    return isPublicIp(hostname)
      ? { safe: true, url: url as VettedUrl }
      : blocked(`${hostname} is a private, loopback, link-local or reserved address`);
  }

  if (isBlockedHostname(hostname)) {
    return blocked(`hostname "${hostname}" points to an internal network`);
  }

  let addresses: dns.LookupAddress[];
  try {
    addresses = await resolveAll(hostname);
  } catch {
    return { safe: false, code: 'DNS_LOOKUP_FAILED', reason: `hostname "${hostname}" could not be resolved` };
  }
  if (addresses.length === 0 || addresses.some((entry) => !isPublicIp(entry.address))) {
    // Deliberately vague: echoing the resolved address would turn this into an internal DNS oracle.
    return blocked(`hostname "${hostname}" resolves to a private or reserved address`);
  }

  return { safe: true, url: url as VettedUrl };
}

export async function isSafeExternalUrl(rawUrl: string): Promise<boolean> {
  return (await checkExternalUrl(rawUrl)).safe;
}

export class SsrfBlockedError extends Error {
  readonly code = 'SSRF_BLOCKED';

  constructor(hostname: string) {
    super(`Refusing to connect: "${hostname}" resolves to a private or reserved address`);
    this.name = 'SsrfBlockedError';
  }
}

/**
 * Drop-in `lookup` for http(s).request / net.connect. Resolves the host, rejects the connection if any
 * answer is non-public, and hands the vetted addresses straight to the socket (no second resolution).
 */
export const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, '');
      return;
    }
    const answers = addresses as dns.LookupAddress[];
    const first = answers[0];
    if (!first || answers.some((entry) => !isPublicIp(entry.address))) {
      callback(new SsrfBlockedError(hostname), '');
      return;
    }
    if (options.all) {
      callback(null, answers);
    } else {
      callback(null, first.address, first.family);
    }
  });
};
