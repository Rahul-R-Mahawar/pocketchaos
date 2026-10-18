import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PROJECT_KEY, renderWithProviders, TEST_SESSION } from '../test/fixtures';
import { Navbar } from './Navbar';

/** jsdom has no clipboard, and user-event installs its own stub in setup(), so ours goes in afterwards. */
function mockClipboard(writeText: (text: string) => Promise<void>) {
  const user = userEvent.setup();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return user;
}

describe('Navbar', () => {
  it('shows the project key prominently', () => {
    renderWithProviders(<Navbar session={TEST_SESSION} />);
    expect(screen.getByLabelText('Project key')).toHaveTextContent(PROJECT_KEY);
  });

  it('copies the pairing key for the mobile app', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = mockClipboard(writeText);
    renderWithProviders(<Navbar session={TEST_SESSION} />);

    await user.click(screen.getByRole('button', { name: /copy pairing key/i }));
    expect(writeText).toHaveBeenCalledWith(PROJECT_KEY);
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });

  it('says so when the clipboard is unavailable', async () => {
    const user = mockClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    renderWithProviders(<Navbar session={TEST_SESSION} />);
    await user.click(screen.getByRole('button', { name: /copy pairing key/i }));
    expect(await screen.findByText('Copy failed')).toBeInTheDocument();
  });

  it('logs out', async () => {
    const { auth } = renderWithProviders(<Navbar session={TEST_SESSION} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /log out/i }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });
});
