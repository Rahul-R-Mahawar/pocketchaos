import { CircleAlert, LoaderCircle, LogIn, UserPlus } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { fieldErrorsFrom, toApiError } from '../api/errors';
import { useApi, useAuth } from '../auth/context';
import { Logo } from './ui/Logo';
import { inputClass, labelClass, panel, primaryButton } from './ui/styles';

type Mode = 'login' | 'register';
type Field = 'email' | 'password';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(mode: Mode, email: string, password: string): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address';
  if (!password) errors.password = 'Password is required';
  else if (mode === 'register' && password.length < 8) errors.password = 'Use at least 8 characters';
  else if (new TextEncoder().encode(password).length > 72) errors.password = 'Password must be at most 72 bytes';
  return errors;
}

export function AuthView() {
  const { api } = useApi();
  const { signIn, notice } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const ids = { email: useId(), password: useId() };

  const switchMode = (next: Mode) => {
    setMode(next);
    setFieldErrors({});
    setFormError(null);
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validate(mode, email, password);
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const credentials = { email: email.trim(), password };
      const payload = mode === 'login' ? await api.login(credentials) : await api.register(credentials);
      signIn(payload);
    } catch (raw) {
      const error = toApiError(raw);
      const serverFields = fieldErrorsFrom(error);
      if (Object.keys(serverFields).length > 0) setFieldErrors(serverFields);
      else setFormError(error.message);
      setSubmitting(false);
    }
  }

  const SubmitIcon = mode === 'login' ? LogIn : UserPlus;

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.12),transparent_60%)] px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo size="lg" />
          <p className="text-sm text-zinc-400">
            Chaos-test your mobile app's network layer: latency, faults and corrupted JSON, without touching the backend.
          </p>
        </div>

        <div className={`${panel} p-6`}>
          <div role="tablist" aria-label="Authentication" className="mb-6 grid grid-cols-2 rounded-lg bg-zinc-950 p-1">
            {(['login', 'register'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={mode === tab}
                onClick={() => switchMode(tab)}
                className={`rounded-md py-2 text-sm font-medium transition-colors ${
                  mode === tab ? 'bg-zinc-800 text-zinc-50 shadow' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab === 'login' ? 'Log in' : 'Register'}
              </button>
            ))}
          </div>

          {notice && (
            <p role="status" className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {notice}
            </p>
          )}

          <form noValidate onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor={ids.email} className={labelClass}>
                Email
              </label>
              <input
                id={ids.email}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? `${ids.email}-error` : undefined}
                className={inputClass(Boolean(fieldErrors.email))}
                placeholder="you@example.com"
              />
              {fieldErrors.email && (
                <p id={`${ids.email}-error`} className="mt-1 text-xs text-red-300">
                  {fieldErrors.email}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={ids.password} className={labelClass}>
                Password
              </label>
              <input
                id={ids.password}
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? `${ids.password}-error` : undefined}
                className={inputClass(Boolean(fieldErrors.password))}
                placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
              />
              {fieldErrors.password && (
                <p id={`${ids.password}-error`} className="mt-1 text-xs text-red-300">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            {formError && (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                {formError}
              </p>
            )}

            <button type="submit" disabled={submitting} className={`${primaryButton} w-full`}>
              {submitting ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <SubmitIcon aria-hidden className="size-4" />}
              {mode === 'login' ? 'Log in' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-zinc-500">
          Registering creates a 6-character project key for pairing the PocketChaos mobile app.
        </p>
      </div>
    </main>
  );
}
