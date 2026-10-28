import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import type { LogsResponse, RequestLogDto } from '../api/types';
import { makeFakeApi, makeLog, PROJECT_KEY, renderWithProviders } from '../test/fixtures';
import { LOG_POLL_INTERVAL_MS, PROJECT_GONE_NOTICE, RequestLogPanel } from './RequestLogPanel';

const response = (logs: RequestLogDto[]): LogsResponse => ({ projectKey: PROJECT_KEY, logs });
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

function renderPanel(getLogs = vi.fn().mockResolvedValue(response([]))) {
  const api = makeFakeApi({ getLogs });
  return { ...renderWithProviders(<RequestLogPanel projectKey={PROJECT_KEY} />, { api }), getLogs };
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility('visible');
});
afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

describe('RequestLogPanel', () => {
  it('fetches immediately, then polls GET /api/logs/:projectKey every 2 seconds', async () => {
    const { getLogs } = renderPanel();
    await flush();
    expect(getLogs).toHaveBeenCalledTimes(1);
    expect(getLogs).toHaveBeenCalledWith(PROJECT_KEY, expect.any(AbortSignal));

    await advance(LOG_POLL_INTERVAL_MS - 1);
    expect(getLogs).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(getLogs).toHaveBeenCalledTimes(2);
    await advance(LOG_POLL_INTERVAL_MS);
    expect(getLogs).toHaveBeenCalledTimes(3);
  });

  it('never overlaps requests: the next poll waits for a slow response', async () => {
    let release!: () => void;
    const getLogs = vi
      .fn()
      .mockImplementationOnce(() => new Promise<LogsResponse>((resolve) => (release = () => resolve(response([])))))
      .mockResolvedValue(response([]));
    renderPanel(getLogs);
    await advance(LOG_POLL_INTERVAL_MS * 3);
    expect(getLogs).toHaveBeenCalledTimes(1);

    release();
    await flush();
    await advance(LOG_POLL_INTERVAL_MS);
    expect(getLogs).toHaveBeenCalledTimes(2);
  });

  it('colours rows by what happened, not only by status', async () => {
    renderPanel(
      vi.fn().mockResolvedValue(
        response([
          makeLog({ statusReturned: 503, chaosApplied: 'delay:1500ms,failure:503', path: '/fault' }),
          makeLog({ statusReturned: 429, chaosApplied: 'failure:429', path: '/limited' }),
          makeLog({ statusReturned: 200, chaosApplied: 'corrupt_json:3', path: '/corrupt' }),
          makeLog({ statusReturned: 200, chaosApplied: 'none', path: '/ok' }),
          makeLog({ statusReturned: 404, chaosApplied: 'no_match', path: '/missing' }),
        ]),
      ),
    );
    await flush();

    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.dataset.severity)).toEqual([
      'injected-error',
      'injected-warning',
      'corrupted',
      'success',
      'system',
    ]);
    expect(screen.getByLabelText('Status 503, Injected fault')).toHaveClass('text-red-300');
    expect(screen.getByLabelText('Status 429, Injected fault')).toHaveClass('text-amber-300');
    expect(screen.getByLabelText('Status 200, Corrupted JSON')).toHaveClass('text-amber-300');
    expect(screen.getByLabelText('Status 200, OK')).toHaveClass('text-emerald-300');
    expect(screen.getByText('+1,500 ms')).toBeInTheDocument();
    expect(screen.getByText('3 fields corrupted')).toBeInTheDocument();
    expect(screen.getByText('1,500 ms', { exact: false })).toBeInTheDocument();
  });

  it('shows latency, method, path and client platform per row', async () => {
    renderPanel(
      vi.fn().mockResolvedValue(
        response([makeLog({ method: 'POST', path: '/orders', latencyMs: 1532, clientPlatform: 'android' })]),
      ),
    );
    await flush();
    expect(screen.getByText('/orders')).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('1,532 ms')).toBeInTheDocument();
    expect(screen.getByLabelText('Android')).toBeInTheDocument();
  });

  it('keeps the last good rows when a poll fails, and recovers', async () => {
    const getLogs = vi
      .fn()
      .mockResolvedValueOnce(response([makeLog({ path: '/kept' })]))
      .mockRejectedValueOnce(new ApiError(null, 'NETWORK_ERROR', 'Cannot reach the API'))
      .mockResolvedValue(response([makeLog({ path: '/fresh' })]));
    renderPanel(getLogs);
    await flush();
    await advance(LOG_POLL_INTERVAL_MS);

    expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach the API');
    expect(screen.getByText('/kept')).toBeInTheDocument();
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();

    await advance(LOG_POLL_INTERVAL_MS);
    expect(screen.getByText('/fresh')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('backs off after a 429 instead of hammering the rate limiter', async () => {
    const getLogs = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'Too many requests'))
      .mockResolvedValue(response([]));
    renderPanel(getLogs);
    await flush();
    await advance(LOG_POLL_INTERVAL_MS);
    expect(getLogs).toHaveBeenCalledTimes(1);
    await advance(LOG_POLL_INTERVAL_MS);
    expect(getLogs).toHaveBeenCalledTimes(2);
  });

  it('signs out when the project no longer exists (e.g. in-memory DB restarted)', async () => {
    const { auth } = renderPanel(
      vi.fn().mockRejectedValue(new ApiError(404, 'PROJECT_NOT_FOUND', 'No project found for this key')),
    );
    await flush();
    expect(auth.signOut).toHaveBeenCalledWith(PROJECT_GONE_NOTICE);
  });

  it('skips polls while the tab is hidden', async () => {
    const { getLogs } = renderPanel();
    await flush();
    setVisibility('hidden');
    await advance(LOG_POLL_INTERVAL_MS * 3);
    expect(getLogs).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await advance(LOG_POLL_INTERVAL_MS);
    expect(getLogs).toHaveBeenCalledTimes(2);
  });

  it('pauses and resumes', async () => {
    const { getLogs } = renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Pause live updates' }));
    await advance(LOG_POLL_INTERVAL_MS * 3);
    expect(getLogs).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Paused')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resume live updates' }));
    await flush();
    expect(getLogs).toHaveBeenCalledTimes(2);
  });

  it('aborts the in-flight request and stops polling on unmount', async () => {
    let signal: AbortSignal | undefined;
    const getLogs = vi.fn((_key: string, s?: AbortSignal) => {
      signal = s;
      return new Promise<LogsResponse>(() => undefined);
    });
    const { unmount } = renderPanel(getLogs);
    await flush();
    unmount();
    expect(signal?.aborted).toBe(true);
    await advance(LOG_POLL_INTERVAL_MS * 3);
    expect(getLogs).toHaveBeenCalledTimes(1);
  });

  it('Clear hides the requests already shown and keeps showing new ones; Show all brings them back', async () => {
    const older = [
      makeLog({ id: 'a', path: '/old-1', timestamp: '2026-10-28T10:00:01.000Z' }),
      makeLog({ id: 'b', path: '/old-2', timestamp: '2026-10-28T10:00:00.000Z' }),
    ];
    const newer = makeLog({ id: 'c', path: '/new', timestamp: '2026-10-28T10:00:05.000Z' });
    const getLogs = vi.fn().mockResolvedValue(response(older));
    renderPanel(getLogs);
    await flush();
    expect(screen.getByText('/old-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear requests shown' }));
    expect(screen.queryByText('/old-1')).not.toBeInTheDocument();
    expect(screen.getByText('Cleared. Waiting for new requests')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear requests shown' })).toBeDisabled();

    getLogs.mockResolvedValue(response([newer, ...older]));
    await advance(LOG_POLL_INTERVAL_MS);
    expect(screen.getByText('/new')).toBeInTheDocument();
    expect(screen.queryByText('/old-2')).not.toBeInTheDocument();
    expect(screen.getByText(/1 new since you cleared · 2 older hidden/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show all (2)' }));
    expect(screen.getByText('/old-1')).toBeInTheDocument();
    expect(screen.getByText('/new')).toBeInTheDocument();
  });

  it('cannot clear an empty list', async () => {
    renderPanel();
    await flush();
    expect(screen.getByRole('button', { name: 'Clear requests shown' })).toBeDisabled();
  });

  it('shows an empty state before any traffic', async () => {
    renderPanel();
    await flush();
    expect(screen.getByText('No requests yet')).toBeInTheDocument();
  });
});
