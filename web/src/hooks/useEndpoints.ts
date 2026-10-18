import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';
import { toApiError } from '../api/errors';
import type { EndpointDto } from '../api/types';

export interface EndpointsState {
  endpoints: EndpointDto[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  add: (endpoint: EndpointDto) => void;
  replace: (endpoint: EndpointDto) => void;
  remove: (id: string) => Promise<void>;
}

export function useEndpoints(api: ApiClient): EndpointsState {
  const [endpoints, setEndpoints] = useState<EndpointDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listEndpoints()
      .then((list) => {
        if (cancelled) return;
        setEndpoints(list);
        setError(null);
      })
      .catch((raw: unknown) => {
        if (!cancelled) setError(toApiError(raw).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  const add = useCallback((endpoint: EndpointDto) => setEndpoints((list) => [endpoint, ...list]), []);
  const replace = useCallback(
    (endpoint: EndpointDto) => setEndpoints((list) => list.map((item) => (item.id === endpoint.id ? endpoint : item))),
    [],
  );
  const remove = useCallback(
    async (id: string) => {
      await api.deleteEndpoint(id);
      setEndpoints((list) => list.filter((item) => item.id !== id));
    },
    [api],
  );

  return { endpoints, loading, error, reload, add, replace, remove };
}
