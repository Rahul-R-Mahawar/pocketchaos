/**
 * Mirrors of the backend DTOs (backend/src/utils/serializers.ts) and the response contract in
 * .ai/CONTEXT.md §4. Keep in sync when the API changes.
 */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const MAX_DELAY_MS = 10_000;
/** Status codes offered in the dashboard for injected faults. The API accepts any 400–599. */
export const FAULT_STATUS_OPTIONS = [500, 502, 503, 401, 403, 429] as const;
/** Status returned for an injected fault when overrideStatusCode is null. */
export const DEFAULT_FAULT_STATUS = 500;

export interface ChaosConfig {
  enabled: boolean;
  delayMs: number;
  failureRate: number;
  overrideStatusCode: number | null;
  corruptJson: boolean;
}

export const CHAOS_CONFIG_KEYS = [
  'enabled',
  'delayMs',
  'failureRate',
  'overrideStatusCode',
  'corruptJson',
] as const satisfies ReadonlyArray<keyof ChaosConfig>;

export interface EndpointDto {
  id: string;
  projectKey: string;
  name: string;
  method: HttpMethod;
  path: string;
  mode: 'mock' | 'forward';
  targetUrl: string | null;
  mockResponseJson: unknown;
  chaosConfig: ChaosConfig;
  proxyPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEndpointPayload {
  name: string;
  path: string;
  method: HttpMethod;
  targetUrl?: string;
  mockResponseJson?: unknown;
}

export interface AuthUser {
  id: string;
  email: string;
  projectKey: string;
  createdAt: string;
}

export interface AuthPayload {
  token: string;
  projectKey: string;
  user: AuthUser;
}

export interface Credentials {
  email: string;
  password: string;
}

export type ClientPlatform = 'ios' | 'android' | 'web' | 'unknown';

export interface RequestLogDto {
  id: string;
  endpointId: string | null;
  projectKey: string;
  timestamp: string;
  method: string;
  path: string;
  statusReturned: number;
  latencyMs: number;
  chaosApplied: string;
  clientPlatform: ClientPlatform;
}

export interface LogsResponse {
  projectKey: string;
  logs: RequestLogDto[];
}

/** One entry of `error.details` for a VALIDATION_ERROR. */
export interface FieldIssue {
  location?: 'body' | 'params' | 'query';
  path: string;
  message: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details: unknown[] };
}
