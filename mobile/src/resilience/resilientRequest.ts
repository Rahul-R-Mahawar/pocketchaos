import { TransportError, type HttpRequest, type HttpResponse, type Transport } from '../api/http';

/**
 * Client Resilience Wrapper: per-attempt timeout plus optional exponential-backoff retries.
 *
 * Retried: network errors, timeouts, 5xx and 429. Never retried: other 4xx (the request itself is wrong).
 * Caution for real apps: retrying a non-idempotent POST can create duplicates upstream, which is why every
 * logical request carries one Idempotency-Key that is reused across its retries.
 */
export const MAX_RETRIES = 3;
export const BASE_BACKOFF_MS = 300;
export const MAX_BACKOFF_MS = 4_000;

export interface RetryPolicy {
  enabled: boolean;
  /** 0–3 extra attempts after the first. */
  maxRetries: number;
}

export interface AttemptRecord {
  attempt: number;
  status: number | null;
  error: 'timeout' | 'network' | null;
  latencyMs: number;
  /** Backoff waited before this attempt (0 for the first). */
  waitedMs: number;
}

export type ResilientOutcome =
  | { kind: 'response'; response: HttpResponse; attempts: AttemptRecord[] }
  | { kind: 'timeout' | 'network'; message: string; attempts: AttemptRecord[] }
  | { kind: 'cancelled'; attempts: AttemptRecord[] };

export interface ResilienceDeps {
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  random: () => number;
}

export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/** Retry-After in seconds (the HTTP-date form is ignored), capped to keep a batch responsive. */
export function retryAfterMs(headers: Record<string, string>): number | null {
  const value = headers['retry-after'];
  if (!value || !/^\d+$/.test(value.trim())) return null;
  return Math.min(Number(value) * 1000, MAX_BACKOFF_MS);
}

/** Exponential backoff with jitter: base·2^(n-1), randomised into [50%, 100%], capped. */
export function backoffDelayMs(retryNumber: number, random: () => number): number {
  const exponential = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (retryNumber - 1));
  return Math.round(exponential * (0.5 + 0.5 * Math.min(Math.max(random(), 0), 1)));
}

export const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

export async function executeResilient(
  request: HttpRequest,
  transport: Transport,
  policy: RetryPolicy,
  deps: ResilienceDeps = { sleep: defaultSleep, random: Math.random },
): Promise<ResilientOutcome> {
  const retries = policy.enabled ? Math.min(Math.max(Math.floor(policy.maxRetries), 0), MAX_RETRIES) : 0;
  const attempts: AttemptRecord[] = [];
  let waitedMs = 0;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    if (request.signal?.aborted) return { kind: 'cancelled', attempts };
    let nextWait: number | null = null;

    try {
      const response = await transport(request);
      attempts.push({ attempt, status: response.status, error: null, latencyMs: response.latencyMs, waitedMs });
      if (!isRetryableStatus(response.status) || attempt > retries) return { kind: 'response', response, attempts };
      nextWait = retryAfterMs(response.headers);
    } catch (error) {
      if (!(error instanceof TransportError)) throw error;
      if (error.kind === 'cancelled') return { kind: 'cancelled', attempts };
      attempts.push({ attempt, status: null, error: error.kind, latencyMs: error.latencyMs, waitedMs });
      if (attempt > retries) return { kind: error.kind, message: error.message, attempts };
    }

    waitedMs = nextWait ?? backoffDelayMs(attempt, deps.random);
    await deps.sleep(waitedMs, request.signal);
  }
  // Unreachable: the loop always returns on its last attempt.
  return { kind: 'network', message: 'No attempts were made', attempts };
}
