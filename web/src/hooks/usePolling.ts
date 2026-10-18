import { useEffect, useRef, useState } from 'react';
import { toApiError, type ApiError } from '../api/errors';

export interface PollingOptions {
  intervalMs: number;
  enabled?: boolean;
  /** Longest wait after repeated 429s. */
  maxBackoffMs?: number;
  onError?: (error: ApiError) => void;
}

export interface PollingState<T> {
  data: T | undefined;
  error: ApiError | null;
  lastUpdatedAt: number | null;
}

/**
 * Polls `fetcher` every `intervalMs` using a setTimeout chain, so a slow response never overlaps the next
 * request. Skips ticks while the tab is hidden, backs off on 429, keeps the last good data on errors and
 * aborts the in-flight request on unmount (safe under React StrictMode's double mount).
 */
export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  { intervalMs, enabled = true, maxBackoffMs = 30_000, onError }: PollingOptions,
): PollingState<T> {
  const [state, setState] = useState<PollingState<T>>({ data: undefined, error: null, lastUpdatedAt: null });
  const fetcherRef = useRef(fetcher);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    fetcherRef.current = fetcher;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = intervalMs;

    const schedule = (ms: number) => {
      if (!controller.signal.aborted) timer = setTimeout(tick, ms);
    };

    async function tick() {
      if (document.visibilityState === 'hidden') {
        schedule(intervalMs);
        return;
      }
      try {
        const data = await fetcherRef.current(controller.signal);
        if (controller.signal.aborted) return;
        delay = intervalMs;
        setState({ data, error: null, lastUpdatedAt: Date.now() });
      } catch (raw) {
        if (controller.signal.aborted) return;
        const error = toApiError(raw);
        delay = error.status === 429 ? Math.min(Math.max(delay, intervalMs) * 2, maxBackoffMs) : intervalMs;
        setState((previous) => ({ ...previous, error }));
        onErrorRef.current?.(error);
      }
      schedule(delay);
    }

    void tick();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, intervalMs, maxBackoffMs]);

  return state;
}
