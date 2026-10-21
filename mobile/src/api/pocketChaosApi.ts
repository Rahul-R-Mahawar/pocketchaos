import { z } from 'zod';
import { isSafeAbsolutePath } from '../lib/paths';
import { TransportError, type Transport } from './http';

/**
 * PocketChaos's own API (not the proxy). Only key-based routes: the mobile app never holds a JWT.
 * Responses are validated with zod because a key-only route can be pointed at anything, and the UI renders them.
 */
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const PROJECT_KEY_PATTERN = /^[A-Z0-9]{6}$/;

const chaosConfigSchema = z.object({
  enabled: z.boolean(),
  delayMs: z.number(),
  failureRate: z.number(),
  overrideStatusCode: z.number().nullable(),
  corruptJson: z.boolean(),
});

const pairedEndpointSchema = z.object({
  id: z.string(),
  name: z.string(),
  method: z.enum(HTTP_METHODS),
  path: z.string().refine(isSafeAbsolutePath),
  mode: z.enum(['mock', 'forward']),
  chaosConfig: chaosConfigSchema,
  // Requests are sent to `${baseUrl}${proxyPath}`: it must stay under /proxy/.
  proxyPath: z.string().startsWith('/proxy/').refine(isSafeAbsolutePath),
});

export const pairDataSchema = z.object({
  projectKey: z.string().regex(PROJECT_KEY_PATTERN),
  proxyBasePath: z.string(),
  endpoints: z.array(pairedEndpointSchema),
});

export type ChaosConfig = z.infer<typeof chaosConfigSchema>;
export type PairedEndpoint = z.infer<typeof pairedEndpointSchema>;
export type PairData = z.infer<typeof pairDataSchema>;

export class ApiError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const envelopeSchema = z.union([
  z.object({ success: z.literal(true), data: z.unknown() }),
  z.object({ success: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);

function parseEnvelope(status: number, bodyText: string): unknown {
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new ApiError('UNEXPECTED_RESPONSE', `Not a PocketChaos API response (HTTP ${status})`, status);
  }
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) throw new ApiError('UNEXPECTED_RESPONSE', `Not a PocketChaos API response (HTTP ${status})`, status);
  if (!envelope.data.success) throw new ApiError(envelope.data.error.code, envelope.data.error.message, status);
  return envelope.data.data;
}

function toApiError(error: unknown, baseUrl: string): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof TransportError) {
    return error.kind === 'timeout'
      ? new ApiError('TIMEOUT', `${baseUrl} did not respond in time`)
      : new ApiError(
          'NETWORK_ERROR',
          `Cannot reach ${baseUrl}. Check the URL, that the backend is running, and that this device is on the same network.`,
        );
  }
  return new ApiError('UNKNOWN_ERROR', error instanceof Error ? error.message : 'Something went wrong');
}

export interface PocketChaosApi {
  pair(projectKey: string): Promise<PairData>;
  health(): Promise<{ latencyMs: number }>;
}

export function createPocketChaosApi(baseUrl: string, transport: Transport, timeoutMs = 8_000): PocketChaosApi {
  const get = (path: string) =>
    transport({ url: `${baseUrl}${path}`, method: 'GET', headers: { Accept: 'application/json' }, timeoutMs });

  return {
    async pair(projectKey) {
      if (!PROJECT_KEY_PATTERN.test(projectKey)) throw new ApiError('INVALID_PROJECT_KEY', 'Project key must be 6 letters or digits');
      try {
        const response = await get(`/api/mobile/pair/${encodeURIComponent(projectKey)}`);
        const parsed = pairDataSchema.safeParse(parseEnvelope(response.status, response.bodyText));
        if (!parsed.success) throw new ApiError('UNEXPECTED_RESPONSE', 'The pairing response had an unexpected format');
        return parsed.data;
      } catch (error) {
        throw toApiError(error, baseUrl);
      }
    },
    async health() {
      try {
        const response = await get('/health');
        parseEnvelope(response.status, response.bodyText);
        return { latencyMs: response.latencyMs };
      } catch (error) {
        throw toApiError(error, baseUrl);
      }
    },
  };
}
