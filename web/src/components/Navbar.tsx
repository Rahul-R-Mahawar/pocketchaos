import { KeyRound, LogOut, Smartphone } from 'lucide-react';
import { useAuth } from '../auth/context';
import type { Session } from '../auth/session';
import { CopyButton } from './ui/CopyButton';
import { Logo } from './ui/Logo';

export function Navbar({ session }: { session: Session }) {
  const { signOut } = useAuth();
  const { projectKey, email } = session.user;

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:flex-nowrap">
        <Logo />

        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 py-1 pl-3 pr-1">
          <KeyRound aria-hidden className="size-4 text-emerald-400" />
          <span className="hidden text-xs font-medium uppercase tracking-wider text-zinc-400 sm:inline">Project key</span>
          <output
            aria-label="Project key"
            className="font-mono text-lg font-bold tracking-[0.3em] text-emerald-300"
          >
            {projectKey}
          </output>
          <CopyButton text={projectKey} label="Copy pairing key for the mobile app" className="ml-1 bg-zinc-900">
            Copy Pairing Key
          </CopyButton>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1.5 text-xs text-zinc-500 2xl:flex">
            <Smartphone aria-hidden className="size-3.5" />
            Pair the mobile app with this key
          </span>
          <span className="hidden max-w-48 truncate text-sm text-zinc-400 xl:inline" title={email}>
            {email}
          </span>
          <button
            type="button"
            onClick={() => signOut()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <LogOut aria-hidden className="size-4" />
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
