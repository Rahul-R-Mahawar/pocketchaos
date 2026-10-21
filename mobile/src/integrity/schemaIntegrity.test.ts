import {
  addSample,
  assessIntegrity,
  emptyStats,
  expectationFromClean,
  expectationFromConsensus,
  findDeviations,
  injectedCorruptionCount,
  isCleanSample,
  parseBody,
  type Expectation,
} from './schemaIntegrity';

const SAMPLE = {
  id: 42,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  active: true,
  score: 9.5,
  nickname: null,
  roles: ['admin', 'editor'],
  address: { city: 'Pune', zip: '411001' },
  tags: [] as string[],
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function cleanExpectation(...samples: unknown[]): Expectation {
  const stats = emptyStats();
  for (const sample of samples) addSample(stats, sample);
  return expectationFromClean(stats) as Expectation;
}

function mutate(changes: (body: Record<string, unknown>) => unknown) {
  const body = clone(SAMPLE) as unknown as Record<string, unknown>;
  changes(body);
  return body;
}

describe('findDeviations against a clean baseline', () => {
  const expectation = cleanExpectation(SAMPLE);

  it('passes an intact body', () => {
    expect(findDeviations(clone(SAMPLE), expectation)).toEqual([]);
  });

  type Mutator = (body: Record<string, unknown>) => unknown;
  // Every mutation the backend's corruptJson can apply (backend/src/services/chaos.service.ts).
  it.each<[string, Mutator, string, string, string, string]>([
    ['number -> numeric string', (b) => (b.id = '42'), 'id', 'type_changed', 'number', 'string'],
    ['number -> "NaN"', (b) => (b.score = 'NaN'), 'score', 'type_changed', 'number', 'string'],
    ['number -> true', (b) => (b.id = true), 'id', 'type_changed', 'number', 'boolean'],
    ['string -> 12345', (b) => (b.name = 12345), 'name', 'type_changed', 'string', 'number'],
    ['string -> true', (b) => (b.email = true), 'email', 'type_changed', 'string', 'boolean'],
    ['string -> {}', (b) => (b.name = {}), 'name', 'type_changed', 'string', 'object'],
    ['boolean -> "true"', (b) => (b.active = 'true'), 'active', 'type_changed', 'boolean', 'string'],
    ['boolean -> 1', (b) => (b.active = 1), 'active', 'type_changed', 'boolean', 'number'],
    ['null -> "null"', (b) => (b.nickname = 'null'), 'nickname', 'type_changed', 'null', 'string'],
    ['null -> 0', (b) => (b.nickname = 0), 'nickname', 'type_changed', 'null', 'number'],
    ['object -> "[object Object]"', (b) => (b.address = '[object Object]'), 'address', 'type_changed', 'object', 'string'],
    ['object -> []', (b) => (b.address = []), 'address', 'type_changed', 'object', 'array'],
    ['array -> {}', (b) => (b.roles = {}), 'roles', 'type_changed', 'array', 'object'],
    ['array -> "[]"', (b) => (b.roles = '[]'), 'roles', 'type_changed', 'array', 'string'],
    ['field -> null', (b) => (b.email = null), 'email', 'unexpected_null', 'string', 'null'],
    ['array element -> null', (b) => ((b.roles as unknown[])[1] = null), 'roles[1]', 'unexpected_null', 'string', 'null'],
    ['nested field -> number', (b) => ((b.address as Record<string, unknown>).zip = 411001), 'address.zip', 'type_changed', 'string', 'number'],
    ['key removed', (b) => delete b.email, 'email', 'missing_field', 'string', 'missing'],
    ['nested key removed', (b) => delete (b.address as Record<string, unknown>).city, 'address.city', 'missing_field', 'string', 'missing'],
  ])('detects %s', (_label, change, path, kind, expected, actual) => {
    expect(findDeviations(mutate(change), expectation)).toEqual([{ path, kind, expected, actual }]);
  });

  it('reports a replaced subtree once, not once per missing child', () => {
    const deviations = findDeviations(mutate((b) => (b.address = 0)), expectation);
    expect(deviations).toEqual([{ path: 'address', kind: 'type_changed', expected: 'object', actual: 'number' }]);
  });

  it('reports several corrupted fields together, sorted by path', () => {
    const deviations = findDeviations(
      mutate((b) => {
        b.score = null;
        b.id = '42';
        delete b.active;
      }),
      expectation,
    );
    expect(deviations.map((d) => `${d.path}:${d.kind}`)).toEqual(['active:missing_field', 'id:type_changed', 'score:unexpected_null']);
  });

  it('does not flag arrays of a different length or empty arrays', () => {
    expect(findDeviations({ ...clone(SAMPLE), roles: ['admin'], tags: [] }, expectation)).toEqual([]);
    expect(findDeviations({ ...clone(SAMPLE), roles: [] }, expectation)).toEqual([]);
  });

  it('allows legitimately nullable fields learned from several clean samples', () => {
    const nullable = cleanExpectation(SAMPLE, { ...clone(SAMPLE), nickname: 'Countess' });
    expect(findDeviations({ ...clone(SAMPLE), nickname: 'Ada' }, nullable)).toEqual([]);
    expect(findDeviations(clone(SAMPLE), nullable)).toEqual([]);
  });

  it('copes with a corrupted root', () => {
    expect(findDeviations(null, expectation)).toEqual([{ path: '(root)', kind: 'unexpected_null', expected: 'object', actual: 'null' }]);
  });

  it('survives pathologically deep payloads', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 20_000; i += 1) deep = { child: deep };
    const stats = emptyStats();
    expect(() => addSample(stats, deep)).not.toThrow();
    expect(() => findDeviations(deep, expectationFromClean(stats) as Expectation)).not.toThrow();
  });
});

describe('consensus expectation (no clean baseline: corruption on for every request)', () => {
  it('needs at least two samples', () => {
    const stats = emptyStats();
    addSample(stats, SAMPLE);
    expect(expectationFromConsensus(stats)).toBeNull();
  });

  it('recovers the true schema by majority and flags exactly the corrupted bodies', () => {
    const bodies = [
      mutate((b) => (b.id = '42')),
      mutate((b) => (b.email = null)),
      mutate((b) => delete b.active),
      mutate((b) => ((b.roles as unknown[])[0] = 12345)),
      mutate((b) => (b.address = [])),
    ];
    const stats = emptyStats();
    for (const body of bodies) addSample(stats, body);
    const expectation = expectationFromConsensus(stats) as Expectation;

    expect(bodies.map((body) => findDeviations(body, expectation).map((d) => d.path))).toEqual([
      ['id'],
      ['email'],
      ['active'],
      ['roles[0]'],
      ['address'],
    ]);
  });

  it('does not judge fields with no strict majority', () => {
    const stats = emptyStats();
    addSample(stats, { flag: true });
    addSample(stats, { flag: 'true' });
    const expectation = expectationFromConsensus(stats) as Expectation;
    expect(findDeviations({ flag: 'true' }, expectation)).toEqual([]);
  });
});

describe('parseBody and assessIntegrity', () => {
  it.each([
    ['{"a":1}', 'application/json; charset=utf-8', 'json'],
    ['{"a":1}', 'application/problem+json', 'json'],
    ['{"a":1}', undefined, 'json'],
    ['{"broken": ', 'application/json', 'invalid-json'],
    ['<h1>hi</h1>', 'text/html', 'not-json'],
    ['', 'text/plain', 'not-json'],
  ])('parses %p (%p) as %s', (body, contentType, kind) => {
    expect(parseBody(body, contentType).kind).toBe(kind);
  });

  it('maps each case to a verdict', () => {
    const expectation = cleanExpectation(SAMPLE);
    expect(assessIntegrity({ kind: 'invalid-json', error: 'x' }, expectation).verdict).toBe('INVALID_JSON');
    expect(assessIntegrity({ kind: 'not-json' }, expectation).verdict).toBe('NOT_JSON');
    expect(assessIntegrity({ kind: 'json', value: SAMPLE }, null).verdict).toBe('UNVERIFIED');
    expect(assessIntegrity({ kind: 'json', value: clone(SAMPLE) }, expectation)).toEqual({ verdict: 'INTACT', deviations: [], unverifiedPaths: [], basis: 'clean' });
    expect(assessIntegrity({ kind: 'json', value: { ...clone(SAMPLE), id: null } }, expectation).verdict).toBe('SCHEMA_CORRUPTION_DETECTED');
  });
});

describe('chaos header helpers (scoring only)', () => {
  it.each([
    ['none', 0, true],
    ['delay:300ms', 0, true],
    ['corrupt_json:0', 0, true],
    ['corrupt_json:skipped_non_json', 0, true],
    ['delay:300ms,corrupt_json:3', 3, false],
  ])('%p -> injected %i, clean %p', (header, count, clean) => {
    expect(injectedCorruptionCount(header)).toBe(count);
    expect(isCleanSample(header)).toBe(clean);
  });

  it('never treats a response without the header as a trusted sample', () => {
    expect(isCleanSample(null)).toBe(false);
    expect(isCleanSample(undefined)).toBe(false);
  });
});
