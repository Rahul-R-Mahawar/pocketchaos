import { clampDelay, corruptJson, shouldInjectFailure } from '../../src/services/chaos.service';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Reads a corrupted path like "user.address[0].city" back out of a value; `undefined` if removed. */
function readPath(root: unknown, path: string): unknown {
  const tokens = path.match(/[^.[\]]+/g) ?? [];
  return tokens.reduce<unknown>((node, token) => (node as Record<string, unknown> | undefined)?.[token], root);
}

describe('clampDelay', () => {
  it.each([
    [0, 0],
    [1, 1],
    [9_999, 9_999],
    [10_000, 10_000],
    [10_001, 10_000],
    [999_999, 10_000],
    [1.7, 1],
    [-5, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])('clampDelay(%p) === %p', (input, expected) => {
    expect(clampDelay(input)).toBe(expected);
  });
});

describe('shouldInjectFailure', () => {
  it('never fails at 0%, even when random() returns 0', () => {
    expect(shouldInjectFailure(0, () => 0)).toBe(false);
  });

  it('always fails at 100%, even when random() is just below 1', () => {
    expect(shouldInjectFailure(100, () => 0.999_999_9)).toBe(true);
  });

  it('fails when random()*100 is strictly below the rate', () => {
    expect(shouldInjectFailure(50, () => 0.49)).toBe(true);
    expect(shouldInjectFailure(50, () => 0.5)).toBe(false);
    expect(shouldInjectFailure(0.5, () => 0.004)).toBe(true);
    expect(shouldInjectFailure(0.5, () => 0.006)).toBe(false);
  });

  it.each([Number.NaN, -1, Number.NEGATIVE_INFINITY])('treats invalid rate %p as 0%%', (rate) => {
    expect(shouldInjectFailure(rate, () => 0)).toBe(false);
  });

  it('treats rates above 100 as 100%', () => {
    expect(shouldInjectFailure(150, () => 0.999)).toBe(true);
  });
});

describe('corruptJson', () => {
  it.each([
    ['empty object', {}],
    ['empty array', []],
    ['number root', 42],
    ['string root', 'hello'],
    ['null root', null],
    ['boolean root', true],
  ])('returns %s unchanged with no corrupted paths', (_label, input) => {
    const result = corruptJson(input);
    expect(result.value).toEqual(input);
    expect(result.corruptedPaths).toEqual([]);
  });

  it('never mutates its input (deep-frozen input would throw on write)', () => {
    const input = deepFreeze({ user: { id: 1, tags: ['a', 'b'], address: { city: 'Pune' } }, active: true });
    const snapshot = JSON.stringify(input);
    for (let i = 0; i < 50; i += 1) corruptJson(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('actually changes every path it reports', () => {
    const input = { a: 1, b: 'two', c: true, d: null, e: [1, 2], f: { g: 'h' } };
    for (let i = 0; i < 100; i += 1) {
      const { value, corruptedPaths } = corruptJson(input);
      expect(corruptedPaths.length).toBeGreaterThanOrEqual(1);
      for (const path of corruptedPaths) {
        expect(JSON.stringify(readPath(value, path))).not.toBe(JSON.stringify(readPath(input, path)));
      }
    }
  });

  it('corrupts deeply nested JSON and reports dotted / indexed paths', () => {
    const input = { level1: { level2: { level3: { items: [{ id: 1 }, { id: 2 }] } } } };
    // Candidates in walk order: level1, level2, level3, items, items[0], items[0].id, items[1], items[1].id.
    // This sequence samples items[1].id (index 7) and then items[0].id (index 5), and neither has an ancestor chosen.
    const sequence = [0.95, 0.6];
    let call = 0;
    const { value, corruptedPaths } = corruptJson(input, () => sequence[call++ % sequence.length] as number);

    expect([...corruptedPaths].sort()).toEqual([
      'level1.level2.level3.items[0].id',
      'level1.level2.level3.items[1].id',
    ]);
    expect(readPath(value, 'level1.level2.level3.items[0].id')).not.toBe(1);
    expect(readPath(value, 'level1.level2.level3.items[1].id')).not.toBe(2);
  });

  it('never "corrupts" a null field into null (every reported change is real)', () => {
    for (const random of [() => 0, () => 0.5, () => 0.999]) {
      const { value, corruptedPaths } = corruptJson({ only: null }, random);
      expect(corruptedPaths).toEqual(['only']);
      expect(value).not.toEqual({ only: null });
    }
  });

  it('corrupts roughly 25% of fields, at least 1 and at most 10', () => {
    const small = corruptJson({ a: 1, b: 2, c: 3 });
    expect(small.corruptedPaths).toHaveLength(1);

    const wide = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
    expect(corruptJson(wide).corruptedPaths).toHaveLength(10);
  });

  it.each([
    ['() => 0', () => 0],
    ['() => 1', () => 1],
    ['() => 0.9999999', () => 0.999_999_9],
  ])('terminates and stays in range with a fixed random %s', (_label, random) => {
    const input = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
    const { corruptedPaths } = corruptJson(input, random);
    expect(corruptedPaths).toHaveLength(2);
    expect(corruptedPaths.every((path) => path in input)).toBe(true);
  });

  it('cannot pollute Object.prototype through a "__proto__" key', () => {
    const input = JSON.parse('{"__proto__": {"polluted": "yes"}, "safe": 1}') as Record<string, unknown>;
    for (const random of [() => 0, () => 0.5, () => 0.999]) corruptJson(input, random);
    for (let i = 0; i < 50; i += 1) corruptJson(input);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('returns pathologically deep payloads unchanged instead of blowing the stack', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 50_000; i += 1) deep = { child: deep };
    const result = corruptJson(deep);
    expect(result.corruptedPaths).toEqual([]);
    expect(result.value).toBe(deep);
  });
});
