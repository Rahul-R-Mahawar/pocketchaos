import { MemoryStorage, sequentialIds } from '../test/fakes';
import {
  MAX_QUEUE_ITEMS,
  OfflineQueue,
  QUEUE_STORAGE_KEY,
  QueueFullError,
  type EnqueueInput,
  type QueuedRequest,
  type ReplayOutcome,
} from './offlineQueue';

const input = (path: string, overrides: Partial<EnqueueInput> = {}): EnqueueInput => ({
  projectKey: 'K7Q2XM',
  endpointId: 'e1',
  endpointName: 'Orders',
  method: 'POST',
  path,
  body: '{"qty":1}',
  reason: 'simulated_offline',
  ...overrides,
});

async function setup(storage = new MemoryStorage()) {
  const queue = new OfflineQueue(storage, { newId: sequentialIds(), now: () => new Date('2026-10-21T10:00:00.000Z') });
  await queue.load();
  return { queue, storage };
}

const persisted = (storage: MemoryStorage) => JSON.parse(storage.data.get(QUEUE_STORAGE_KEY) ?? 'null');
const deliverAll = async (): Promise<ReplayOutcome> => ({ kind: 'delivered', status: 201 });

describe('OfflineQueue persistence', () => {
  it('stores timestamp, method, relative path, payload and an idempotency id, and survives a restart', async () => {
    const { queue, storage } = await setup();
    const item = await queue.enqueue(input('/orders'));
    expect(item).toMatchObject({
      id: 'id-1',
      seq: 1,
      method: 'POST',
      path: '/orders',
      body: '{"qty":1}',
      createdAt: '2026-10-21T10:00:00.000Z',
      attempts: 0,
    });

    const { queue: reloaded } = await setup(storage);
    expect(reloaded.snapshot.items).toEqual([item]);
  });

  it('never loses an enqueue when many happen at once', async () => {
    const storage = new MemoryStorage();
    storage.delayMs = 2;
    const { queue } = await setup(storage);
    await Promise.all(Array.from({ length: 25 }, (_, i) => queue.enqueue(input(`/orders/${i}`))));

    const saved = persisted(storage);
    expect(saved.items).toHaveLength(25);
    expect(saved.items.map((item: QueuedRequest) => item.seq)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(new Set(saved.items.map((item: QueuedRequest) => item.id)).size).toBe(25);
  });

  it('refuses to grow past the cap', async () => {
    const { queue } = await setup();
    for (let i = 0; i < MAX_QUEUE_ITEMS; i += 1) await queue.enqueue(input(`/o/${i}`));
    await expect(queue.enqueue(input('/one-too-many'))).rejects.toBeInstanceOf(QueueFullError);
    expect(queue.snapshot.items).toHaveLength(MAX_QUEUE_ITEMS);
  });

  it('resets corrupted storage instead of crashing', async () => {
    const storage = new MemoryStorage();
    storage.data.set(QUEUE_STORAGE_KEY, JSON.stringify({ version: 1, nextSeq: 'x', items: 'nope' }));
    const onCorruptStorage = jest.fn();
    const queue = new OfflineQueue(storage, { newId: sequentialIds(), onCorruptStorage });
    await expect(queue.load()).resolves.toMatchObject({ items: [] });
    expect(onCorruptStorage).toHaveBeenCalled();
  });

  it('does not wipe the saved queue when a read fails', async () => {
    const { queue: first, storage } = await setup();
    await first.enqueue(input('/orders'));
    storage.failNextRead = true;
    const second = new OfflineQueue(storage, { newId: sequentialIds() });
    await expect(second.load()).rejects.toThrow('read failed');
    expect(persisted(storage).items).toHaveLength(1);
  });

  it('keeps the previous state when a write fails', async () => {
    const { queue, storage } = await setup();
    await queue.enqueue(input('/a'));
    storage.failNextWrite = true;
    await expect(queue.enqueue(input('/b'))).rejects.toThrow('write failed');
    expect(queue.snapshot.items.map((item) => item.path)).toEqual(['/a']);
    await queue.enqueue(input('/c'));
    expect(persisted(storage).items.map((item: QueuedRequest) => item.path)).toEqual(['/a', '/c']);
  });

  it('resets in-flight markers left by a crash, so those requests replay again (at-least-once)', async () => {
    const storage = new MemoryStorage();
    storage.data.set(
      QUEUE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        nextSeq: 2,
        failed: [],
        items: [{ ...input('/orders'), id: 'a', seq: 1, createdAt: 'x', attempts: 0, lastError: null, inFlightSince: '2026-10-21T09:59:00.000Z' }],
      }),
    );
    const { queue } = await setup(storage);
    expect(queue.snapshot.items[0]?.inFlightSince).toBeNull();
  });
});

describe('OfflineQueue sync', () => {
  it('replays in sequence order, removing each delivered item as it goes', async () => {
    const { queue, storage } = await setup();
    for (const path of ['/a', '/b', '/c']) await queue.enqueue(input(path));
    const replayed: string[] = [];
    const progress: number[] = [];

    const report = await queue.sync(
      'K7Q2XM',
      async (item) => {
        replayed.push(item.path);
        expect(persisted(storage).items.find((i: QueuedRequest) => i.id === item.id)?.inFlightSince).not.toBeNull();
        return { kind: 'delivered', status: 201 };
      },
      (p) => progress.push(p.done),
    );

    expect(replayed).toEqual(['/a', '/b', '/c']);
    expect(report).toMatchObject({ total: 3, done: 3, delivered: 3, rejected: 0, stopped: null });
    expect(persisted(storage).items).toEqual([]);
    expect(progress.at(-1)).toBe(3);
  });

  it('stops at the first network failure and keeps the remaining order intact', async () => {
    const { queue } = await setup();
    for (const path of ['/a', '/b', '/c']) await queue.enqueue(input(path));
    const report = await queue.sync('K7Q2XM', async (item) =>
      item.path === '/b' ? { kind: 'retryLater', error: 'HTTP 503' } : { kind: 'delivered', status: 200 },
    );

    expect(report).toMatchObject({ delivered: 1, stopped: { error: 'HTTP 503' } });
    expect(queue.snapshot.items.map((i) => [i.path, i.attempts, i.lastError, i.inFlightSince])).toEqual([
      ['/b', 1, 'HTTP 503', null],
      ['/c', 0, null, null],
    ]);
  });

  it('treats a throwing replay as "retry later", never as delivered', async () => {
    const { queue } = await setup();
    await queue.enqueue(input('/a'));
    const report = await queue.sync('K7Q2XM', async () => {
      throw new Error('socket hang up');
    });
    expect(report.stopped?.error).toBe('socket hang up');
    expect(queue.snapshot.items).toHaveLength(1);
  });

  it('moves permanently rejected (4xx) requests to the failed list instead of retrying forever', async () => {
    const { queue } = await setup();
    await queue.enqueue(input('/bad'));
    await queue.enqueue(input('/good'));
    const report = await queue.sync('K7Q2XM', async (item) =>
      item.path === '/bad' ? { kind: 'rejected', status: 422 } : { kind: 'delivered', status: 201 },
    );
    expect(report).toMatchObject({ delivered: 1, rejected: 1 });
    expect(queue.snapshot.items).toEqual([]);
    expect(queue.snapshot.failed).toEqual([expect.objectContaining({ path: '/bad', status: 422, lastError: 'HTTP 422' })]);
  });

  it('runs a single sync at a time: concurrent replays send each request exactly once', async () => {
    const { queue } = await setup();
    for (const path of ['/a', '/b', '/c']) await queue.enqueue(input(path));
    const sent: string[] = [];
    const replay = async (item: QueuedRequest): Promise<ReplayOutcome> => {
      sent.push(item.id);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { kind: 'delivered', status: 200 };
    };

    const [first, second, third] = await Promise.all([
      queue.sync('K7Q2XM', replay),
      queue.sync('K7Q2XM', replay),
      queue.sync('K7Q2XM', replay),
    ]);

    expect(sent).toEqual(['id-1', 'id-2', 'id-3']);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(queue.isSyncing).toBe(false);
  });

  it('keeps requests queued during a sync for the next sync (snapshot semantics)', async () => {
    const { queue, storage } = await setup();
    await queue.enqueue(input('/a'));
    const sent: string[] = [];
    const report = await queue.sync('K7Q2XM', async (item) => {
      sent.push(item.path);
      await queue.enqueue(input('/added-during-sync'));
      return { kind: 'delivered', status: 200 };
    });

    expect(sent).toEqual(['/a']);
    expect(report.total).toBe(1);
    expect(persisted(storage).items.map((i: QueuedRequest) => i.path)).toEqual(['/added-during-sync']);

    await queue.sync('K7Q2XM', deliverAll);
    expect(queue.snapshot.items).toEqual([]);
  });

  it('skips (and keeps) requests queued for another project', async () => {
    const { queue } = await setup();
    await queue.enqueue(input('/mine'));
    await queue.enqueue(input('/theirs', { projectKey: 'OTHER1' }));
    const report = await queue.sync('K7Q2XM', deliverAll);
    expect(report).toMatchObject({ delivered: 1, skippedOtherProjects: 1 });
    expect(queue.snapshot.items.map((i) => i.path)).toEqual(['/theirs']);
  });

  it('does not replay an item cleared while the sync was running', async () => {
    const { queue } = await setup();
    await queue.enqueue(input('/a'));
    await queue.enqueue(input('/b'));
    const sent: string[] = [];
    await queue.sync('K7Q2XM', async (item) => {
      sent.push(item.path);
      if (item.path === '/a') await queue.remove('id-2');
      return { kind: 'delivered', status: 200 };
    });
    expect(sent).toEqual(['/a']);
  });
});
