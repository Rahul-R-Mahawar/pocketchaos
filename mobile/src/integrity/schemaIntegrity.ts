/**
 * Payload Schema Integrity Detector.
 *
 * The mobile app has no schema for an endpoint (pairing deliberately hides mock bodies), so it learns one:
 *   1. "clean" baseline: 2xx JSON bodies the proxy did NOT corrupt (no corrupt_json:N tag) are trusted samples.
 *   2. "consensus" fallback: with corruption on for every request there are no clean samples, so the expected
 *      type of each field is the strict majority across the batch (corruption hits ~25% of fields at random).
 * A response is then compared field by field; the chaos header is never used to decide, only to score
 * how many injected corruptions the detector caught. A consensus baseline that cannot agree on a field never
 * vouches for it: a body touching such a field is UNVERIFIED, not INTACT.
 */
export type JsonType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

export function jsonTypeOf(value: unknown): JsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean' || type === 'object') return type;
  return 'null';
}

const MAX_DEPTH = 32;
const MAX_NODES = 5_000;
const MAX_DEVIATIONS = 50;

export interface ShapeStats {
  samples: number;
  /** pattern path → JSON type → occurrences. Array elements share one pattern: "items[].id". */
  typeCounts: Map<string, Map<JsonType, number>>;
  /** pattern path → number of objects seen there. */
  objectCounts: Map<string, number>;
  /** pattern path → key → number of those objects containing it. */
  keyCounts: Map<string, Map<string, number>>;
}

export function emptyStats(): ShapeStats {
  return { samples: 0, typeCounts: new Map(), objectCounts: new Map(), keyCounts: new Map() };
}

const childPattern = (parent: string, key: string) => (parent ? `${parent}.${key}` : key);
const bump = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);

export function addSample(stats: ShapeStats, value: unknown): void {
  stats.samples += 1;
  let nodes = 0;
  const stack: Array<{ node: unknown; pattern: string; depth: number }> = [{ node: value, pattern: '', depth: 0 }];
  for (let item = stack.pop(); item && nodes < MAX_NODES; item = stack.pop()) {
    nodes += 1;
    const { node, pattern, depth } = item;
    const type = jsonTypeOf(node);
    const counts = stats.typeCounts.get(pattern) ?? new Map<JsonType, number>();
    bump(counts, type);
    stats.typeCounts.set(pattern, counts);
    if (depth >= MAX_DEPTH) continue;

    if (type === 'object') {
      bump(stats.objectCounts, pattern);
      const keys = stats.keyCounts.get(pattern) ?? new Map<string, number>();
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        bump(keys, key);
        stack.push({ node: child, pattern: childPattern(pattern, key), depth: depth + 1 });
      }
      stats.keyCounts.set(pattern, keys);
    } else if (type === 'array') {
      for (const child of node as unknown[]) stack.push({ node: child, pattern: `${pattern}[]`, depth: depth + 1 });
    }
  }
}

export interface Expectation {
  basis: 'clean' | 'consensus';
  samples: number;
  allowedTypes: Map<string, Set<JsonType>>;
  requiredKeys: Map<string, Set<string>>;
  /** Consensus only: patterns with no strict-majority type. */
  undecidedTypes: Set<string>;
  /** Consensus only: keys seen in some objects at a pattern, but not in a strict majority of them. */
  undecidedKeys: Map<string, Set<string>>;
}

/** Every type seen in trusted samples is allowed; keys present in every trusted object are required. */
export function expectationFromClean(stats: ShapeStats): Expectation | null {
  if (stats.samples < 1) return null;
  const allowedTypes = new Map<string, Set<JsonType>>();
  for (const [path, counts] of stats.typeCounts) allowedTypes.set(path, new Set(counts.keys()));
  const requiredKeys = new Map<string, Set<string>>();
  for (const [path, keys] of stats.keyCounts) {
    const seen = stats.objectCounts.get(path) ?? 0;
    requiredKeys.set(path, new Set([...keys].filter(([, count]) => count === seen).map(([key]) => key)));
  }
  return { basis: 'clean', samples: stats.samples, allowedTypes, requiredKeys, undecidedTypes: new Set(), undecidedKeys: new Map() };
}

/** Untrusted samples: only a strict-majority type is expected; ambiguous fields are not judged. */
export function expectationFromConsensus(stats: ShapeStats): Expectation | null {
  if (stats.samples < 2) return null;
  const allowedTypes = new Map<string, Set<JsonType>>();
  const undecidedTypes = new Set<string>();
  for (const [path, counts] of stats.typeCounts) {
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const majority = [...counts].find(([, count]) => count * 2 > total);
    if (majority) allowedTypes.set(path, new Set([majority[0]]));
    else undecidedTypes.add(path);
  }
  const requiredKeys = new Map<string, Set<string>>();
  const undecidedKeys = new Map<string, Set<string>>();
  for (const [path, keys] of stats.keyCounts) {
    const seen = stats.objectCounts.get(path) ?? 0;
    requiredKeys.set(path, new Set([...keys].filter(([, count]) => count * 2 > seen).map(([key]) => key)));
    const undecided = [...keys].filter(([, count]) => count * 2 <= seen).map(([key]) => key);
    if (undecided.length > 0) undecidedKeys.set(path, new Set(undecided));
  }
  return { basis: 'consensus', samples: stats.samples, allowedTypes, requiredKeys, undecidedTypes, undecidedKeys };
}

export type DeviationKind = 'unexpected_null' | 'type_changed' | 'missing_field';

export interface Deviation {
  path: string;
  kind: DeviationKind;
  expected: string;
  actual: string;
}

const describe = (types: Set<JsonType> | undefined) => (types ? [...types].sort().join(' | ') : 'unknown');

export function findDeviations(value: unknown, expectation: Expectation): Deviation[] {
  const deviations: Deviation[] = [];
  const stack: Array<{ node: unknown; path: string; pattern: string; depth: number }> = [
    { node: value, path: '', pattern: '', depth: 0 },
  ];

  for (let item = stack.pop(); item && deviations.length < MAX_DEVIATIONS; item = stack.pop()) {
    const { node, path, pattern, depth } = item;
    const actual = jsonTypeOf(node);
    const allowed = expectation.allowedTypes.get(pattern);
    if (allowed && !allowed.has(actual)) {
      deviations.push({
        path: path || '(root)',
        kind: actual === 'null' ? 'unexpected_null' : 'type_changed',
        expected: describe(allowed),
        actual,
      });
      continue; // a replaced subtree is one finding, not one per descendant
    }
    if (depth >= MAX_DEPTH) continue;

    if (actual === 'object') {
      const record = node as Record<string, unknown>;
      for (const key of expectation.requiredKeys.get(pattern) ?? []) {
        if (!(key in record)) {
          deviations.push({
            path: path ? `${path}.${key}` : key,
            kind: 'missing_field',
            expected: describe(expectation.allowedTypes.get(childPattern(pattern, key))),
            actual: 'missing',
          });
        }
      }
      for (const [key, child] of Object.entries(record)) {
        stack.push({ node: child, path: path ? `${path}.${key}` : key, pattern: childPattern(pattern, key), depth: depth + 1 });
      }
    } else if (actual === 'array') {
      (node as unknown[]).forEach((child, index) =>
        stack.push({ node: child, path: `${path}[${index}]`, pattern: `${pattern}[]`, depth: depth + 1 }),
      );
    }
  }
  return deviations.sort((a, b) => a.path.localeCompare(b.path));
}

/** Concrete paths in `value` the expectation cannot judge: an undecided type, or an undecided key that is absent. */
export function findUnverifiable(value: unknown, expectation: Expectation): string[] {
  const paths: string[] = [];
  if (expectation.undecidedTypes.size === 0 && expectation.undecidedKeys.size === 0) return paths;
  const stack: Array<{ node: unknown; path: string; pattern: string; depth: number }> = [
    { node: value, path: '', pattern: '', depth: 0 },
  ];

  for (let item = stack.pop(); item && paths.length < MAX_DEVIATIONS; item = stack.pop()) {
    const { node, path, pattern, depth } = item;
    if (expectation.undecidedTypes.has(pattern)) {
      paths.push(path || '(root)');
      continue;
    }
    if (depth >= MAX_DEPTH) continue;

    const type = jsonTypeOf(node);
    if (type === 'object') {
      const record = node as Record<string, unknown>;
      for (const key of expectation.undecidedKeys.get(pattern) ?? []) {
        if (!(key in record)) paths.push(path ? `${path}.${key}` : key);
      }
      for (const [key, child] of Object.entries(record)) {
        stack.push({ node: child, path: path ? `${path}.${key}` : key, pattern: childPattern(pattern, key), depth: depth + 1 });
      }
    } else if (type === 'array') {
      (node as unknown[]).forEach((child, index) =>
        stack.push({ node: child, path: `${path}[${index}]`, pattern: `${pattern}[]`, depth: depth + 1 }),
      );
    }
  }
  return paths.sort((a, b) => a.localeCompare(b));
}

export type ParsedBody = { kind: 'json'; value: unknown } | { kind: 'invalid-json'; error: string } | { kind: 'not-json' };

export function parseBody(bodyText: string, contentType: string | undefined): ParsedBody {
  const declaredJson = contentType !== undefined && /[/+]json\b/i.test(contentType);
  const looksJson = /^\s*[[{]/.test(bodyText);
  if (!declaredJson && !looksJson) return { kind: 'not-json' };
  try {
    return { kind: 'json', value: JSON.parse(bodyText) };
  } catch (error) {
    return { kind: 'invalid-json', error: error instanceof Error ? error.message : 'Invalid JSON' };
  }
}

export type IntegrityVerdict = 'INTACT' | 'SCHEMA_CORRUPTION_DETECTED' | 'INVALID_JSON' | 'NOT_JSON' | 'UNVERIFIED';

export interface IntegrityReport {
  verdict: IntegrityVerdict;
  deviations: Deviation[];
  /** Why an otherwise clean body is UNVERIFIED: paths the baseline could not judge. */
  unverifiedPaths: string[];
  basis: Expectation['basis'] | null;
}

export function assessIntegrity(parsed: ParsedBody, expectation: Expectation | null): IntegrityReport {
  if (parsed.kind === 'invalid-json') return { verdict: 'INVALID_JSON', deviations: [], unverifiedPaths: [], basis: null };
  if (parsed.kind === 'not-json') return { verdict: 'NOT_JSON', deviations: [], unverifiedPaths: [], basis: null };
  if (!expectation) return { verdict: 'UNVERIFIED', deviations: [], unverifiedPaths: [], basis: null };
  const deviations = findDeviations(parsed.value, expectation);
  if (deviations.length > 0) return { verdict: 'SCHEMA_CORRUPTION_DETECTED', deviations, unverifiedPaths: [], basis: expectation.basis };
  const unverifiedPaths = findUnverifiable(parsed.value, expectation);
  return { verdict: unverifiedPaths.length > 0 ? 'UNVERIFIED' : 'INTACT', deviations: [], unverifiedPaths, basis: expectation.basis };
}

/** Injected-corruption count from X-PocketChaos-Applied ("corrupt_json:3"). Used for scoring only. */
export function injectedCorruptionCount(chaosApplied: string | null | undefined): number {
  const match = /(?:^|,)corrupt_json:(\d+)(?:,|$)/.exec(chaosApplied ?? '');
  return match ? Number(match[1]) : 0;
}

/** A trusted baseline sample: the proxy reported what it did and it did not corrupt this body. */
export function isCleanSample(chaosApplied: string | null | undefined): boolean {
  return chaosApplied != null && injectedCorruptionCount(chaosApplied) === 0;
}
