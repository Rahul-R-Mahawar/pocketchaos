import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { newId as defaultNewId } from '../lib/ids';
import {
  OfflineQueue,
  type EnqueueInput,
  type FailedQueueItem,
  type QueuedRequest,
  type ReplayOutcome,
  type StorageLike,
  type SyncProgress,
  type SyncReport,
} from '../queue/offlineQueue';
import { executeResilient } from '../resilience/resilientRequest';
import { buildHeaders, toRunResult, type RunResult } from '../runner/batchRunner';
import { useConfig } from './ConfigContext';

const SIMULATE_OFFLINE_KEY = '@pocketchaos/simulate-offline/v1';
export const REPLAY_TIMEOUT_MS = 8_000;
const MAX_REPLAY_RESULTS = 100;

interface QueueContextValue {
  ready: boolean;
  items: QueuedRequest[];
  failed: FailedQueueItem[];
  simulateOffline: boolean;
  setSimulateOffline: (value: boolean) => void;
  /** Current value, readable mid-operation (between requests), before React re-renders. */
  isOffline: () => boolean;
  syncing: boolean;
  progress: SyncProgress | null;
  lastReport: SyncReport | null;
  replayResults: RunResult[];
  notice: string | null;
  enqueue: (input: EnqueueInput) => Promise<QueuedRequest>;
  replay: () => Promise<void>;
  clear: () => Promise<void>;
  clearFailed: () => Promise<void>;
}

const QueueContext = createContext<QueueContextValue | null>(null);

export function useQueue(): QueueContextValue {
  const value = useContext(QueueContext);
  if (!value) throw new Error('useQueue must be used inside <QueueProvider>');
  return value;
}

/** Maps a replay response to the queue's decision: delivered, permanently rejected, or try again later. */
export function replayDecision(result: RunResult): ReplayOutcome {
  if (result.status === null) return { kind: 'retryLater', error: result.errorMessage ?? 'No response' };
  if (result.status >= 200 && result.status < 400) return { kind: 'delivered', status: result.status };
  if (result.status >= 500 || result.status === 429 || result.status === 408) return { kind: 'retryLater', error: `HTTP ${result.status}` };
  return { kind: 'rejected', status: result.status };
}

export function QueueProvider({
  children,
  storage = AsyncStorage,
  newId = defaultNewId,
}: {
  children: ReactNode;
  storage?: StorageLike;
  newId?: () => string;
}) {
  const { baseUrl, pairing, transport } = useConfig();
  const [notice, setNotice] = useState<string | null>(null);
  const queue = useMemo(
    () =>
      new OfflineQueue(storage, {
        newId,
        onCorruptStorage: () => setNotice('The saved offline queue was unreadable and has been reset.'),
      }),
    [storage, newId],
  );
  const [snapshot, setSnapshot] = useState(queue.snapshot);
  const [ready, setReady] = useState(false);
  const [simulateOffline, setSimulateOfflineState] = useState(false);
  const offlineRef = useRef(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const [replayResults, setReplayResults] = useState<RunResult[]>([]);
  const replaySeq = useRef(0);

  useEffect(() => {
    const unsubscribe = queue.subscribe(setSnapshot);
    queue
      .load()
      .catch(() => setNotice('Could not read the saved offline queue. It was left untouched and is read again before the next change.'))
      .finally(() => setReady(true));
    storage
      .getItem(SIMULATE_OFFLINE_KEY)
      .then((raw) => {
        offlineRef.current = raw === 'true';
        setSimulateOfflineState(raw === 'true');
      })
      .catch(() => undefined);
    return unsubscribe;
  }, [queue, storage]);

  const setSimulateOffline = useCallback(
    (value: boolean) => {
      offlineRef.current = value;
      setSimulateOfflineState(value);
      storage.setItem(SIMULATE_OFFLINE_KEY, String(value)).catch(() => undefined);
    },
    [storage],
  );

  const isOffline = useCallback(() => offlineRef.current, []);

  const replayOne = useCallback(
    async (item: QueuedRequest): Promise<ReplayOutcome> => {
      // Checked per item: switching offline mode on mid-replay must stop the requests that follow.
      if (offlineRef.current) return { kind: 'retryLater', error: 'Simulated offline mode is on' };
      if (!baseUrl) return { kind: 'retryLater', error: 'No backend URL configured' };
      const url = `${baseUrl}/proxy/${item.projectKey}${item.path}`;
      const headers = buildHeaders(item.id, Platform.OS, item.body !== null);
      const outcome = await executeResilient(
        { url, method: item.method, headers, ...(item.body !== null ? { body: item.body } : {}), timeoutMs: REPLAY_TIMEOUT_MS },
        transport,
        { enabled: false, maxRetries: 0 },
      );
      replaySeq.current += 1;
      const result = toRunResult(
        { id: item.id, seq: replaySeq.current, source: 'replay', endpointId: item.endpointId, endpointName: item.endpointName, method: item.method, path: item.path, url, headers, body: item.body },
        outcome,
        new Date().toISOString(),
      );
      setReplayResults((current) => [result, ...current].slice(0, MAX_REPLAY_RESULTS));
      return replayDecision(result);
    },
    [baseUrl, transport],
  );

  const replay = useCallback(async () => {
    if (simulateOffline) {
      setNotice('Turn off "Simulate Offline Mode" to replay the queue.');
      return;
    }
    if (pairing.status !== 'paired') {
      setNotice('Pair a project first.');
      return;
    }
    setNotice(null);
    setSyncing(true);
    try {
      const report = await queue.sync(pairing.data.projectKey, replayOne, setProgress);
      setLastReport(report);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      setNotice(`Sync stopped: ${reason}. Unconfirmed requests stay queued and are re-sent with the same Idempotency-Key.`);
    } finally {
      setSyncing(queue.isSyncing);
      setProgress(null);
    }
  }, [pairing, queue, replayOne, simulateOffline]);

  const value = useMemo<QueueContextValue>(
    () => ({
      ready,
      items: snapshot.items,
      failed: snapshot.failed,
      simulateOffline,
      setSimulateOffline,
      isOffline,
      syncing,
      progress,
      lastReport,
      replayResults,
      notice,
      enqueue: (input) => queue.enqueue(input),
      replay,
      clear: async () => {
        await queue.clear();
      },
      clearFailed: async () => {
        await queue.clearFailed();
      },
    }),
    [ready, snapshot, simulateOffline, setSimulateOffline, isOffline, syncing, progress, lastReport, replayResults, notice, queue, replay],
  );

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}
