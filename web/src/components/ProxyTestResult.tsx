import { CircleAlert, X } from 'lucide-react';
import type { ProxyTestResult as Result } from '../api/proxyTester';
import { formatMs } from '../lib/format';
import { classifyLog, describeTag, parseChaosTags, SEVERITY_STYLES } from '../lib/telemetry';

export function ProxyTestResult({ result, onDismiss }: { result: Result; onDismiss: () => void }) {
  return (
    <div role="status" aria-live="polite" className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        {result.kind === 'response' ? (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-md px-2 py-0.5 font-mono text-xs font-semibold ring-1 ${
                SEVERITY_STYLES[classifyLog({ statusReturned: result.status, chaosApplied: result.chaosApplied ?? 'none' })].badge
              }`}
            >
              {result.status}
            </span>
            <span className="font-mono text-xs text-zinc-400">{formatMs(result.latencyMs)}</span>
            {parseChaosTags(result.chaosApplied ?? 'none').map((tag, index) => (
              <span key={`${index}-${tag.kind}`} className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                {describeTag(tag)}
              </span>
            ))}
          </div>
        ) : (
          <span className="flex items-center gap-1.5 text-red-300">
            <CircleAlert aria-hidden className="size-4" />
            {result.message}
          </span>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss test result"
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
      {result.kind === 'response' && (
        // Rendered as text only: forward-mode bodies come from an arbitrary upstream.
        <pre className="max-h-56 overflow-auto rounded-md bg-black/40 p-2 font-mono text-xs leading-relaxed text-zinc-300">
          {result.bodyPreview || '(empty body)'}
          {result.truncated && '\n… (truncated)'}
        </pre>
      )}
    </div>
  );
}
