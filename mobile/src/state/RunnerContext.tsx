import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { newId as defaultNewId } from '../lib/ids';
import {
  IntegrityTracker,
  planCost,
  runBatch,
  summarize,
  validatePlan,
  type BatchPlan,
  type BatchSummary,
  type RunResult,
} from '../runner/batchRunner';
import type { ResilienceDeps } from '../resilience/resilientRequest';
import { useConfig } from './ConfigContext';
import { useQueue } from './QueueContext';

export const BATCH_SIZES = [5, 10, 20] as const;
export const TIMEOUT_OPTIONS = [2_000, 4_000, 8_000, 12_000] as const;
export const RETRY_OPTIONS = [0, 1, 2, 3] as const;

export interface RunnerSettings {
  /** 'all' or an endpoint id. */
  target: string;
  requestsPerEndpoint: (typeof BATCH_SIZES)[number];
  timeoutMs: (typeof TIMEOUT_OPTIONS)[number];
  retryEnabled: boolean;
  maxRetries: (typeof RETRY_OPTIONS)[number];
  payload: string;
}

interface RunnerContextValue {
  settings: RunnerSettings;
  update: (patch: Partial<RunnerSettings>) => void;
  plan: BatchPlan | null;
  planError: string | null;
  cost: { requests: number; worstCaseAttempts: number };
  results: RunResult[];
  summary: BatchSummary;
  running: boolean;
  runError: string | null;
  run: () => Promise<void>;
  stop: () => void;
  clear: () => void;
}

const RunnerContext = createContext<RunnerContextValue | null>(null);

export function useRunner(): RunnerContextValue {
  const value = useContext(RunnerContext);
  if (!value) throw new Error('useRunner must be used inside <RunnerProvider>');
  return value;
}

export function RunnerProvider({
  children,
  newId = defaultNewId,
  resilience,
}: {
  children: ReactNode;
  newId?: () => string;
  resilience?: ResilienceDeps;
}) {
  const { baseUrl, pairing, transport } = useConfig();
  const { isOffline, enqueue } = useQueue();
  const [settings, setSettings] = useState<RunnerSettings>({
    target: 'all',
    requestsPerEndpoint: 5,
    timeoutMs: 4_000,
    retryEnabled: true,
    maxRetries: 2,
    payload: '{\n  "source": "pocketchaos-mobile"\n}',
  });
  const [results, setResults] = useState<RunResult[]>([]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  // Set synchronously: two taps in the same frame both see `running === false` in their render's closure.
  const runningRef = useRef(false);
  const tracker = useRef(new IntegrityTracker());

  const projectKey = pairing.status === 'paired' ? pairing.data.projectKey : null;
  // A different project means different endpoints: learned baselines no longer apply.
  useEffect(() => {
    tracker.current.reset();
    setResults([]);
  }, [projectKey]);

  const plan = useMemo<BatchPlan | null>(() => {
    if (pairing.status !== 'paired') return null;
    const endpoints = settings.target === 'all' ? pairing.data.endpoints : pairing.data.endpoints.filter((e) => e.id === settings.target);
    return {
      endpoints,
      requestsPerEndpoint: settings.requestsPerEndpoint,
      timeoutMs: settings.timeoutMs,
      retry: { enabled: settings.retryEnabled, maxRetries: settings.maxRetries },
      payload: settings.payload,
    };
  }, [pairing, settings]);

  const planError = plan ? validatePlan(plan) : 'Pair with a project on the Pair tab first';

  const run = useCallback(async () => {
    if (!plan || planError || !baseUrl || pairing.status !== 'paired' || runningRef.current) return;
    runningRef.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setRunError(null);
    setResults([]);
    try {
      const final = await runBatch(
        plan,
        {
          baseUrl,
          platform: Platform.OS,
          projectKey: pairing.data.projectKey,
          transport,
          tracker: tracker.current,
          newId,
          isOffline,
          enqueue,
          signal: abort.signal,
          ...(resilience ? { resilience } : {}),
        },
        (result) => setResults((current) => [...current, result]),
      );
      setResults(final);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'The batch stopped unexpectedly');
    } finally {
      runningRef.current = false;
      controller.current = null;
      setRunning(false);
    }
  }, [baseUrl, enqueue, isOffline, newId, pairing, plan, planError, resilience, transport]);

  const value = useMemo<RunnerContextValue>(
    () => ({
      settings,
      update: (patch) => setSettings((current) => ({ ...current, ...patch })),
      plan,
      planError,
      cost: plan ? planCost(plan) : { requests: 0, worstCaseAttempts: 0 },
      results,
      summary: summarize(results),
      running,
      runError,
      run,
      stop: () => controller.current?.abort(),
      clear: () => setResults([]),
    }),
    [settings, plan, planError, results, running, runError, run],
  );

  return <RunnerContext.Provider value={value}>{children}</RunnerContext.Provider>;
}
