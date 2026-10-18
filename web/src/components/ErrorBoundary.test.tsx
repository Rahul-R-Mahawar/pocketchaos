import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EndpointDto } from '../api/types';
import { makeEndpoint, makeFakeApi, PROJECT_KEY, renderWithProviders, TEST_SESSION } from '../test/fixtures';
import { Dashboard } from './Dashboard';
import { AppCrashFallback, ErrorBoundary } from './ErrorBoundary';

// React logs every error a boundary catches; silence it and assert it happened instead.
const silenceReactErrorLog = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

const emptyLogs = () => vi.fn().mockResolvedValue({ projectKey: PROJECT_KEY, logs: [] });

describe('ErrorBoundary', () => {
  it('shows a recovery screen instead of a blank page when the dashboard crashes while rendering', async () => {
    const consoleError = silenceReactErrorLog();
    // Bypasses the client's shape check on purpose, to exercise the last line of defence.
    const api = makeFakeApi({ listEndpoints: vi.fn().mockResolvedValue(null as never), getLogs: emptyLogs() });
    renderWithProviders(
      <ErrorBoundary fallback={() => <AppCrashFallback />}>
        <Dashboard session={TEST_SESSION} />
      </ErrorBoundary>,
      { api },
    );

    expect(await screen.findByText('The dashboard hit an unexpected error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload dashboard/i })).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
  });

  it('contains a broken endpoint card so the rest of the dashboard keeps working', async () => {
    silenceReactErrorLog();
    const healthy = makeEndpoint({ id: 'a'.repeat(24), name: 'Healthy', path: '/healthy' });
    const broken = { ...makeEndpoint({ id: 'b'.repeat(24), name: 'Broken', path: '/broken' }), chaosConfig: undefined };
    const api = makeFakeApi({
      listEndpoints: vi.fn().mockResolvedValue([healthy, broken as unknown as EndpointDto]),
      getLogs: emptyLogs(),
    });
    renderWithProviders(<Dashboard session={TEST_SESSION} />, { api });

    expect(await screen.findByText('Endpoint “Broken” could not be displayed.')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'GET /healthy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Live telemetry' })).toBeInTheDocument();
  });

  it('lets a panel retry after a transient render error', async () => {
    silenceReactErrorLog();
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('transient');
      return <p>recovered</p>;
    }
    renderWithProviders(
      <ErrorBoundary fallback={(reset) => <button onClick={reset}>Retry</button>}>
        <Flaky />
      </ErrorBoundary>,
    );
    shouldThrow = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });
});
