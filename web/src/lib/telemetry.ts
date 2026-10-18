import type { RequestLogDto } from '../api/types';

/**
 * The proxy records what it did as comma-separated tags in `chaosApplied`
 * (backend/src/controllers/proxy.controller.ts), e.g. "delay:1500ms,failure:503" or "none".
 */
export type ChaosTag =
  | { kind: 'delay'; ms: number }
  | { kind: 'failure'; status: number }
  | { kind: 'corrupt'; fields: number }
  | { kind: 'corrupt-skipped'; reason: string }
  /** PocketChaos's own errors, not injected chaos: no_match, ssrf_blocked, upstream_* */
  | { kind: 'system'; code: string }
  | { kind: 'unknown'; raw: string };

const SYSTEM_TAG = /^(no_match|ssrf_blocked|upstream_[a-z_]+)$/;

export function parseChaosTags(chaosApplied: string): ChaosTag[] {
  return chaosApplied
    .split(',')
    .map((raw) => raw.trim())
    .filter((raw) => raw && raw !== 'none')
    .map((raw): ChaosTag => {
      let match = /^delay:(\d+)ms$/.exec(raw);
      if (match) return { kind: 'delay', ms: Number(match[1]) };
      match = /^failure:(\d{3})$/.exec(raw);
      if (match) return { kind: 'failure', status: Number(match[1]) };
      match = /^corrupt_json:(\d+)$/.exec(raw);
      if (match) return { kind: 'corrupt', fields: Number(match[1]) };
      match = /^corrupt_json:skipped_([a-z_]+)$/.exec(raw);
      if (match) return { kind: 'corrupt-skipped', reason: (match[1] ?? '').replace(/_/g, ' ') };
      if (SYSTEM_TAG.test(raw)) return { kind: 'system', code: raw };
      return { kind: 'unknown', raw };
    });
}

export type LogSeverity =
  | 'success'
  | 'redirect'
  /** Injected fault with a 5xx status. */
  | 'injected-error'
  /** Injected fault with a 4xx status. */
  | 'injected-warning'
  /** Successful status but the JSON body was corrupted. */
  | 'corrupted'
  /** PocketChaos itself refused or failed (unknown route, SSRF block, upstream down). */
  | 'system'
  | 'client-error'
  | 'server-error';

export function classifyLog(log: Pick<RequestLogDto, 'statusReturned' | 'chaosApplied'>): LogSeverity {
  const tags = parseChaosTags(log.chaosApplied);
  const failure = tags.find((tag) => tag.kind === 'failure');
  if (failure) return failure.status >= 500 ? 'injected-error' : 'injected-warning';
  if (tags.some((tag) => tag.kind === 'system')) return 'system';
  const status = log.statusReturned;
  if (status >= 500) return 'server-error';
  if (status >= 400) return 'client-error';
  if (tags.some((tag) => tag.kind === 'corrupt' && tag.fields > 0)) return 'corrupted';
  if (status >= 300) return 'redirect';
  return 'success';
}

export const SEVERITY_STYLES: Record<LogSeverity, { badge: string; label: string }> = {
  success: { badge: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30', label: 'OK' },
  redirect: { badge: 'bg-sky-500/15 text-sky-300 ring-sky-500/30', label: 'Redirect' },
  'injected-error': { badge: 'bg-red-500/15 text-red-300 ring-red-500/40', label: 'Injected fault' },
  'injected-warning': { badge: 'bg-amber-500/15 text-amber-300 ring-amber-500/40', label: 'Injected fault' },
  corrupted: { badge: 'bg-amber-500/15 text-amber-300 ring-amber-500/40', label: 'Corrupted JSON' },
  system: { badge: 'bg-violet-500/15 text-violet-300 ring-violet-500/30', label: 'PocketChaos error' },
  'client-error': { badge: 'bg-amber-500/10 text-amber-200 ring-amber-500/20', label: 'Client error' },
  'server-error': { badge: 'bg-red-500/10 text-red-200 ring-red-500/20', label: 'Server error' },
};

export function describeTag(tag: ChaosTag): string {
  switch (tag.kind) {
    case 'delay':
      return `+${tag.ms.toLocaleString('en-US')} ms`;
    case 'failure':
      return `fault ${tag.status}`;
    case 'corrupt':
      return tag.fields === 1 ? '1 field corrupted' : `${tag.fields} fields corrupted`;
    case 'corrupt-skipped':
      return `corruption skipped (${tag.reason})`;
    case 'system':
      return tag.code.replace(/_/g, ' ');
    case 'unknown':
      return tag.raw;
  }
}
