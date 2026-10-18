import { z } from 'zod';

/**
 * Build-time configuration (.ai/CONTEXT.md §3.1: no hardcoded URLs). Vite inlines VITE_* values into the
 * bundle, so nothing secret may ever be configured here.
 */
const envSchema = z.object({
  VITE_API_BASE_URL: z
    .url({ protocol: /^https?$/, error: 'must be an http(s) URL such as http://localhost:4000' })
    .transform((url) => url.replace(/\/+$/, '')),
});

export interface WebEnv {
  apiBaseUrl: string;
}

export type EnvResult = { ok: true; env: WebEnv } | { ok: false; problems: string[] };

export function parseWebEnv(source: Record<string, unknown>): EnvResult {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`),
    };
  }
  return { ok: true, env: { apiBaseUrl: parsed.data.VITE_API_BASE_URL } };
}
