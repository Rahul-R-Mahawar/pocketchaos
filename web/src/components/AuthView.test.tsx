import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import type { AuthPayload } from '../api/types';
import { makeFakeApi, renderWithProviders, TEST_SESSION } from '../test/fixtures';
import { AuthView } from './AuthView';

const PAYLOAD: AuthPayload = { token: TEST_SESSION.token, projectKey: TEST_SESSION.user.projectKey, user: TEST_SESSION.user };

function renderAuth(api = makeFakeApi(), notice: string | null = null) {
  return renderWithProviders(<AuthView />, { api, auth: { session: null, notice } });
}

async function fill(email: string, password: string) {
  const user = userEvent.setup();
  if (email) await user.type(screen.getByLabelText('Email'), email);
  if (password) await user.type(screen.getByLabelText('Password'), password);
  return user;
}

describe('AuthView', () => {
  it('starts on the Log in tab and can switch to Register', async () => {
    renderAuth();
    expect(screen.getByRole('tab', { name: 'Log in' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Register' }));
    expect(screen.getByRole('tab', { name: 'Register' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });

  it('validates on the client before calling the API', async () => {
    const { api } = renderAuth();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(api.login).not.toHaveBeenCalled();
  });

  it('requires 8+ character passwords when registering', async () => {
    const { api } = renderAuth();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Register' }));
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Use at least 8 characters')).toBeInTheDocument();
    expect(api.register).not.toHaveBeenCalled();
  });

  it('clears a field error as soon as the input becomes valid, without another submit', async () => {
    renderAuth();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Register' }));
    await user.type(screen.getByLabelText('Email'), 'ada@example');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Use at least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Password'), '12');
    expect(screen.getByText('Use at least 8 characters')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Password'), '3');
    expect(screen.queryByText('Use at least 8 characters')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'false');

    await user.type(screen.getByLabelText('Email'), '.com');
    expect(screen.queryByText('Enter a valid email address')).not.toBeInTheDocument();
  });

  it('logs in with a trimmed email and stores the session', async () => {
    const api = makeFakeApi({ login: vi.fn().mockResolvedValue(PAYLOAD) });
    const { auth } = renderAuth(api);
    const user = await fill('  ada@example.com ', 'correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(api.login).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'correct-horse-1' });
    expect(auth.signIn).toHaveBeenCalledWith(PAYLOAD);
  });

  it('registers through the register endpoint', async () => {
    const api = makeFakeApi({ register: vi.fn().mockResolvedValue(PAYLOAD) });
    const { auth } = renderAuth(api);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Register' }));
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'long-enough-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(api.register).toHaveBeenCalledWith({ email: 'new@example.com', password: 'long-enough-1' });
    expect(auth.signIn).toHaveBeenCalledWith(PAYLOAD);
  });

  it('shows wrong credentials inline without signing anyone in or out', async () => {
    const api = makeFakeApi({
      login: vi.fn().mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password')),
    });
    const { auth } = renderAuth(api);
    const user = await fill('ada@example.com', 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
  });

  it('maps server field errors onto the matching input', async () => {
    const api = makeFakeApi({
      register: vi.fn().mockRejectedValue(
        new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', [
          { location: 'body', path: 'email', message: 'must be a valid email address' },
        ]),
      ),
    });
    renderAuth(api);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Register' }));
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'long-enough-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('must be a valid email address')).toBeInTheDocument();
  });

  it('explains why the user was signed out', () => {
    renderAuth(makeFakeApi(), 'Your session has expired. Please log in again.');
    expect(screen.getByRole('status')).toHaveTextContent('Your session has expired');
  });
});
