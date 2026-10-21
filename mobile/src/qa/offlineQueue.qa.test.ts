/**
 * QA: Offline Queue Manager — empty replays, duplicate sync taps, storage read/write failures, tampered storage.
 */
import { TransportError } from '../api/http';
import { createPocketChaosApi } from '../api/pocketChaosApi';
import { OfflineQueue, QUEUE_STORAGE_KEY, QueueFullError, type EnqueueInput, type QueuedRequest, type ReplayOutcome } from '../queue/offlineQueue';
import { IntegrityTracker, runBatch, summarize, type BatchPlan } from '../runner/batchRunner';
import { sanitizeProjectKey } from '../screens/PairScreen';
import { makePairedEndpoint, MemoryStorage, scriptedTransport, sequentialIds } from '../test/fakes';

const input = (path: string, overrides: Partial<EnqueueInput> = {}): EnqueueInput => ({
  projectKey: 'K7Q2XM',
  endpointId: 'e2',
  endpointName: 'Create order',
  method: 'POST',
  path,
  body: '{"qty":1}',
  reason: 'simulated_offline',
  ...overrides,
});

const newQueue = (storage: MemoryStorage, onCorruptStorage = jest.fn()) => new OfflineQueue(storage, { newId: sequentialIds(), onCorruptStorage });
const saved = (storage: MemoryStorage): { items: QueuedRequest[] } => JSON.parse(storage.data.get(QUEUE_STORAGE_KEY) ?? '{"items":[]}');
const savedPaths = (storage: MemoryStorage) => saved(storage).items.map((item) => item.path);

async function seeded(paths: string[]) {
  const storage = new MemoryStorage();
  const queue = newQueue(storage);
  await queue.load();
  for (const path of paths) await queue.enqueue(input(path));
  return storage;
}

function recorder(decide: (item: QueuedRequest, call: number) => ReplayOutcome = () => ({ kind: 'delivered', status: 201 })) {
  const sent: string[] = [];
  const replay = jest.fn(async (item: QueuedRequest) => {
    sent.push(`${item.path}#${item.id}`);
    return decide(item, sent.length);
  });
  return { replay, sent };
}

describe('happy path replay', () => {
  it('delivers every queued request once, in order, and leaves an empty queue on disk', async () => {
    const storage = await seeded(['/orders/a', '/orders/b', '/orders/c']);
    const queue = newQueue(storage);
    await queue.load();
    const { replay, sent } = recorder();

    await expect(queue.sync('K7Q2XM', replay)).resolves.toMatchObject({ total: 3, done: 3, delivered: 3, rejected: 0, stopped: null });
    expect(sent).toEqual(['/orders/a#id-1', '/orders/b#id-2', '/orders/c#id-3']);
    expect(saved(storage).items).toEqual([]);
  });
});

describe('empty queue replay', () => {
  it('reports 0 of 0 without calling replay or writing storage', async () => {
    const storage = new MemoryStorage();
    const queue = newQueue(storage);
    await queue.load();
    const writes = storage.writes;
    const { replay } = recorder();
    const onProgress = jest.fn();

    await expect(queue.sync('K7Q2XM', replay, onProgress)).resolves.toEqual({
      total: 0, done: 0, current: null, delivered: 0, rejected: 0, stopped: null, skippedOtherProjects: 0,
    });
    expect(replay).not.toHaveBeenCalled();
    expect(storage.writes).toBe(writes);
    expect(queue.isSyncing).toBe(false);
  });

  it('is empty for this project when everything queued belongs to another one', async () => {
    const storage = await seeded([]);
    const queue = newQueue(storage);
    await queue.load();
    await queue.enqueue(input('/other', { projectKey: 'ZZ9ZZ9' }));
    const { replay } = recorder();
    await expect(queue.sync('K7Q2XM', replay)).resolves.toMatchObject({ total: 0, skippedOtherProjects: 1 });
    expect(replay).not.toHaveBeenCalled();
    expect(savedPaths(storage)).toEqual(['/other']);
  });
});

describe('duplicate sync taps', () => {
  it('a second tap joins the running sync (same promise); each request is sent exactly once', async () => {
    const storage = await seeded(['/orders/a', '/orders/b']);
    storage.delayMs = 2;
    const queue = newQueue(storage);
    await queue.load();
    const { replay, sent } = recorder();

    const first = queue.sync('K7Q2XM', replay);
    const second = queue.sync('K7Q2XM', replay);
    const third = queue.sync('K7Q2XM', replay);
    expect(second).toBe(first);
    expect(third).toBe(first);
    await Promise.all([first, second, third]);

    expect(sent).toEqual(['/orders/a#id-1', '/orders/b#id-2']);
    expect(queue.isSyncing).toBe(false);
    // Once finished, a new tap starts a new (here: empty) sync rather than replaying the old one.
    await expect(queue.sync('K7Q2XM', replay)).resolves.toMatchObject({ total: 0 });
    expect(replay).toHaveBeenCalledTimes(2);
  });
});

describe('storage read failures', () => {
  it('never overwrites the saved queue with new items after a failed read', async () => {
    const storage = await seeded(['/orders/a', '/orders/b', '/orders/c']);
    const queue = newQueue(storage);
    storage.failNextRead = true;
    await expect(queue.load()).rejects.toThrow('read failed');

    await queue.enqueue(input('/orders/d'));

    expect(savedPaths(storage)).toEqual(['/orders/a', '/orders/b', '/orders/c', '/orders/d']);
    expect(saved(storage).items.map((item) => item.seq)).toEqual([1, 2, 3, 4]);
  });

  it('rejects the change (and keeps the saved queue) while the queue still cannot be read', async () => {
    const storage = await seeded(['/orders/a']);
    const queue = newQueue(storage);
    storage.failNextRead = true;
    await expect(queue.load()).rejects.toThrow('read failed');
    storage.failNextRead = true;
    await expect(queue.enqueue(input('/orders/b'))).rejects.toThrow('read failed');
    expect(savedPaths(storage)).toEqual(['/orders/a']);
  });

  it('a sync after a failed read replays the saved queue instead of reporting it empty', async () => {
    const storage = await seeded(['/orders/a', '/orders/b']);
    const queue = newQueue(storage);
    storage.failNextRead = true;
    await expect(queue.load()).rejects.toThrow('read failed');
    const { replay, sent } = recorder();

    await expect(queue.sync('K7Q2XM', replay)).resolves.toMatchObject({ total: 2, delivered: 2 });
    expect(sent).toEqual(['/orders/a#id-1', '/orders/b#id-2']);
  });
});

describe('storage write failures', () => {
  it('a failed write after delivery stops the sync, keeps the item, and the next sync re-sends it with the same id', async () => {
    const storage = await seeded(['/orders/a', '/orders/b']);
    const queue = newQueue(storage);
    await queue.load();
    const { replay, sent } = recorder((_item, call) => {
      if (call === 1) storage.failNextWrite = true; // the "remove after delivery" write fails
      return { kind: 'delivered', status: 201 };
    });

    await expect(queue.sync('K7Q2XM', replay)).rejects.toThrow('write failed');
    expect(queue.isSyncing).toBe(false);
    expect(savedPaths(storage)).toEqual(['/orders/a', '/orders/b']);

    await expect(queue.sync('K7Q2XM', replay)).resolves.toMatchObject({ delivered: 2 });
    expect(sent).toEqual(['/orders/a#id-1', '/orders/a#id-1', '/orders/b#id-2']); // at-least-once, same Idempotency-Key
    expect(saved(storage).items).toEqual([]);
  });

  it('never sends a request whose in-flight marker could not be saved', async () => {
    const storage = await seeded(['/orders/a']);
    const queue = newQueue(storage);
    await queue.load();
    const { replay } = recorder();
    storage.failNextWrite = true;
    await expect(queue.sync('K7Q2XM', replay)).rejects.toThrow('write failed');
    expect(replay).not.toHaveBeenCalled();
  });

  it('a failed write while queueing reports the error and keeps the queue consistent', async () => {
    const storage = await seeded(['/orders/a']);
    const queue = newQueue(storage);
    await queue.load();
    storage.failNextWrite = true;
    await expect(queue.enqueue(input('/orders/b'))).rejects.toThrow('write failed');
    const next = await queue.enqueue(input('/orders/c'));
    expect(next.seq).toBe(2);
    expect(savedPaths(storage)).toEqual(['/orders/a', '/orders/c']);
  });
});

describe('enqueue failures during a batch', () => {
  const plan: BatchPlan = { endpoints: [makePairedEndpoint({ method: 'POST', path: '/orders' })], requestsPerEndpoint: 2, timeoutMs: 4000, retry: { enabled: false, maxRetries: 0 }, payload: '{}' };
  const deps = (offline: boolean, transport = scriptedTransport(() => ({ status: 201 })).transport) => ({
    baseUrl: 'http://192.168.1.20:4000', platform: 'ios', projectKey: 'K7Q2XM', transport, tracker: new IntegrityTracker(), newId: sequentialIds(),
    isOffline: () => offline,
    enqueue: async () => {
      throw new QueueFullError();
    },
  });

  it('in simulated offline mode, a request the full queue refused is not reported as queued', async () => {
    const results = await runBatch(plan, deps(true), () => undefined);
    expect(results.map((r) => [r.outcome, r.queued])).toEqual([['network_error', null], ['network_error', null]]);
    expect(results[0]?.errorMessage).toMatch(/^Simulated offline mode: not sent, and not queued \(The offline queue is full/);
    expect(summarize(results).queued).toBe(0);
  });

  it('a network error the full queue refused keeps its own error and explains it was not queued', async () => {
    const { transport } = scriptedTransport(() => new TransportError('network', 'Network request failed (server unreachable or offline)', 5));
    const results = await runBatch(plan, deps(false, transport), () => undefined);
    expect(results[0]).toMatchObject({ outcome: 'network_error', queued: null });
    expect(results[0]?.errorMessage).toMatch(/^Network request failed \(server unreachable or offline\)\. Not queued: The offline queue is full/);
    expect(summarize(results).queued).toBe(0);
  });
});

describe('invalid project keys', () => {
  it.each([
    ['lowercase', 'k7q2xm'],
    ['symbol', 'K7Q2X!'],
    ['space', 'K7Q 2X'],
    ['dash', 'K7Q-2X'],
    ['non-ASCII letter', 'K7Q2XÄ'],
    ['full-width letter', 'Ｋ7Q2XM'],
    ['trailing newline', 'K7Q2X\n'],
    ['5 characters', 'K7Q2X'],
    ['7 characters', 'K7Q2XMM'],
    ['empty', ''],
    ['path traversal', '../../'],
  ])('pairing refuses a %s key without any network call', async (_name, key) => {
    const { transport, requests } = scriptedTransport(() => ({ status: 200 }));
    await expect(createPocketChaosApi('http://192.168.1.20:4000', transport).pair(key)).rejects.toMatchObject({ code: 'INVALID_PROJECT_KEY' });
    expect(requests).toHaveLength(0);
  });

  it('the key field sanitises what can be fixed and drops what cannot', () => {
    expect(sanitizeProjectKey(' k7q-2x m ')).toBe('K7Q2XM');
    expect(sanitizeProjectKey('K7Q2XÄ')).toBe('K7Q2X');
    expect(sanitizeProjectKey('Ｋ7Q2XM')).toBe('7Q2XM');
  });

  it.each([
    ['an invalid project key', { projectKey: 'k7q2x!' }],
    ['a project key with a path', { projectKey: '../api' }],
    ['a path that climbs out of the proxy', { path: '/../../api/auth/login' }],
    ['an encoded climbing path', { path: '/orders/%2e%2e/%2E%2E/api' }],
  ])('treats stored items with %s as corrupt storage (never replayed)', async (_name, tamper) => {
    const storage = new MemoryStorage();
    const item = { ...input('/orders'), id: 'a', seq: 1, createdAt: '2026-10-21T10:00:00.000Z', attempts: 0, lastError: null, inFlightSince: null, ...tamper };
    storage.data.set(QUEUE_STORAGE_KEY, JSON.stringify({ version: 1, nextSeq: 2, items: [item], failed: [] }));
    const onCorruptStorage = jest.fn();
    const queue = newQueue(storage, onCorruptStorage);

    await expect(queue.load()).resolves.toMatchObject({ items: [] });
    expect(onCorruptStorage).toHaveBeenCalledTimes(1);
  });
});
