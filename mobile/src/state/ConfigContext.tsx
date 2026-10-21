import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { z } from 'zod';
import { createTransport, type Transport } from '../api/http';
import { ApiError, createPocketChaosApi, pairDataSchema, PROJECT_KEY_PATTERN, type PairData } from '../api/pocketChaosApi';
import { mobileEnv } from '../config/env';
import { buildPresets, defaultPresetId, normalizeBaseUrl, type ServerPreset } from '../config/serverPresets';

const CONFIG_KEY = '@pocketchaos/config/v1';
const PAIRING_KEY = '@pocketchaos/pairing/v1';

const storedConfigSchema = z.object({
  presetId: z.enum(['lan', 'android-emulator', 'localhost', 'cloud', 'custom']),
  port: z.number().int().min(1).max(65535),
  customUrl: z.string(),
  projectKey: z.string(),
});
const storedPairingSchema = z.object({ baseUrl: z.string(), pairedAt: z.string(), data: pairDataSchema });

export type ServerConfig = z.infer<typeof storedConfigSchema>;

export type PairingState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'paired'; data: PairData; pairedAt: string; baseUrl: string }
  | { status: 'error'; code: string; message: string };

export type HealthState = { status: 'idle' | 'checking' } | { status: 'ok'; latencyMs: number } | { status: 'error'; message: string };

interface ConfigContextValue {
  hydrated: boolean;
  config: ServerConfig;
  presets: ServerPreset[];
  baseUrl: string | null;
  baseUrlError: string | null;
  transport: Transport;
  pairing: PairingState;
  health: HealthState;
  update: (patch: Partial<ServerConfig>) => void;
  pair: () => Promise<void>;
  testConnection: () => Promise<void>;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function useConfig(): ConfigContextValue {
  const value = useContext(ConfigContext);
  if (!value) throw new Error('useConfig must be used inside <ConfigProvider>');
  return value;
}

/** Android's hint when the backend is unreachable: the most common first-run mistake. */
function networkHint(baseUrl: string): string {
  if (Platform.OS === 'android' && /\/\/(localhost|127\.)/.test(baseUrl)) {
    return ' On the Android emulator "localhost" is the emulator itself: use the Android Emulator preset (10.0.2.2).';
  }
  if (/\/\/(localhost|127\.|10\.0\.2\.2)/.test(baseUrl)) {
    return ' On a physical device use the Dev machine (LAN) preset or your computer\'s IP.';
  }
  return '';
}

export function ConfigProvider({
  children,
  transport: injectedTransport,
  hostUri = Constants.expoConfig?.hostUri ?? null,
}: {
  children: ReactNode;
  transport?: Transport;
  hostUri?: string | null;
}) {
  const transport = useMemo(() => injectedTransport ?? createTransport(), [injectedTransport]);
  const [hydrated, setHydrated] = useState(false);
  const [config, setConfig] = useState<ServerConfig>(() => {
    const presets = buildPresets({ port: mobileEnv.defaultPort, hostUri, cloudUrl: mobileEnv.cloudUrl });
    return { presetId: defaultPresetId(Platform.OS, presets), port: mobileEnv.defaultPort, customUrl: '', projectKey: '' };
  });
  const [pairing, setPairing] = useState<PairingState>({ status: 'idle' });
  const [health, setHealth] = useState<HealthState>({ status: 'idle' });
  const requestId = useRef(0);
  // Saved settings are only overwritten once they were read, or the user changed something: never with defaults
  // after a failed read.
  const mayPersist = useRef(false);

  const presets = useMemo(
    () => buildPresets({ port: config.port, hostUri, cloudUrl: mobileEnv.cloudUrl }),
    [config.port, hostUri],
  );

  const resolved = useMemo((): { url: string | null; error: string | null } => {
    if (config.presetId === 'custom') {
      const result = normalizeBaseUrl(config.customUrl);
      return result.ok ? { url: result.url, error: null } : { url: null, error: config.customUrl ? result.error : null };
    }
    const preset = presets.find((item) => item.id === config.presetId);
    return preset?.baseUrl ? { url: preset.baseUrl, error: null } : { url: null, error: preset?.hint ?? 'Choose a server' };
  }, [config.customUrl, config.presetId, presets]);

  // Restore saved settings and the last pairing (so the runner works straight after a restart).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rawConfig, rawPairing] = await Promise.all([AsyncStorage.getItem(CONFIG_KEY), AsyncStorage.getItem(PAIRING_KEY)]);
        const savedConfig = rawConfig ? storedConfigSchema.safeParse(JSON.parse(rawConfig)) : null;
        const savedPairing = rawPairing ? storedPairingSchema.safeParse(JSON.parse(rawPairing)) : null;
        if (cancelled) return;
        mayPersist.current = true;
        if (savedConfig?.success) setConfig(savedConfig.data);
        if (savedPairing?.success && savedConfig?.success && savedPairing.data.data.projectKey === savedConfig.data.projectKey) {
          setPairing({ status: 'paired', ...savedPairing.data });
        }
      } catch {
        // Unreadable storage: start fresh rather than crash.
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hydrated && mayPersist.current) AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config)).catch(() => undefined);
  }, [config, hydrated]);

  const update = useCallback((patch: Partial<ServerConfig>) => {
    mayPersist.current = true;
    setConfig((current) => ({ ...current, ...patch }));
    if (patch.presetId !== undefined || patch.port !== undefined || patch.customUrl !== undefined) setHealth({ status: 'idle' });
  }, []);

  const pair = useCallback(async () => {
    const projectKey = config.projectKey;
    if (!PROJECT_KEY_PATTERN.test(projectKey)) {
      setPairing({ status: 'error', code: 'INVALID_PROJECT_KEY', message: 'Enter the 6-character project key shown in the dashboard' });
      return;
    }
    if (!resolved.url) {
      setPairing({ status: 'error', code: 'NO_SERVER', message: resolved.error ?? 'Choose a backend URL first' });
      return;
    }
    const baseUrl = resolved.url;
    const id = (requestId.current += 1);
    setPairing({ status: 'loading' });
    try {
      const data = await createPocketChaosApi(baseUrl, transport).pair(projectKey);
      if (id !== requestId.current) return;
      const pairedAt = new Date().toISOString();
      setPairing({ status: 'paired', data, pairedAt, baseUrl });
      AsyncStorage.setItem(PAIRING_KEY, JSON.stringify({ baseUrl, pairedAt, data })).catch(() => undefined);
    } catch (error) {
      if (id !== requestId.current) return;
      const apiError = error instanceof ApiError ? error : new ApiError('UNKNOWN_ERROR', 'Pairing failed');
      const hint = apiError.code === 'NETWORK_ERROR' ? networkHint(baseUrl) : '';
      setPairing({ status: 'error', code: apiError.code, message: `${apiError.message}${hint}` });
    }
  }, [config.projectKey, resolved, transport]);

  const testConnection = useCallback(async () => {
    if (!resolved.url) {
      setHealth({ status: 'error', message: resolved.error ?? 'Choose a backend URL first' });
      return;
    }
    setHealth({ status: 'checking' });
    try {
      const { latencyMs } = await createPocketChaosApi(resolved.url, transport).health();
      setHealth({ status: 'ok', latencyMs });
    } catch (error) {
      setHealth({ status: 'error', message: error instanceof Error ? `${error.message}${networkHint(resolved.url)}` : 'Connection failed' });
    }
  }, [resolved, transport]);

  const value = useMemo<ConfigContextValue>(
    () => ({ hydrated, config, presets, baseUrl: resolved.url, baseUrlError: resolved.error, transport, pairing, health, update, pair, testConnection }),
    [hydrated, config, presets, resolved, transport, pairing, health, update, pair, testConnection],
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}
