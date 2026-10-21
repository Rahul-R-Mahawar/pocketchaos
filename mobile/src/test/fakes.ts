import { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { TransportError, type HttpRequest, type HttpResponse, type Transport } from '../api/http';
import type { PairedEndpoint } from '../api/pocketChaosApi';
import type { StorageLike } from '../queue/offlineQueue';

/** Axios adapter stand-in: records requests and settles like the real XHR adapter. */
export function fakeAdapter(handler: (config: InternalAxiosRequestConfig) => { status: number; data?: string; headers?: Record<string, string> } | AxiosError) {
  const requests: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    requests.push(config);
    const reply = handler(config);
    if (reply instanceof AxiosError) throw reply;
    const response = { data: reply.data ?? '', status: reply.status, statusText: String(reply.status), headers: new AxiosHeaders(reply.headers ?? {}), config, request: {} };
    if ((config.validateStatus ?? (() => true))(reply.status)) return response;
    throw new AxiosError('bad status', AxiosError.ERR_BAD_RESPONSE, config, {}, response);
  };
  return { adapter, requests };
}

export type Scripted = Partial<HttpResponse> | TransportError;

/** Transport that answers from a script (per call), recording every request. */
export function scriptedTransport(script: (request: HttpRequest, call: number) => Scripted) {
  const requests: HttpRequest[] = [];
  const transport: Transport = async (request) => {
    requests.push(request);
    const reply = script(request, requests.length);
    if (reply instanceof TransportError) throw reply;
    return { status: 200, headers: {}, bodyText: '', latencyMs: 10, ...reply };
  };
  return { transport, requests };
}

export const json = (value: unknown, headers: Record<string, string> = {}): Partial<HttpResponse> => ({
  status: 200,
  bodyText: JSON.stringify(value),
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
});

export function makePairedEndpoint(overrides: Partial<PairedEndpoint> = {}): PairedEndpoint {
  const path = overrides.path ?? '/users/profile';
  return {
    id: 'e1',
    name: 'Profile',
    method: 'GET',
    path,
    mode: 'mock',
    chaosConfig: { enabled: false, delayMs: 0, failureRate: 0, overrideStatusCode: null, corruptJson: false },
    proxyPath: `/proxy/K7Q2XM${path}`,
    ...overrides,
  };
}

/** In-memory storage with optional per-call latency and failure injection. */
export class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  writes = 0;
  failNextWrite = false;
  failNextRead = false;
  /** Fails the next read of this one key only (other keys still read normally). */
  failNextReadOf: string | null = null;
  delayMs = 0;

  async getItem(key: string): Promise<string | null> {
    await this.pause();
    if (this.failNextRead || this.failNextReadOf === key) {
      this.failNextRead = false;
      this.failNextReadOf = null;
      throw new Error('read failed');
    }
    return this.data.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.pause();
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('write failed');
    }
    this.writes += 1;
    this.data.set(key, value);
  }

  private pause() {
    return this.delayMs ? new Promise((resolve) => setTimeout(resolve, this.delayMs)) : Promise.resolve();
  }
}

let idCounter = 0;
export const sequentialIds = () => {
  idCounter = 0;
  return () => `id-${(idCounter += 1)}`;
};
