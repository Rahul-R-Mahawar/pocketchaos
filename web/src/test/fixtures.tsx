import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi, type Mock } from 'vitest';
import type { ApiClient } from '../api/client';
import type { ProxyTester } from '../api/proxyTester';
import type { ChaosConfig, EndpointDto, RequestLogDto } from '../api/types';
import { ApiContext, AuthContext, type AuthContextValue } from '../auth/context';
import type { Session } from '../auth/session';

export const API_BASE_URL = 'http://localhost:4000';
export const PROJECT_KEY = 'K7Q2XM';

export const TEST_SESSION: Session = {
  token: 'header.payload.signature',
  user: { id: 'a'.repeat(24), email: 'ada@example.com', projectKey: PROJECT_KEY, createdAt: '2026-10-18T10:00:00.000Z' },
};

export const DEFAULT_CHAOS: ChaosConfig = {
  enabled: false,
  delayMs: 0,
  failureRate: 0,
  overrideStatusCode: null,
  corruptJson: false,
};

export function makeEndpoint(overrides: Partial<EndpointDto> = {}): EndpointDto {
  const path = overrides.path ?? '/users/profile';
  return {
    id: 'e'.repeat(24),
    projectKey: PROJECT_KEY,
    name: 'User profile',
    method: 'GET',
    path,
    mode: 'mock',
    targetUrl: null,
    mockResponseJson: { id: 1 },
    chaosConfig: { ...DEFAULT_CHAOS },
    proxyPath: `/proxy/${PROJECT_KEY}${path}`,
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
    ...overrides,
  };
}

let logCounter = 0;
export function makeLog(overrides: Partial<RequestLogDto> = {}): RequestLogDto {
  logCounter += 1;
  return {
    id: `log-${logCounter}`,
    endpointId: 'e'.repeat(24),
    projectKey: PROJECT_KEY,
    timestamp: '2026-10-18T10:00:00.000Z',
    method: 'GET',
    path: '/users/profile',
    statusReturned: 200,
    latencyMs: 12,
    chaosApplied: 'none',
    clientPlatform: 'web',
    ...overrides,
  };
}

export type FakeApi = { [K in keyof ApiClient]: Mock<ApiClient[K]> };

/** Every method rejects unless a test provides an implementation, so unexpected calls fail loudly. */
export function makeFakeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  const unexpected = (name: string) => vi.fn(() => Promise.reject(new Error(`unexpected api.${name}() call`)));
  return {
    register: unexpected('register'),
    login: unexpected('login'),
    listEndpoints: unexpected('listEndpoints'),
    createEndpoint: unexpected('createEndpoint'),
    updateChaos: unexpected('updateChaos'),
    deleteEndpoint: unexpected('deleteEndpoint'),
    getLogs: unexpected('getLogs'),
    ...overrides,
  } as FakeApi;
}

export interface RenderOptions {
  api?: FakeApi;
  auth?: Partial<AuthContextValue>;
  testProxy?: ProxyTester;
}

export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const api = options.api ?? makeFakeApi();
  const auth: AuthContextValue = {
    session: TEST_SESSION,
    notice: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    ...options.auth,
  };
  const testProxy = options.testProxy ?? (vi.fn() as unknown as ProxyTester);
  const result: RenderResult = render(
    <ApiContext.Provider value={{ api, apiBaseUrl: API_BASE_URL, testProxy }}>
      <AuthContext.Provider value={auth}>{ui}</AuthContext.Provider>
    </ApiContext.Provider>,
  );
  return { ...result, api, auth, testProxy };
}

/** A promise you resolve or reject from the test, to control request timing. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
