import { CircleAlert, LoaderCircle, RefreshCw, Zap } from 'lucide-react';
import { useApi } from '../auth/context';
import type { Session } from '../auth/session';
import { useEndpoints } from '../hooks/useEndpoints';
import { EndpointCard } from './EndpointCard';
import { EndpointForm } from './EndpointForm';
import { ErrorBoundary, PanelCrashFallback } from './ErrorBoundary';
import { Navbar } from './Navbar';
import { RequestLogPanel } from './RequestLogPanel';
import { secondaryButton } from './ui/styles';

export function Dashboard({ session }: { session: Session }) {
  const { api } = useApi();
  const { endpoints, loading, error, reload, add, replace, remove } = useEndpoints(api);
  const { projectKey } = session.user;

  return (
    <div className="min-h-screen">
      <Navbar session={session} />
      <main className="mx-auto grid max-w-[1600px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        <div className="min-w-0 space-y-6">
          <EndpointForm projectKey={projectKey} onCreated={add} />

          <section aria-labelledby="endpoints-title" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 id="endpoints-title" className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-300">
                <Zap aria-hidden className="size-4 text-emerald-400" />
                Endpoints <span className="font-mono text-zinc-500">({endpoints.length})</span>
              </h2>
              {error && (
                <button type="button" onClick={reload} className={secondaryButton}>
                  <RefreshCw aria-hidden className="size-4" />
                  Retry
                </button>
              )}
            </div>

            {loading && endpoints.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-zinc-400">
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
                Loading endpoints…
              </p>
            ) : error ? (
              <p role="alert" className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                <CircleAlert aria-hidden className="size-4" />
                {error}
              </p>
            ) : endpoints.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
                No endpoints yet. Create one above, then point your app at its proxy URL.
              </p>
            ) : (
              <div className="grid gap-4 2xl:grid-cols-2">
                {endpoints.map((endpoint) => (
                  <ErrorBoundary
                    key={endpoint.id}
                    fallback={(reset) => <PanelCrashFallback title={`Endpoint “${String(endpoint.name)}”`} onRetry={reset} />}
                  >
                    <EndpointCard endpoint={endpoint} onUpdated={replace} onDelete={remove} />
                  </ErrorBoundary>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="lg:sticky lg:top-20 lg:h-[calc(100vh-6.5rem)]">
          <ErrorBoundary fallback={(reset) => <PanelCrashFallback title="Live telemetry" onRetry={reset} />}>
            <RequestLogPanel projectKey={projectKey} />
          </ErrorBoundary>
        </aside>
      </main>
    </div>
  );
}
