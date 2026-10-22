import { TriangleAlert } from 'lucide-react';

export function ConfigError({ problems }: { problems: string[] }) {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div role="alert" className="max-w-lg rounded-xl border border-red-500/30 bg-red-500/5 p-6">
        <h1 className="mb-2 flex items-center gap-2 text-lg font-semibold text-red-200">
          <TriangleAlert aria-hidden className="size-5" />
          Dashboard is not configured
        </h1>
        <ul className="mb-4 list-inside list-disc font-mono text-sm text-red-200/90">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
        <p className="text-sm text-zinc-400">
          Copy <code className="text-zinc-200">web/.env.example</code> to <code className="text-zinc-200">web/.env</code>, set{' '}
          <code className="text-zinc-200">VITE_API_URL</code> to the backend origin and restart the dev server (or rebuild).
        </p>
      </div>
    </main>
  );
}
