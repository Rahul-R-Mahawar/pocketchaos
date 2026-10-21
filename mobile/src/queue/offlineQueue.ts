import { z } from 'zod';
import { PROJECT_KEY_PATTERN } from '../api/pocketChaosApi';
import { isSafeAbsolutePath } from '../lib/paths';

/**
 * Deterministic offline queue persisted in AsyncStorage.
 *
 * Duplicate-replay and lost-update guarantees:
 *  - One writer: every mutation runs on a single promise chain against the in-memory state, which is then
 *    persisted. AsyncStorage is never read-modified-written concurrently (enqueue during a sync is safe).
 *  - No blind writes: until the saved queue has been read successfully, every mutation re-reads it first, so
 *    a transient read failure can never be followed by a write that replaces the saved queue.
 *  - One sync: a second replay request while one is running gets the same promise (single flight).
 *  - Fixed order: a sync snapshots the queue at start and replays by a persisted sequence number, never by
 *    wall-clock time. Items queued during a sync wait for the next one.
 *  - Crash safety: each item is marked in-flight (persisted) before it is sent and removed (persisted) after a
 *    final answer. Stale in-flight markers are reset on load, so replay is at-least-once. Every item carries
 *    an Idempotency-Key (its id), reused on every replay, so a server can drop the duplicate.
 */
export const QUEUE_STORAGE_KEY = '@pocketchaos/offline-queue/v1';
export const MAX_QUEUE_ITEMS = 200;
export const MAX_FAILED_ITEMS = 50;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const REASONS = ['simulated_offline', 'network_error', 'timeout', 'http_503'] as const;

const queuedRequestSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  projectKey: z.string().regex(PROJECT_KEY_PATTERN),
  endpointId: z.string().nullable(),
  endpointName: z.string(),
  method: z.enum(METHODS),
  /** Relative to the proxy base (/proxy/:projectKey). The backend URL may change before replay. */
  path: z.string().refine(isSafeAbsolutePath, 'Expected an absolute path without dot segments'),
  body: z.string().nullable(),
  createdAt: z.string(),
  reason: z.enum(REASONS),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  inFlightSince: z.string().nullable(),
});

const failedItemSchema = queuedRequestSchema.extend({ failedAt: z.string(), status: z.number().int() });

const queueStateSchema = z.object({
  version: z.literal(1),
  nextSeq: z.number().int().nonnegative(),
  items: z.array(queuedRequestSchema),
  failed: z.array(failedItemSchema),
});

export type QueuedRequest = z.infer<typeof queuedRequestSchema>;
export type FailedQueueItem = z.infer<typeof failedItemSchema>;
export type QueueState = z.infer<typeof queueStateSchema>;
export type QueueReason = (typeof REASONS)[number];

export type EnqueueInput = Pick<QueuedRequest, 'projectKey' | 'endpointId' | 'endpointName' | 'method' | 'path' | 'body' | 'reason'>;

export interface StorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** What a replay attempt produced. `retryLater` stops the sync and keeps the queue order. */
export type ReplayOutcome =
  | { kind: 'delivered'; status: number }
  | { kind: 'rejected'; status: number }
  | { kind: 'retryLater'; error: string };

export interface SyncProgress {
  total: number;
  done: number;
  current: QueuedRequest | null;
  delivered: number;
  rejected: number;
}

export interface SyncReport extends SyncProgress {
  stopped: { item: QueuedRequest; error: string } | null;
  skippedOtherProjects: number;
}

export class QueueFullError extends Error {
  constructor() {
    super(`The offline queue is full (${MAX_QUEUE_ITEMS} requests). Replay or clear it first.`);
    this.name = 'QueueFullError';
  }
}

const emptyState = (): QueueState => ({ version: 1, nextSeq: 1, items: [], failed: [] });

export interface OfflineQueueOptions {
  now?: () => Date;
  newId: () => string;
  onCorruptStorage?: () => void;
}

export class OfflineQueue {
  private state: QueueState = emptyState();
  /** True once the saved queue has been read (or replaced) successfully. */
  private loaded = false;
  private chain: Promise<unknown> = Promise.resolve();
  private activeSync: Promise<SyncReport> | null = null;
  private readonly listeners = new Set<(state: QueueState) => void>();
  private readonly now: () => Date;

  constructor(
    private readonly storage: StorageLike,
    private readonly options: OfflineQueueOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  get snapshot(): QueueState {
    return this.state;
  }

  get isSyncing(): boolean {
    return this.activeSync !== null;
  }

  subscribe(listener: (state: QueueState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Loads persisted state. Corrupt data resets the queue instead of crashing the app; a failed *read* rejects
   * without writing, and later mutations retry the read first, so a transient storage error can never wipe a
   * saved queue.
   */
  load(): Promise<QueueState> {
    return this.mutate((state) => state, { reload: true });
  }

  private async readSaved(): Promise<QueueState> {
    const raw = await this.storage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return emptyState();
    let parsed: QueueState;
    try {
      parsed = queueStateSchema.parse(JSON.parse(raw));
    } catch {
      this.options.onCorruptStorage?.();
      return emptyState();
    }
    // Nothing can be in flight right after a (re)start: those items go back to pending.
    return { ...parsed, items: parsed.items.map((item) => ({ ...item, inFlightSince: null })) };
  }

  enqueue(input: EnqueueInput): Promise<QueuedRequest> {
    let created: QueuedRequest | undefined;
    return this.mutate((state) => {
      if (state.items.length >= MAX_QUEUE_ITEMS) throw new QueueFullError();
      created = {
        ...input,
        id: this.options.newId(),
        seq: state.nextSeq,
        createdAt: this.now().toISOString(),
        attempts: 0,
        lastError: null,
        inFlightSince: null,
      };
      return { ...state, nextSeq: state.nextSeq + 1, items: [...state.items, created] };
    }).then(() => created as QueuedRequest);
  }

  remove(id: string): Promise<QueueState> {
    return this.mutate((state) => ({ ...state, items: state.items.filter((item) => item.id !== id) }));
  }

  clear(): Promise<QueueState> {
    return this.mutate((state) => ({ ...state, items: [], failed: [] }));
  }

  clearFailed(): Promise<QueueState> {
    return this.mutate((state) => ({ ...state, failed: [] }));
  }

  /**
   * Replays queued requests for `projectKey` in sequence order, one at a time. Concurrent calls share
   * the running sync. Stops at the first `retryLater` (connectivity has not recovered).
   */
  sync(
    projectKey: string,
    replay: (item: QueuedRequest) => Promise<ReplayOutcome>,
    onProgress?: (progress: SyncProgress) => void,
  ): Promise<SyncReport> {
    if (this.activeSync) return this.activeSync;
    this.activeSync = this.runSync(projectKey, replay, onProgress).finally(() => {
      this.activeSync = null;
    });
    return this.activeSync;
  }

  private async runSync(
    projectKey: string,
    replay: (item: QueuedRequest) => Promise<ReplayOutcome>,
    onProgress?: (progress: SyncProgress) => void,
  ): Promise<SyncReport> {
    await this.chain.catch(() => undefined); // let pending writes land before taking the snapshot
    if (!this.loaded) await this.load(); // never report an unreadable queue as empty
    const all = [...this.state.items].sort((a, b) => a.seq - b.seq);
    const batch = all.filter((item) => item.projectKey === projectKey);
    const report: SyncReport = {
      total: batch.length,
      done: 0,
      current: null,
      delivered: 0,
      rejected: 0,
      stopped: null,
      skippedOtherProjects: all.length - batch.length,
    };
    const emit = () => onProgress?.({ total: report.total, done: report.done, current: report.current, delivered: report.delivered, rejected: report.rejected });

    for (const queued of batch) {
      // The item may have been removed (e.g. "clear") since the snapshot was taken.
      if (!this.state.items.some((item) => item.id === queued.id)) continue;
      const startedAt = this.now().toISOString();
      await this.mutate((state) => ({
        ...state,
        items: state.items.map((item) => (item.id === queued.id ? { ...item, inFlightSince: startedAt } : item)),
      }));
      report.current = queued;
      emit();

      let outcome: ReplayOutcome;
      try {
        outcome = await replay(queued);
      } catch (error) {
        outcome = { kind: 'retryLater', error: error instanceof Error ? error.message : 'Replay failed' };
      }

      if (outcome.kind === 'retryLater') {
        await this.mutate((state) => ({
          ...state,
          items: state.items.map((item) =>
            item.id === queued.id
              ? { ...item, inFlightSince: null, attempts: item.attempts + 1, lastError: outcome.error }
              : item,
          ),
        }));
        report.stopped = { item: queued, error: outcome.error };
        report.current = null;
        emit();
        return report;
      }

      const finishedAt = this.now().toISOString();
      await this.mutate((state) => {
        const items = state.items.filter((item) => item.id !== queued.id);
        if (outcome.kind === 'delivered') return { ...state, items };
        const failed = [
          { ...queued, inFlightSince: null, attempts: queued.attempts + 1, failedAt: finishedAt, status: outcome.status, lastError: `HTTP ${outcome.status}` },
          ...state.failed,
        ].slice(0, MAX_FAILED_ITEMS);
        return { ...state, items, failed };
      });
      if (outcome.kind === 'delivered') report.delivered += 1;
      else report.rejected += 1;
      report.done += 1;
      emit();
    }

    report.current = null;
    emit();
    return report;
  }

  /**
   * Serialises every state change and its persistence. A failed read or write leaves the in-memory state
   * unchanged; until a read has succeeded, each change starts from a fresh read of the saved queue.
   */
  private mutate(change: (state: QueueState) => QueueState | Promise<QueueState>, { reload = false } = {}): Promise<QueueState> {
    const run = this.chain.then(async () => {
      const base = reload || !this.loaded ? await this.readSaved() : this.state;
      const next = await change(base);
      await this.storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(next));
      this.state = next;
      this.loaded = true;
      for (const listener of this.listeners) listener(next);
      return next;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}
