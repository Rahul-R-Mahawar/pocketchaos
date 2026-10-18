export function formatMs(ms: number): string {
  return `${Math.round(ms).toLocaleString('en-US')} ms`;
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('en-GB', { hour12: false });
}

/** Full proxy URL for an endpoint: the configured API origin plus the server-provided proxyPath. */
export function buildProxyUrl(apiBaseUrl: string, proxyPath: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}${proxyPath}`;
}

export const METHOD_STYLES: Record<string, string> = {
  GET: 'text-sky-300 bg-sky-500/10 ring-sky-500/30',
  POST: 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/30',
  PUT: 'text-amber-300 bg-amber-500/10 ring-amber-500/30',
  PATCH: 'text-violet-300 bg-violet-500/10 ring-violet-500/30',
  DELETE: 'text-red-300 bg-red-500/10 ring-red-500/30',
};

export function methodStyle(method: string): string {
  return METHOD_STYLES[method] ?? 'text-zinc-300 bg-zinc-500/10 ring-zinc-500/30';
}
