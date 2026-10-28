import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
import { ApiError, toApiError } from './errors';
import {
  CHAOS_CONFIG_KEYS,
  type ApiSuccess,
  type AuthPayload,
  type ChaosConfig,
  type CreateEndpointPayload,
  type Credentials,
  type EndpointDto,
  type LogsResponse,
} from './types';

/**
 * Cold starts: a free-tier host puts the backend to sleep when idle and needs up to about a minute to wake it.
 * Until the API has answered once, requests get a longer timeout, and the UI is told the server is waking up
 * once a request has been waiting for a few seconds.
 */
export const REQUEST_TIMEOUT_MS = 15_000;
export const COLD_START_TIMEOUT_MS = 75_000;
export const WAKING_NOTICE_AFTER_MS = 3_000;

/** Codes that mean "this token is no longer good": the session is cleared and the user sent to login. */
const SESSION_ERROR_CODES = new Set(['UNAUTHORIZED', 'INVALID_TOKEN', 'TOKEN_EXPIRED']);

export interface ApiClientOptions {
  baseURL: string;
  getToken: () => string | null;
  /** Called when an authenticated call is rejected with 401. Never for the login/register forms. */
  onSessionExpired: (error: ApiError) => void;
  /** Called with true while the first requests wait on a sleeping server, and false once they settle. */
  onServerWaking?: (waking: boolean) => void;
  /** Test seam: replaces the HTTP transport. */
  adapter?: AxiosAdapter;
}

export interface ApiClient {
  register(credentials: Credentials): Promise<AuthPayload>;
  login(credentials: Credentials): Promise<AuthPayload>;
  listEndpoints(): Promise<EndpointDto[]>;
  createEndpoint(payload: CreateEndpointPayload): Promise<EndpointDto>;
  updateChaos(id: string, patch: Partial<ChaosConfig>): Promise<EndpointDto>;
  deleteEndpoint(id: string): Promise<{ id: string; deleted: true }>;
  getLogs(projectKey: string, signal?: AbortSignal): Promise<LogsResponse>;
}

/** The PATCH schema is strict: anything but the five chaos keys (e.g. UI state) would be a 400. */
export function pickChaosFields(patch: Partial<ChaosConfig>): Partial<ChaosConfig> {
  const picked: Partial<ChaosConfig> = {};
  for (const key of CHAOS_CONFIG_KEYS) {
    if (patch[key] !== undefined) Object.assign(picked, { [key]: patch[key] });
  }
  return picked;
}

const isAuthRoute = (url: string | undefined) => (url ?? '').startsWith('/api/auth/');

export function createApiClient(options: ApiClientOptions): ApiClient {
  const http: AxiosInstance = axios.create({
    baseURL: options.baseURL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: { Accept: 'application/json' },
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });

  // Cold-start tracking: the server counts as awake after its first response of any status.
  let serverAwake = false;
  let coldRequests = 0;
  let waking = false;
  const setWaking = (next: boolean) => {
    if (waking === next) return;
    waking = next;
    options.onServerWaking?.(next);
  };
  const markAwake = () => {
    serverAwake = true;
    setWaking(false);
  };

  http.interceptors.request.use((config) => {
    if (!serverAwake) config.timeout = COLD_START_TIMEOUT_MS;
    const token = options.getToken();
    // Only PocketChaos's own API ever sees the JWT; proxy test calls use a separate client (api/proxyTester.ts).
    if (token && !isAuthRoute(config.url)) config.headers.set('Authorization', `Bearer ${token}`);
    return config;
  });

  http.interceptors.response.use(
    (response) => {
      markAwake();
      return response;
    },
    (error: unknown) => {
      if (axios.isAxiosError(error) && error.response) markAwake();
      const apiError = toApiError(error, options.baseURL);
      const url = axios.isAxiosError(error) ? error.config?.url : undefined;
      if (apiError.status === 401 && SESSION_ERROR_CODES.has(apiError.code) && !isAuthRoute(url)) {
        options.onSessionExpired(apiError);
      }
      return Promise.reject(apiError);
    },
  );

  async function call<T>(promise: Promise<{ data: ApiSuccess<T> }>): Promise<T> {
    const cold = !serverAwake;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (cold) {
      coldRequests += 1;
      timer = setTimeout(() => {
        if (!serverAwake) setWaking(true);
      }, WAKING_NOTICE_AFTER_MS);
    }
    try {
      const { data: body } = await promise;
      if (body?.success !== true) throw new ApiError(null, 'UNEXPECTED_RESPONSE', 'Malformed API response');
      return body.data;
    } finally {
      if (cold) {
        clearTimeout(timer);
        coldRequests -= 1;
        if (coldRequests === 0) setWaking(false);
      }
    }
  }

  // List responses are rendered with .map(): a wrong shape (version skew, an intermediary rewriting the body)
  // must surface as an API error the UI already handles, not as a render crash.
  const malformed = () => new ApiError(null, 'UNEXPECTED_RESPONSE', 'The API returned data in an unexpected format');

  return {
    register: (credentials) => call(http.post('/api/auth/register', credentials)),
    login: (credentials) => call(http.post('/api/auth/login', credentials)),
    listEndpoints: async () => {
      const list = await call<EndpointDto[]>(http.get('/api/endpoints'));
      if (!Array.isArray(list)) throw malformed();
      return list;
    },
    createEndpoint: (payload) => call(http.post('/api/endpoints', payload)),
    updateChaos: (id, patch) =>
      call(http.patch(`/api/endpoints/${encodeURIComponent(id)}/chaos`, pickChaosFields(patch))),
    deleteEndpoint: (id) => call(http.delete(`/api/endpoints/${encodeURIComponent(id)}`)),
    getLogs: async (projectKey, signal) => {
      const response = await call<LogsResponse>(
        http.get(`/api/logs/${encodeURIComponent(projectKey)}`, signal ? { signal } : {}),
      );
      if (!response || !Array.isArray(response.logs)) throw malformed();
      return response;
    },
  };
}
