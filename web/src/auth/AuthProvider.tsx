import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { createApiClient } from '../api/client';
import { createProxyTester } from '../api/proxyTester';
import { ServerWakingBanner } from '../components/ServerWakingBanner';
import type { AuthPayload } from '../api/types';
import { ApiContext, AuthContext, type ApiContextValue, type AuthContextValue } from './context';
import { clearSession, loadSession, saveSession, sessionFromAuth, type Session } from './session';

export const SESSION_EXPIRED_NOTICE = 'Your session has expired. Please log in again.';

export function AuthProvider({ apiBaseUrl, children }: { apiBaseUrl: string; children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [notice, setNotice] = useState<string | null>(null);
  const [serverWaking, setServerWaking] = useState(false);
  // The API client is created once; it reads the current token through this ref.
  const tokenRef = useRef<string | null>(session?.token ?? null);

  const signOut = useCallback((reason?: string) => {
    tokenRef.current = null;
    clearSession();
    setSession(null);
    setNotice(reason ?? null);
  }, []);

  const signIn = useCallback((payload: AuthPayload) => {
    const next = sessionFromAuth(payload);
    tokenRef.current = next.token;
    saveSession(next);
    setSession(next);
    setNotice(null);
  }, []);

  const apiValue = useMemo<ApiContextValue>(
    () => ({
      apiBaseUrl,
      api: createApiClient({
        baseURL: apiBaseUrl,
        getToken: () => tokenRef.current,
        onSessionExpired: () => signOut(SESSION_EXPIRED_NOTICE),
        onServerWaking: setServerWaking,
      }),
      testProxy: createProxyTester(),
    }),
    [apiBaseUrl, signOut],
  );

  const authValue = useMemo<AuthContextValue>(
    () => ({ session, notice, signIn, signOut }),
    [session, notice, signIn, signOut],
  );

  return (
    <ApiContext.Provider value={apiValue}>
      <AuthContext.Provider value={authValue}>
        {serverWaking && <ServerWakingBanner />}
        {children}
      </AuthContext.Provider>
    </ApiContext.Provider>
  );
}
