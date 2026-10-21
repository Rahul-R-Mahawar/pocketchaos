import { z } from 'zod';
import { DEFAULT_API_PORT, normalizeBaseUrl } from './serverPresets';

/**
 * Build-time configuration. EXPO_PUBLIC_* values are inlined into the JavaScript bundle shipped to devices,
 * so they must never contain secrets (.ai/CONTEXT.md §3.1). Both are optional: the user can always type a URL.
 */
export interface MobileEnv {
  cloudUrl: string | null;
  defaultPort: number;
}

const portSchema = z.coerce.number().int().min(1).max(65535);

export function parseMobileEnv(source: Record<string, string | undefined>): MobileEnv {
  const cloud = source.EXPO_PUBLIC_API_BASE_URL ? normalizeBaseUrl(source.EXPO_PUBLIC_API_BASE_URL) : null;
  const port = portSchema.safeParse(source.EXPO_PUBLIC_API_PORT);
  return {
    cloudUrl: cloud?.ok ? cloud.url : null,
    defaultPort: source.EXPO_PUBLIC_API_PORT && port.success ? port.data : DEFAULT_API_PORT,
  };
}

// Expo only inlines EXPO_PUBLIC_* when accessed as process.env.NAME literally.
export const mobileEnv = parseMobileEnv({
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  EXPO_PUBLIC_API_PORT: process.env.EXPO_PUBLIC_API_PORT,
});
