import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../api/client';
import { toApiError } from '../api/errors';
import type { ChaosConfig, EndpointDto } from '../api/types';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
/** Toggles and selects save at once; slider drags are coalesced into one PATCH after the user pauses. */
export type ChangeMode = 'immediate' | 'debounced';

export const SLIDER_DEBOUNCE_MS = 350;

export interface ChaosSync {
  draft: ChaosConfig;
  saveState: SaveState;
  error: string | null;
  change: (patch: Partial<ChaosConfig>, mode?: ChangeMode) => void;
}

/**
 * Optimistic, debounced syncing of one endpoint's chaosConfig:
 * - the UI shows `draft` immediately;
 * - pending edits are merged and sent as a single PATCH (the CRUD routes are rate limited);
 * - requests are serialised, so a slow response never overwrites a newer local edit;
 * - on failure the draft rolls back to the last server-confirmed state (plus any newer edits).
 */
export function useChaosSync(
  endpoint: EndpointDto,
  updateChaos: ApiClient['updateChaos'],
  onSaved: (endpoint: EndpointDto) => void,
): ChaosSync {
  const [draft, setDraft] = useState<ChaosConfig>(endpoint.chaosConfig);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  const confirmedRef = useRef<ChaosConfig>(endpoint.chaosConfig);
  const pendingRef = useRef<Partial<ChaosConfig>>({});
  const inFlightRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);
  const latest = useRef({ id: endpoint.id, updateChaos, onSaved });
  useEffect(() => {
    latest.current = { id: endpoint.id, updateChaos, onSaved };
  });

  // Adopt server state pushed in from outside (e.g. a list refresh) when nothing local is pending.
  useEffect(() => {
    if (inFlightRef.current || Object.keys(pendingRef.current).length > 0) return;
    confirmedRef.current = endpoint.chaosConfig;
    setDraft(endpoint.chaosConfig);
  }, [endpoint.chaosConfig]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
    };
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    while (inFlightRef.current) await inFlightRef.current;
    const patch = pendingRef.current;
    if (Object.keys(patch).length === 0 || !mountedRef.current) return;
    pendingRef.current = {};
    setSaveState('saving');

    const request = latest.current
      .updateChaos(latest.current.id, patch)
      .then((updated) => {
        confirmedRef.current = updated.chaosConfig;
        if (!mountedRef.current) return;
        latest.current.onSaved(updated);
        const stillPending = Object.keys(pendingRef.current).length > 0;
        setDraft({ ...updated.chaosConfig, ...pendingRef.current });
        setSaveState(stillPending ? 'saving' : 'saved');
        setError(null);
      })
      .catch((raw: unknown) => {
        if (!mountedRef.current) return;
        setDraft({ ...confirmedRef.current, ...pendingRef.current });
        setSaveState('error');
        setError(toApiError(raw).message);
      })
      .finally(() => {
        inFlightRef.current = null;
      });

    inFlightRef.current = request;
    await request;
  }, []);

  const change = useCallback(
    (patch: Partial<ChaosConfig>, mode: ChangeMode = 'immediate') => {
      setDraft((current) => ({ ...current, ...patch }));
      pendingRef.current = { ...pendingRef.current, ...patch };
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), mode === 'immediate' ? 0 : SLIDER_DEBOUNCE_MS);
    },
    [flush],
  );

  return { draft, saveState, error, change };
}
