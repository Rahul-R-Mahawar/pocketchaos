/** Shared Tailwind class strings, so forms and panels look the same everywhere. */
export const panel = 'rounded-xl border border-zinc-800 bg-zinc-900/60 shadow-sm shadow-black/40';

export const inputBase =
  'w-full rounded-lg border bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors focus:ring-2';

export function inputClass(hasError: boolean): string {
  return `${inputBase} ${
    hasError
      ? 'border-red-500/70 focus:border-red-500 focus:ring-red-500/30'
      : 'border-zinc-800 focus:border-emerald-500/60 focus:ring-emerald-500/20'
  }`;
}

export const labelClass = 'mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-400';

export const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 disabled:cursor-not-allowed disabled:opacity-60';

export const secondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-emerald-400 disabled:cursor-not-allowed disabled:opacity-60';
