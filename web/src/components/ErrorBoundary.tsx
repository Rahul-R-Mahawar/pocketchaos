import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { secondaryButton } from './ui/styles';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: (reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Keeps a render-time bug from blanking the dashboard. Async and event-handler errors never reach here;
 * those are handled where they happen (API errors become messages in the UI).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  reset = () => this.setState({ error: null });

  override render() {
    return this.state.error ? this.props.fallback(this.reset) : this.props.children;
  }
}

export function AppCrashFallback() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div role="alert" className="max-w-md rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center">
        <TriangleAlert aria-hidden className="mx-auto mb-3 size-8 text-red-300" />
        <h1 className="mb-1 text-lg font-semibold text-red-100">The dashboard hit an unexpected error</h1>
        <p className="mb-4 text-sm text-zinc-400">Your endpoints and chaos settings are safe on the server.</p>
        <button type="button" onClick={() => window.location.reload()} className={secondaryButton}>
          <RefreshCw aria-hidden className="size-4" />
          Reload dashboard
        </button>
      </div>
    </main>
  );
}

export function PanelCrashFallback({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm">
      <span className="flex items-center gap-2 text-red-200">
        <TriangleAlert aria-hidden className="size-4 shrink-0" />
        {title} could not be displayed.
      </span>
      <button type="button" onClick={onRetry} className={secondaryButton}>
        <RefreshCw aria-hidden className="size-4" />
        Retry
      </button>
    </div>
  );
}
