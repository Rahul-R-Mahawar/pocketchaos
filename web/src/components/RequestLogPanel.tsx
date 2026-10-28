import { Activity, CircleQuestionMark, Eraser, Globe, Pause, Play, Smartphone, TabletSmartphone, WifiOff } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { ApiError } from '../api/errors';
import type { ClientPlatform, RequestLogDto } from '../api/types';
import { useApi, useAuth } from '../auth/context';
import { usePolling } from '../hooks/usePolling';
import { formatClock, formatMs, methodStyle } from '../lib/format';
import { classifyLog, describeTag, parseChaosTags, SEVERITY_STYLES, type ChaosTag } from '../lib/telemetry';
import { panel } from './ui/styles';

export const LOG_POLL_INTERVAL_MS = 2_000;
export const PROJECT_GONE_NOTICE =
  'This project no longer exists on the server (an in-memory database resets when the backend restarts). Please register again.';

const PLATFORM_ICONS: Record<ClientPlatform, { icon: typeof Globe; label: string }> = {
  ios: { icon: Smartphone, label: 'iOS' },
  android: { icon: TabletSmartphone, label: 'Android' },
  web: { icon: Globe, label: 'Browser' },
  unknown: { icon: CircleQuestionMark, label: 'Unknown client' },
};

const TAG_STYLES: Record<ChaosTag['kind'], string> = {
  delay: 'bg-sky-500/10 text-sky-300',
  failure: 'bg-red-500/10 text-red-300',
  corrupt: 'bg-amber-500/10 text-amber-300',
  'corrupt-skipped': 'bg-zinc-800 text-zinc-400',
  system: 'bg-violet-500/10 text-violet-300',
  unknown: 'bg-zinc-800 text-zinc-300',
};

function LogRow({ log }: { log: RequestLogDto }) {
  const severity = classifyLog(log);
  const style = SEVERITY_STYLES[severity];
  const tags = parseChaosTags(log.chaosApplied);
  const platform = PLATFORM_ICONS[log.clientPlatform] ?? PLATFORM_ICONS.unknown;
  const PlatformIcon = platform.icon;

  return (
    <li data-severity={severity} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-zinc-800/30">
      <span
        className={`row-span-2 self-start rounded-md px-1.5 py-0.5 text-center font-mono text-xs font-semibold ring-1 ${style.badge}`}
        title={style.label}
        aria-label={`Status ${log.statusReturned}, ${style.label}`}
      >
        {log.statusReturned}
      </span>
      <div className="flex min-w-0 items-center gap-2">
        <span className={`rounded px-1 font-mono text-[10px] font-bold ring-1 ${methodStyle(log.method)}`}>{log.method}</span>
        <span className="truncate font-mono text-xs text-zinc-200" title={log.path}>
          {log.path}
        </span>
      </div>
      <span className="text-right font-mono text-xs text-zinc-400">{formatMs(log.latencyMs)}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {tags.length === 0 ? (
          <span className="text-[11px] text-zinc-600">no chaos</span>
        ) : (
          tags.map((tag, index) => (
            <span key={`${index}-${tag.kind}`} className={`rounded px-1.5 py-px text-[11px] ${TAG_STYLES[tag.kind]}`}>
              {describeTag(tag)}
            </span>
          ))
        )}
      </div>
      <span className="flex items-center justify-end gap-1.5 text-[11px] text-zinc-500">
        <PlatformIcon aria-label={platform.label} className="size-3.5" />
        <time dateTime={log.timestamp}>{formatClock(log.timestamp)}</time>
      </span>
    </li>
  );
}

export function RequestLogPanel({ projectKey }: { projectKey: string }) {
  const { api } = useApi();
  const { signOut } = useAuth();
  const [paused, setPaused] = useState(false);

  const fetchLogs = useCallback((signal: AbortSignal) => api.getLogs(projectKey, signal), [api, projectKey]);
  const handleError = useCallback(
    (error: ApiError) => {
      if (error.code === 'PROJECT_NOT_FOUND') signOut(PROJECT_GONE_NOTICE);
    },
    [signOut],
  );
  const { data, error, lastUpdatedAt } = usePolling(fetchLogs, {
    intervalMs: LOG_POLL_INTERVAL_MS,
    enabled: !paused,
    onError: handleError,
  });
  const allLogs = data?.logs ?? [];
  // "Clear" hides what is already on screen and keeps showing new requests. It only filters the view: the
  // server keeps its logs. The cutoff is the newest log's own server timestamp, so browser clock skew can't
  // hide new requests or bring old ones back.
  const [clearedAfter, setClearedAfter] = useState<number | null>(null);
  const logs = clearedAfter === null ? allLogs : allLogs.filter((log) => Date.parse(log.timestamp) > clearedAfter);
  const hiddenCount = allLogs.length - logs.length;
  const clear = () => {
    const newest = Math.max(...allLogs.map((log) => Date.parse(log.timestamp)));
    if (Number.isFinite(newest)) setClearedAfter(newest);
  };

  return (
    <section aria-labelledby="telemetry-title" className={`${panel} flex h-full min-h-96 flex-col overflow-hidden`}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Activity aria-hidden className="size-4 text-emerald-400" />
          <h2 id="telemetry-title" className="whitespace-nowrap text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Live telemetry
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <span aria-live="polite" className="flex items-center gap-1.5 whitespace-nowrap text-xs text-zinc-500">
            {paused ? (
              'Paused'
            ) : error ? (
              <>
                <WifiOff aria-hidden className="size-3.5 text-amber-400" />
                <span className="text-amber-300">Reconnecting…</span>
              </>
            ) : (
              <>
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                </span>
                Live{lastUpdatedAt ? ` · ${formatClock(lastUpdatedAt)}` : ''}
              </>
            )}
          </span>
          <button
            type="button"
            onClick={clear}
            disabled={logs.length === 0}
            aria-label="Clear requests shown"
            title="Clear: hide these requests and show only new ones"
            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Eraser aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setPaused((value) => !value)}
            aria-label={paused ? 'Resume live updates' : 'Pause live updates'}
            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            {paused ? <Play aria-hidden className="size-4" /> : <Pause aria-hidden className="size-4" />}
          </button>
        </div>
      </header>

      {error && !paused && (
        <p role="alert" className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-200">
          {error.message}
          {logs.length > 0 ? ' Showing the last known requests.' : ''}
        </p>
      )}

      {logs.length === 0 ? (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div>
            <Activity aria-hidden className="mx-auto mb-3 size-8 text-zinc-700" />
            <p className="text-sm text-zinc-400">
              {!data ? 'Loading telemetry…' : clearedAfter !== null ? 'Cleared. Waiting for new requests' : 'No requests yet'}
            </p>
            <p className="mt-1 text-xs text-zinc-600">Press “Test in Browser” on an endpoint or pair the mobile app.</p>
          </div>
        </div>
      ) : (
        <ol aria-label="Recent proxied requests" className="flex-1 divide-y divide-zinc-800/70 overflow-y-auto">
          {logs.map((log) => (
            <LogRow key={log.id} log={log} />
          ))}
        </ol>
      )}

      <footer className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-600">
        <span>
          {clearedAfter !== null
            ? `${logs.length} new since you cleared${hiddenCount > 0 ? ` · ${hiddenCount} older hidden` : ''}`
            : `Latest ${logs.length} of up to 50 requests`}{' '}
          · refreshes every {LOG_POLL_INTERVAL_MS / 1000}s
        </span>
        {clearedAfter !== null && hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setClearedAfter(null)}
            className="whitespace-nowrap rounded px-1.5 py-0.5 font-medium text-emerald-400 transition-colors hover:bg-zinc-800 hover:text-emerald-300"
          >
            Show all ({hiddenCount})
          </button>
        ) : null}
      </footer>
    </section>
  );
}
