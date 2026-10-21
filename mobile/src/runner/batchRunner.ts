import type { HttpMethod, HttpRequest, Transport } from '../api/http';
import type { PairedEndpoint } from '../api/pocketChaosApi';
import {
  addSample,
  assessIntegrity,
  emptyStats,
  expectationFromClean,
  expectationFromConsensus,
  injectedCorruptionCount,
  isCleanSample,
  parseBody,
  type Expectation,
  type IntegrityReport,
  type ShapeStats,
} from '../integrity/schemaIntegrity';
import type { EnqueueInput, QueueReason } from '../queue/offlineQueue';
import {
  executeResilient,
  type AttemptRecord,
  type ResilienceDeps,
  type ResilientOutcome,
  type RetryPolicy,
} from '../resilience/resilientRequest';

export type RunOutcome =
  | 'success'
  | 'schema_corruption'
  | 'invalid_json'
  | 'http_4xx'
  | 'http_5xx'
  | 'rate_limited'
  | 'timeout'
  | 'network_error'
  | 'queued_offline'
  | 'cancelled';

export interface RunResult {
  id: string;
  seq: number;
  source: 'batch' | 'replay';
  endpointId: string | null;
  endpointName: string;
  method: HttpMethod;
  path: string;
  url: string;
  startedAt: string;
  outcome: RunOutcome;
  status: number | null;
  /** Latency of the final attempt; null when no response arrived. */
  latencyMs: number | null;
  attempts: AttemptRecord[];
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  responseHeaders: Record<string, string>;
  bodyText: string;
  bodyTruncated: boolean;
  chaosApplied: string | null;
  integrity: IntegrityReport | null;
  /** From X-PocketChaos-Applied; used only to score the detector. */
  injectedCorruption: number;
  queued: QueueReason | null;
  errorMessage: string | null;
}

export const BODY_PREVIEW_LIMIT = 20_000;
export const MAX_REQUESTS_PER_ENDPOINT = 25;
/**
 * Worst-case attempts per batch (requests × (retries + 1)). The proxy allows 600 requests/min per IP, shared
 * with the dashboard and simulators on the same network, so a batch stays well below it.
 */
export const MAX_ATTEMPTS_PER_BATCH = 300;
const WRITE_METHODS: ReadonlySet<HttpMethod> = new Set(['POST', 'PUT', 'PATCH']);

export interface BatchPlan {
  endpoints: PairedEndpoint[];
  requestsPerEndpoint: number;
  timeoutMs: number;
  retry: RetryPolicy;
  /** JSON text sent as the body of POST/PUT/PATCH requests. */
  payload: string;
}

export function planCost(plan: BatchPlan): { requests: number; worstCaseAttempts: number } {
  const requests = plan.endpoints.length * plan.requestsPerEndpoint;
  const retries = plan.retry.enabled ? plan.retry.maxRetries : 0;
  return { requests, worstCaseAttempts: requests * (retries + 1) };
}

export function validatePlan(plan: BatchPlan): string | null {
  if (plan.endpoints.length === 0) return 'Pair a project with at least one endpoint first';
  if (plan.requestsPerEndpoint < 1 || plan.requestsPerEndpoint > MAX_REQUESTS_PER_ENDPOINT) {
    return `Requests per endpoint must be 1–${MAX_REQUESTS_PER_ENDPOINT}`;
  }
  if (planCost(plan).worstCaseAttempts > MAX_ATTEMPTS_PER_BATCH) {
    return `Up to ${planCost(plan).worstCaseAttempts} attempts would exceed the ${MAX_ATTEMPTS_PER_BATCH}-attempt batch limit (proxy rate limit). Lower the count or retries.`;
  }
  if (plan.endpoints.some((endpoint) => WRITE_METHODS.has(endpoint.method))) {
    try {
      JSON.parse(plan.payload);
    } catch {
      return 'The request payload must be valid JSON';
    }
  }
  return null;
}

/** Learns trusted baselines across batches; falls back to batch consensus (see integrity module). */
export class IntegrityTracker {
  private readonly clean = new Map<string, ShapeStats>();

  learnClean(endpointId: string, value: unknown): void {
    const stats = this.clean.get(endpointId) ?? emptyStats();
    addSample(stats, value);
    this.clean.set(endpointId, stats);
  }

  expectation(endpointId: string, batchValues: unknown[]): Expectation | null {
    const clean = this.clean.get(endpointId);
    if (clean && clean.samples > 0) return expectationFromClean(clean);
    const consensus = emptyStats();
    for (const value of batchValues) addSample(consensus, value);
    return expectationFromConsensus(consensus);
  }

  reset(): void {
    this.clean.clear();
  }
}

export function buildHeaders(id: string, platform: string, hasBody: boolean): Record<string, string> {
  return {
    Accept: 'application/json',
    // Requested by the mobile spec; PocketChaos telemetry reads x-pocketchaos-platform for its platform column.
    'x-client-platform': 'react-native',
    'x-pocketchaos-platform': platform,
    // One key per logical request, reused across retries and offline replays.
    'Idempotency-Key': id,
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
  };
}

function classify(outcome: ResilientOutcome, integrity: IntegrityReport | null, chaosApplied: string | null): RunOutcome {
  if (outcome.kind !== 'response') {
    return outcome.kind === 'timeout' ? 'timeout' : outcome.kind === 'network' ? 'network_error' : 'cancelled';
  }
  const { status } = outcome.response;
  if (status === 429 && !/(?:^|,)failure:429/.test(chaosApplied ?? '')) return 'rate_limited';
  if (status >= 500) return 'http_5xx';
  if (status >= 400) return 'http_4xx';
  if (integrity?.verdict === 'SCHEMA_CORRUPTION_DETECTED') return 'schema_corruption';
  if (integrity?.verdict === 'INVALID_JSON') return 'invalid_json';
  return 'success';
}

/** Network failures and 503s are queued for replay. Timeouts are not: delivery is ambiguous. */
export function queueReasonFor(result: Pick<RunResult, 'outcome' | 'status'>): QueueReason | null {
  if (result.outcome === 'network_error') return 'network_error';
  if (result.status === 503) return 'http_503';
  return null;
}

export interface RequestSpec {
  id: string;
  seq: number;
  source: RunResult['source'];
  endpointId: string | null;
  endpointName: string;
  method: HttpMethod;
  path: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

/** Turns a resilient outcome into a RunResult. Integrity is assessed later, once a baseline exists. */
export function toRunResult(spec: RequestSpec, outcome: ResilientOutcome, startedAt: string): RunResult {
  const response = outcome.kind === 'response' ? outcome.response : null;
  const bodyText = response?.bodyText ?? '';
  const chaosApplied = response?.headers['x-pocketchaos-applied'] ?? null;
  const result: RunResult = {
    id: spec.id,
    seq: spec.seq,
    source: spec.source,
    endpointId: spec.endpointId,
    endpointName: spec.endpointName,
    method: spec.method,
    path: spec.path,
    url: spec.url,
    startedAt,
    outcome: 'success',
    status: response?.status ?? null,
    latencyMs: response ? response.latencyMs : null,
    attempts: outcome.attempts,
    requestHeaders: spec.headers,
    requestBody: spec.body,
    responseHeaders: response?.headers ?? {},
    bodyText: bodyText.slice(0, BODY_PREVIEW_LIMIT),
    bodyTruncated: bodyText.length > BODY_PREVIEW_LIMIT,
    chaosApplied,
    integrity: null,
    injectedCorruption: injectedCorruptionCount(chaosApplied),
    queued: null,
    errorMessage: outcome.kind === 'timeout' || outcome.kind === 'network' ? outcome.message : null,
  };
  result.outcome = classify(outcome, null, chaosApplied);
  return result;
}

const isOk = (result: RunResult) => result.status !== null && result.status >= 200 && result.status < 300;

/** (Re)assesses integrity of every 2xx result for one endpoint against the best expectation available. */
export function assessEndpointResults(results: RunResult[], tracker: IntegrityTracker, endpointId: string): RunResult[] {
  const parsedById = new Map(results.filter(isOk).map((result) => [result.id, parseBody(result.bodyText, result.responseHeaders['content-type'])]));
  const values = [...parsedById.values()].flatMap((parsed) => (parsed.kind === 'json' ? [parsed.value] : []));
  const expectation = tracker.expectation(endpointId, values);
  return results.map((result) => {
    const parsed = parsedById.get(result.id);
    if (!parsed || result.bodyTruncated) return result;
    const integrity = assessIntegrity(parsed, expectation);
    const outcome: RunOutcome =
      integrity.verdict === 'SCHEMA_CORRUPTION_DETECTED' ? 'schema_corruption' : integrity.verdict === 'INVALID_JSON' ? 'invalid_json' : 'success';
    return { ...result, integrity, outcome };
  });
}

export interface BatchDeps {
  baseUrl: string;
  platform: string;
  transport: Transport;
  tracker: IntegrityTracker;
  newId: () => string;
  isOffline: () => boolean;
  enqueue: (input: EnqueueInput) => Promise<unknown>;
  projectKey: string;
  resilience?: ResilienceDeps;
  signal?: AbortSignal;
  now?: () => Date;
}

/**
 * Fires the batch sequentially (deterministic order, easy on the rate limiter). Streams each result through
 * `onResult`, then returns the final list after a whole-batch integrity re-assessment.
 */
export async function runBatch(plan: BatchPlan, deps: BatchDeps, onResult: (result: RunResult) => void): Promise<RunResult[]> {
  const now = deps.now ?? (() => new Date());
  const results: RunResult[] = [];
  let seq = 0;

  for (const endpoint of plan.endpoints) {
    const endpointResults: RunResult[] = [];
    for (let i = 0; i < plan.requestsPerEndpoint; i += 1) {
      if (deps.signal?.aborted) break;
      seq += 1;
      const id = deps.newId();
      const body = WRITE_METHODS.has(endpoint.method) ? plan.payload : null;
      const spec: RequestSpec = {
        id,
        seq,
        source: 'batch',
        endpointId: endpoint.id,
        endpointName: endpoint.name,
        method: endpoint.method,
        path: endpoint.path,
        url: `${deps.baseUrl}${endpoint.proxyPath}`,
        headers: buildHeaders(id, deps.platform, body !== null),
        body,
      };
      const startedAt = now().toISOString();
      const enqueueInput: EnqueueInput = {
        projectKey: deps.projectKey,
        endpointId: endpoint.id,
        endpointName: endpoint.name,
        method: endpoint.method,
        path: endpoint.path,
        body,
        reason: 'simulated_offline',
      };

      let result: RunResult;
      if (deps.isOffline()) {
        result = toRunResult(spec, { kind: 'network', message: 'Simulated offline mode: not sent', attempts: [] }, startedAt);
        // Only claim "queued" once the queue has accepted it; a refused request stays a plain network error.
        const queueError = await enqueueSafely(deps, enqueueInput);
        if (queueError) {
          result.errorMessage = `Simulated offline mode: not sent, and not queued (${queueError})`;
        } else {
          result.outcome = 'queued_offline';
          result.queued = 'simulated_offline';
          result.errorMessage = 'Simulated offline mode: queued, not sent';
        }
      } else {
        const request: HttpRequest = {
          url: spec.url,
          method: spec.method,
          headers: spec.headers,
          ...(body !== null ? { body } : {}),
          timeoutMs: plan.timeoutMs,
          ...(deps.signal ? { signal: deps.signal } : {}),
        };
        const outcome = await executeResilient(request, deps.transport, plan.retry, deps.resilience);
        result = toRunResult(spec, outcome, startedAt);
        if (outcome.kind === 'cancelled') break;

        if (isOk(result)) {
          const parsed = parseBody(result.bodyText, result.responseHeaders['content-type']);
          if (parsed.kind === 'json' && !result.bodyTruncated && isCleanSample(result.chaosApplied)) {
            deps.tracker.learnClean(endpoint.id, parsed.value);
          }
        }
        const reason = queueReasonFor(result);
        if (reason) {
          const queueError = await enqueueSafely(deps, { ...enqueueInput, reason });
          if (queueError) result.errorMessage = [result.errorMessage, `Not queued: ${queueError}`].filter(Boolean).join('. ');
          else result.queued = reason;
        }
      }

      endpointResults.push(result);
      // Live assessment with what is known so far; refined after the batch.
      const live = assessEndpointResults(endpointResults, deps.tracker, endpoint.id);
      const latest = live[live.length - 1] as RunResult;
      endpointResults[endpointResults.length - 1] = latest;
      onResult(latest);
    }
    results.push(...assessEndpointResults(endpointResults, deps.tracker, endpoint.id));
  }
  return results;
}

async function enqueueSafely(deps: BatchDeps, input: EnqueueInput): Promise<string | null> {
  try {
    await deps.enqueue(input);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Could not queue the request';
  }
}

export interface BatchSummary {
  total: number;
  success: number;
  successPct: number;
  avgLatencyMs: number | null;
  faults4xx: number;
  faults5xx: number;
  rateLimited: number;
  timeouts: number;
  networkErrors: number;
  corruptedCaught: number;
  injectedCorruptions: number;
  /** Injected corruptions the detector flagged (scored with the chaos header). */
  detectedOfInjected: number;
  falsePositives: number;
  unverified: number;
  queued: number;
  retries: number;
}

export function summarize(results: RunResult[]): BatchSummary {
  const count = (predicate: (result: RunResult) => boolean) => results.filter(predicate).length;
  const flagged = (result: RunResult) => result.outcome === 'schema_corruption' || result.outcome === 'invalid_json';
  const latencies = results.flatMap((result) => (result.latencyMs !== null && result.status !== null ? [result.latencyMs] : []));
  const success = count((result) => result.outcome === 'success');
  return {
    total: results.length,
    success,
    successPct: results.length ? Math.round((success / results.length) * 1000) / 10 : 0,
    avgLatencyMs: latencies.length ? Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length) : null,
    faults4xx: count((result) => result.outcome === 'http_4xx'),
    faults5xx: count((result) => result.outcome === 'http_5xx'),
    rateLimited: count((result) => result.outcome === 'rate_limited'),
    timeouts: count((result) => result.outcome === 'timeout'),
    networkErrors: count((result) => result.outcome === 'network_error'),
    corruptedCaught: count(flagged),
    injectedCorruptions: count((result) => result.injectedCorruption > 0),
    detectedOfInjected: count((result) => result.injectedCorruption > 0 && flagged(result)),
    falsePositives: count((result) => result.injectedCorruption === 0 && flagged(result)),
    unverified: count((result) => result.integrity?.verdict === 'UNVERIFIED'),
    queued: count((result) => result.queued !== null),
    retries: results.reduce((sum, result) => sum + Math.max(0, result.attempts.length - 1), 0),
  };
}
