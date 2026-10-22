/**
 * Backend base-URL presets. "localhost" means a different machine depending on where the app runs:
 *   - Android emulator: the emulator itself. The host computer is reachable as 10.0.2.2.
 *   - iOS simulator: shares the Mac's network stack, so localhost works.
 *   - Physical device: needs the computer's LAN IP (or a deployed URL).
 * When the app is served by the Expo dev server, its hostUri ("192.168.1.20:8081") reveals that LAN IP.
 */
export type PresetId = 'lan' | 'android-emulator' | 'localhost' | 'cloud' | 'custom';

export interface ServerPreset {
  id: PresetId;
  label: string;
  hint: string;
  /** null when the preset is unavailable (no Expo dev host, no cloud URL configured) or user-defined. */
  baseUrl: string | null;
}

/** The backend's default PORT (backend/.env.example). Port 5000 is taken by AirPlay Receiver on macOS. */
export const DEFAULT_API_PORT = 4000;

export function hostFromHostUri(hostUri: string | null | undefined): string | null {
  if (!hostUri) return null;
  const trimmed = hostUri.trim().replace(/^[a-z]+:\/\//i, '');
  const ipv6 = /^\[([^\]]+)\]/.exec(trimmed);
  const host = ipv6 ? `[${ipv6[1]}]` : trimmed.split('/')[0]?.split(':')[0];
  return host ? host.toLowerCase() : null;
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '[::1]' || /^127\./.test(host);
}

export interface PresetInputs {
  port: number;
  /** Constants.expoConfig?.hostUri when running from the Expo dev server. */
  hostUri?: string | null;
  /** EXPO_PUBLIC_API_BASE_URL: a deployed backend. */
  cloudUrl?: string | null;
}

export function buildPresets({ port, hostUri, cloudUrl }: PresetInputs): ServerPreset[] {
  const lanHost = hostFromHostUri(hostUri);
  return [
    {
      id: 'lan',
      label: 'Dev machine (LAN)',
      hint: lanHost ? 'Detected from the Expo dev server: works on physical devices' : 'Not detected: start the app with Expo',
      baseUrl: lanHost && !isLoopback(lanHost) ? `http://${lanHost}:${port}` : null,
    },
    {
      id: 'android-emulator',
      label: 'Android Emulator',
      hint: '10.0.2.2 is the emulator alias for your computer',
      baseUrl: `http://10.0.2.2:${port}`,
    },
    {
      id: 'localhost',
      label: 'Localhost',
      hint: 'iOS Simulator or web on the same computer',
      baseUrl: `http://localhost:${port}`,
    },
    {
      id: 'cloud',
      label: 'Cloud',
      hint: cloudUrl ? 'From EXPO_PUBLIC_API_BASE_URL' : 'Set EXPO_PUBLIC_API_BASE_URL to enable',
      baseUrl: cloudUrl ?? null,
    },
    { id: 'custom', label: 'Custom URL', hint: 'Any LAN IP or deployed URL', baseUrl: null },
  ];
}

/** Sensible first choice: the LAN preset when Expo exposes a real IP, else the platform's loopback alias. */
/** A configured deployment wins (a fresh install points at the live backend); otherwise the dev machine. */
export function defaultPresetId(platform: string, presets: ServerPreset[]): PresetId {
  if (presets.find((preset) => preset.id === 'cloud')?.baseUrl) return 'cloud';
  if (presets.find((preset) => preset.id === 'lan')?.baseUrl) return 'lan';
  return platform === 'android' ? 'android-emulator' : 'localhost';
}

export type BaseUrlResult = { ok: true; url: string } | { ok: false; error: string };

// Deliberately not `new URL()`: React Native's URL polyfill is regex-based and never throws on invalid input,
// while Jest runs on Node's strict WHATWG URL. One explicit grammar behaves identically in both.
const BASE_URL_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\s]+)(\/[^?#\s]*)?$/i;
const HOST_PATTERN =
  /^(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)(?::(\d{1,5}))?$/i;

export function normalizeBaseUrl(input: string): BaseUrlResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'Enter the backend URL, e.g. http://192.168.1.20:4000' };
  if (/[?#]/.test(raw)) return { ok: false, error: 'Remove the query string or #fragment' };

  const match = BASE_URL_PATTERN.exec(raw);
  if (!match) return { ok: false, error: 'Enter a full URL including http:// or https://' };
  const [, scheme = '', authority = '', path = ''] = match;
  if (!/^https?$/i.test(scheme)) return { ok: false, error: 'Only http:// and https:// are supported' };
  if (authority.includes('@')) return { ok: false, error: 'URLs with credentials are not allowed' };

  const host = HOST_PATTERN.exec(authority);
  if (!host) return { ok: false, error: 'The host is not a valid name or IP address' };
  const port = host[2];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) {
    return { ok: false, error: 'Port must be between 1 and 65535' };
  }

  // Keep any path prefix (backend behind a reverse proxy), minus trailing slashes.
  return { ok: true, url: `${scheme.toLowerCase()}://${authority.toLowerCase()}${path.replace(/\/+$/, '')}` };
}

export function parsePort(input: string): number | null {
  if (!/^\d{1,5}$/.test(input.trim())) return null;
  const port = Number(input);
  return port >= 1 && port <= 65535 ? port : null;
}
