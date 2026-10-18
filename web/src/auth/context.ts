import { createContext, useContext } from 'react';
import type { ApiClient } from '../api/client';
import type { AuthPayload } from '../api/types';
import type { ProxyTester } from '../api/proxyTester';
import type { Session } from './session';

export interface AuthContextValue {
  session: Session | null;
  /** One-off message for the login screen, e.g. why the user was signed out. */
  notice: string | null;
  signIn: (payload: AuthPayload) => void;
  signOut: (notice?: string) => void;
}

export interface ApiContextValue {
  api: ApiClient;
  apiBaseUrl: string;
  testProxy: ProxyTester;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
export const ApiContext = createContext<ApiContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

export function useApi(): ApiContextValue {
  const value = useContext(ApiContext);
  if (!value) throw new Error('useApi must be used inside <AuthProvider>');
  return value;
}
