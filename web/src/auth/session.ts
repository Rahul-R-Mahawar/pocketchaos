import { z } from 'zod';
import type { AuthPayload } from '../api/types';

/**
 * The session survives reloads in localStorage. Trade-off: any XSS could read it, which is why the
 * dashboard never renders server or upstream content as HTML. Stored data is re-validated on load.
 */
export const SESSION_STORAGE_KEY = 'pocketchaos.session';

const sessionSchema = z.object({
  token: z.string().min(1),
  user: z.object({
    id: z.string(),
    email: z.string(),
    projectKey: z.string().regex(/^[A-Z0-9]{6}$/),
    createdAt: z.string(),
  }),
});

export type Session = z.infer<typeof sessionSchema>;

export function sessionFromAuth(payload: AuthPayload): Session {
  return { token: payload.token, user: payload.user };
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = sessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable (private mode, quota): the session still works until the tab closes.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
