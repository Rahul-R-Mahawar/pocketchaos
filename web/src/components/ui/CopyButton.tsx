import { Check, CircleAlert, Copy } from 'lucide-react';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

interface CopyButtonProps {
  text: string;
  label: string;
  /** Visible text; icon-only when omitted (the label is then used for screen readers). */
  children?: string;
  className?: string;
}

export function CopyButton({ text, label, children, className = '' }: CopyButtonProps) {
  const { state, copy } = useCopyToClipboard();
  const Icon = state === 'copied' ? Check : state === 'failed' ? CircleAlert : Copy;
  const visible = state === 'copied' ? 'Copied!' : state === 'failed' ? 'Copy failed' : children;

  return (
    <button
      type="button"
      onClick={() => void copy(text)}
      aria-label={children ? undefined : label}
      title={label}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-emerald-400 ${
        state === 'copied'
          ? 'text-emerald-300'
          : state === 'failed'
            ? 'text-red-300'
            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
      } ${className}`}
    >
      <Icon aria-hidden className="size-3.5" />
      {visible && <span>{visible}</span>}
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? 'Copied to clipboard' : state === 'failed' ? 'Could not copy' : ''}
      </span>
    </button>
  );
}
