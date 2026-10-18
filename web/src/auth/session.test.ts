import { describe, expect, it } from 'vitest';
import { TEST_SESSION } from '../test/fixtures';
import { clearSession, loadSession, saveSession, SESSION_STORAGE_KEY } from './session';

describe('session storage', () => {
  it('round-trips a session through localStorage', () => {
    saveSession(TEST_SESSION);
    expect(loadSession()).toEqual(TEST_SESSION);
    clearSession();
    expect(loadSession()).toBeNull();
  });

  it.each([
    ['corrupted JSON', '{not json'],
    ['a missing token', JSON.stringify({ user: TEST_SESSION.user })],
    ['a malformed projectKey', JSON.stringify({ ...TEST_SESSION, user: { ...TEST_SESSION.user, projectKey: 'bad' } })],
  ])('ignores %s', (_label, raw) => {
    localStorage.setItem(SESSION_STORAGE_KEY, raw);
    expect(loadSession()).toBeNull();
  });
});
