import { z } from 'zod';

/**
 * Build-time configuration (.ai/CONTEXT.md §3.1: no hardcoded URLs). Vite inlines VITE_* values into the
 * bundle, so nothing secret may ever be configured here.
 *
 * VITE_API_URL is the backend origin. VITE_API_BASE_URL is still read as a fallback for older .env files.
 * Only the dev server falls back to the local backend (PORT defaults to 4000; macOS AirPlay holds 5000);
 * a production build without VITE_API_URL is a configuration error, never a silent localhost.
 */
export const DEV_API_URL = 'http://localhost:4000';

const apiUrlSchema = z
  .url({ protocol: /^https?$/, error: 'must be an http(s) URL such as https://api.example.com' })
  .transform((url) => url.replace(/\/+$/, ''));

export interface WebEnv {
  apiBaseUrl: string;
}

export type EnvResult = { ok: true; env: WebEnv } | { ok: false; problems: string[] };

export function parseWebEnv(source: Record<string, unknown>): EnvResult {
  const configured = source.VITE_API_URL ?? source.VITE_API_BASE_URL;
  const value = configured === undefined || configured === '' ? (source.DEV === true ? DEV_API_URL : undefined) : configured;
  if (value === undefined) {
    return { ok: false, problems: ['VITE_API_URL: required for production builds (the backend origin, e.g. https://pocketchaos-backend.onrender.com)'] };
  }
  const parsed = apiUrlSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((issue) => `VITE_API_URL: ${issue.message}`) };
  }
  return { ok: true, env: { apiBaseUrl: parsed.data } };
}
