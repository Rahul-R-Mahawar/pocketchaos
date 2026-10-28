import { LoaderCircle } from 'lucide-react';

/** Shown while the first requests wait on a backend that the hosting plan put to sleep. */
export function ServerWakingBanner() {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className="flex max-w-xl items-center gap-3 rounded-lg border border-amber-500/40 bg-zinc-900/95 px-4 py-2.5 text-sm text-amber-200 shadow-lg shadow-black/40"
      >
        <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
        <span>Waking up the server. On the free hosting plan this can take up to a minute.</span>
      </div>
    </div>
  );
}
