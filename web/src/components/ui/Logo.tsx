import { Zap } from 'lucide-react';

export function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-11' : 'size-8';
  const icon = size === 'lg' ? 'size-6' : 'size-4.5';
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`${box} grid place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 shadow-lg shadow-emerald-500/20`}
      >
        <Zap aria-hidden className={`${icon} fill-zinc-950 text-zinc-950`} />
      </span>
      <span className={`${size === 'lg' ? 'text-2xl' : 'text-base'} font-semibold tracking-tight text-zinc-50`}>
        Pocket<span className="text-emerald-400">Chaos</span>
      </span>
    </div>
  );
}
