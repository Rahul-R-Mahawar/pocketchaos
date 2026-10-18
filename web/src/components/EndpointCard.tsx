import { Check, CircleAlert, FlaskConical, Globe, LoaderCircle, Server, Trash } from 'lucide-react';
import { useState } from 'react';
import { toApiError } from '../api/errors';
import type { ProxyTestResult as Result } from '../api/proxyTester';
import type { EndpointDto } from '../api/types';
import { useApi } from '../auth/context';
import { useChaosSync } from '../hooks/useChaosSync';
import { buildProxyUrl, methodStyle } from '../lib/format';
import { ChaosControls } from './ChaosControls';
import { ProxyTestResult } from './ProxyTestResult';
import { CopyButton } from './ui/CopyButton';
import { panel, secondaryButton } from './ui/styles';

interface EndpointCardProps {
  endpoint: EndpointDto;
  onUpdated: (endpoint: EndpointDto) => void;
  onDelete: (id: string) => Promise<void>;
}

function SaveIndicator({ state, error }: { state: string; error: string | null }) {
  return (
    <span aria-live="polite" className="flex min-h-5 items-center gap-1.5 text-xs">
      {state === 'saving' && (
        <>
          <LoaderCircle aria-hidden className="size-3.5 animate-spin text-zinc-400" />
          <span className="text-zinc-400">Saving…</span>
        </>
      )}
      {state === 'saved' && (
        <>
          <Check aria-hidden className="size-3.5 text-emerald-400" />
          <span className="text-emerald-300">Saved</span>
        </>
      )}
      {state === 'error' && (
        <>
          <CircleAlert aria-hidden className="size-3.5 text-red-400" />
          <span className="text-red-300">Not saved: {error}</span>
        </>
      )}
    </span>
  );
}

function hostOf(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function EndpointCard({ endpoint, onUpdated, onDelete }: EndpointCardProps) {
  const { api, apiBaseUrl, testProxy } = useApi();
  const { draft, change, saveState, error } = useChaosSync(endpoint, api.updateChaos, onUpdated);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<Result | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const proxyUrl = buildProxyUrl(apiBaseUrl, endpoint.proxyPath);

  async function runTest() {
    setTesting(true);
    try {
      setTestResult(await testProxy(proxyUrl, endpoint.method));
    } catch (error) {
      // The tester resolves every network outcome; this only guards against a bug in it.
      setTestResult({ kind: 'error', latencyMs: 0, message: error instanceof Error ? error.message : 'Test request failed' });
    } finally {
      setTesting(false);
    }
  }

  async function confirmDelete() {
    setDeleteError(null);
    try {
      await onDelete(endpoint.id);
    } catch (raw) {
      setDeleteError(toApiError(raw).message);
      setConfirmingDelete(false);
    }
  }

  return (
    <article aria-label={`${endpoint.method} ${endpoint.path}`} className={`${panel} flex flex-col gap-4 p-5`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold ring-1 ${methodStyle(endpoint.method)}`}>
              {endpoint.method}
            </span>
            <h3 className="truncate font-semibold text-zinc-100">{endpoint.name}</h3>
          </div>
          <p className="mt-1 truncate font-mono text-sm text-zinc-400">{endpoint.path}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
              endpoint.mode === 'forward' ? 'bg-sky-500/10 text-sky-300' : 'bg-zinc-800 text-zinc-300'
            }`}
            title={endpoint.targetUrl ?? 'Serves the stored mock response'}
          >
            {endpoint.mode === 'forward' ? <Globe aria-hidden className="size-3" /> : <Server aria-hidden className="size-3" />}
            {endpoint.mode === 'forward' ? hostOf(endpoint.targetUrl) : 'Mock'}
          </span>
          {draft.enabled && (
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-300">Chaos on</span>
          )}
        </div>
      </header>

      <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-black/30 py-1 pl-3 pr-1">
        <code className="min-w-0 flex-1 truncate text-xs text-emerald-200" title={proxyUrl}>
          {proxyUrl}
        </code>
        <CopyButton text={proxyUrl} label="Copy proxy URL" />
      </div>

      <ChaosControls config={draft} onChange={change} />

      <footer className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => void runTest()} disabled={testing} className={secondaryButton}>
            {testing ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <FlaskConical aria-hidden className="size-4" />}
            {testing ? 'Waiting for proxy…' : 'Test in Browser'}
          </button>
          <SaveIndicator state={saveState} error={error} />
        </div>

        {confirmingDelete ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-zinc-400">Delete endpoint and its logs?</span>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              className="rounded-md bg-red-500/90 px-2.5 py-1 font-medium text-white hover:bg-red-500"
            >
              Delete
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded-md px-2 py-1 text-zinc-400 hover:text-zinc-200">
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            aria-label={`Delete ${endpoint.method} ${endpoint.path}`}
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash aria-hidden className="size-4" />
          </button>
        )}
      </footer>

      {deleteError && (
        <p role="alert" className="text-sm text-red-300">
          Could not delete: {deleteError}
        </p>
      )}
      {testResult && <ProxyTestResult result={testResult} onDismiss={() => setTestResult(null)} />}
    </article>
  );
}
