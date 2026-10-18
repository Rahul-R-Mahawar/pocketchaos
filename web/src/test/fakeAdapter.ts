import { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';

export interface FakeReply {
  status: number;
  data?: unknown;
  headers?: Record<string, string>;
}

/**
 * Replaces axios's HTTP transport. Records every request and settles like the real adapters do:
 * resolves when `validateStatus` accepts the status, rejects with an AxiosError otherwise.
 * Returning `'network-error'` simulates a request that never got a response.
 */
export function fakeAdapter(handler: (config: InternalAxiosRequestConfig) => FakeReply | 'network-error') {
  const requests: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    requests.push(config);
    const reply = handler(config);
    if (reply === 'network-error') {
      throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, {});
    }
    const response = {
      data: reply.data,
      status: reply.status,
      statusText: String(reply.status),
      headers: new AxiosHeaders(reply.headers ?? {}),
      config,
      request: {},
    };
    const validate = config.validateStatus ?? ((status: number) => status >= 200 && status < 300);
    if (validate(response.status)) return response;
    throw new AxiosError(`Request failed with status code ${reply.status}`, AxiosError.ERR_BAD_REQUEST, config, {}, response);
  };
  return { adapter, requests };
}

export const ok = <T>(data: T, status = 200): FakeReply => ({ status, data: { success: true, data } });

export const fail = (status: number, code: string, message = code, details: unknown[] = []): FakeReply => ({
  status,
  data: { success: false, error: { code, message, details } },
});
