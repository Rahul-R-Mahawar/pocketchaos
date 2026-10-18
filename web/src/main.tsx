import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ConfigError } from './components/ConfigError';
import { AppCrashFallback, ErrorBoundary } from './components/ErrorBoundary';
import { parseWebEnv } from './config/env';
import './index.css';

const envResult = parseWebEnv(import.meta.env);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {envResult.ok ? (
      <AuthProvider apiBaseUrl={envResult.env.apiBaseUrl}>
        <ErrorBoundary fallback={() => <AppCrashFallback />}>
          <App />
        </ErrorBoundary>
      </AuthProvider>
    ) : (
      <ConfigError problems={envResult.problems} />
    )}
  </StrictMode>,
);
