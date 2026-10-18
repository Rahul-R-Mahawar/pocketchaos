import { describe, expect, it } from 'vitest';
import { buildProxyUrl } from './format';
import { classifyLog, describeTag, parseChaosTags, type LogSeverity } from './telemetry';

describe('parseChaosTags', () => {
  it('returns no tags for "none" or an empty string', () => {
    expect(parseChaosTags('none')).toEqual([]);
    expect(parseChaosTags('')).toEqual([]);
  });

  it('parses every tag the proxy emits', () => {
    expect(
      parseChaosTags(
        'delay:1500ms,failure:503,corrupt_json:3,corrupt_json:skipped_non_json,ssrf_blocked,no_match,upstream_timeout',
      ),
    ).toEqual([
      { kind: 'delay', ms: 1500 },
      { kind: 'failure', status: 503 },
      { kind: 'corrupt', fields: 3 },
      { kind: 'corrupt-skipped', reason: 'non json' },
      { kind: 'system', code: 'ssrf_blocked' },
      { kind: 'system', code: 'no_match' },
      { kind: 'system', code: 'upstream_timeout' },
    ]);
  });

  it('keeps unrecognised tags as plain text', () => {
    expect(parseChaosTags('future_tag:1')).toEqual([{ kind: 'unknown', raw: 'future_tag:1' }]);
  });
});

describe('classifyLog', () => {
  it.each<[number, string, LogSeverity]>([
    [200, 'none', 'success'],
    [201, 'delay:300ms', 'success'],
    [200, 'corrupt_json:2', 'corrupted'],
    [200, 'corrupt_json:0', 'success'],
    [200, 'corrupt_json:skipped_non_json', 'success'],
    [500, 'failure:500', 'injected-error'],
    [503, 'delay:1000ms,failure:503', 'injected-error'],
    [429, 'failure:429', 'injected-warning'],
    [401, 'failure:401', 'injected-warning'],
    [404, 'no_match', 'system'],
    [403, 'ssrf_blocked', 'system'],
    [504, 'upstream_timeout', 'system'],
    [500, 'none', 'server-error'],
    [404, 'none', 'client-error'],
    [302, 'none', 'redirect'],
  ])('status %i with "%s" is %s', (statusReturned, chaosApplied, severity) => {
    expect(classifyLog({ statusReturned, chaosApplied })).toBe(severity);
  });
});

describe('describeTag', () => {
  it('produces short human labels', () => {
    expect(parseChaosTags('delay:10000ms,failure:503,corrupt_json:1,ssrf_blocked').map(describeTag)).toEqual([
      '+10,000 ms',
      'fault 503',
      '1 field corrupted',
      'ssrf blocked',
    ]);
  });
});

describe('buildProxyUrl', () => {
  it('joins the API origin and proxyPath without doubling slashes', () => {
    expect(buildProxyUrl('http://localhost:4000', '/proxy/K7Q2XM/users')).toBe('http://localhost:4000/proxy/K7Q2XM/users');
    expect(buildProxyUrl('http://localhost:4000/', '/proxy/K7Q2XM/users')).toBe('http://localhost:4000/proxy/K7Q2XM/users');
  });
});
