import { useCallback, useEffect, useRef, useState } from 'react';

export type CopyState = 'idle' | 'copied' | 'failed';

export function useCopyToClipboard(resetAfterMs = 2_000): { state: CopyState; copy: (text: string) => Promise<void> } {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text: string) => {
      try {
        if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
        await navigator.clipboard.writeText(text);
        setState('copied');
      } catch {
        setState('failed');
      }
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), resetAfterMs);
    },
    [resetAfterMs],
  );

  return { state, copy };
}
