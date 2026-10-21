import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { RunResult } from '../runner/batchRunner';
import { summarize } from '../runner/batchRunner';
import { ErrorBoundary } from './ErrorBoundary';
import { InspectorModal } from './InspectorModal';
import { SummaryCard } from './SummaryCard';

function result(overrides: Partial<RunResult> = {}): RunResult {
  return {
    id: 'r1',
    seq: 1,
    source: 'batch',
    endpointId: 'e1',
    endpointName: 'Profile',
    method: 'GET',
    path: '/users/profile',
    url: 'http://10.0.2.2:4000/proxy/K7Q2XM/users/profile',
    startedAt: '2026-10-21T10:00:00.000Z',
    outcome: 'http_5xx',
    status: 503,
    latencyMs: 1512,
    attempts: [
      { attempt: 1, status: 503, error: null, latencyMs: 1500, waitedMs: 0 },
      { attempt: 2, status: 503, error: null, latencyMs: 1512, waitedMs: 300 },
    ],
    requestHeaders: { 'x-client-platform': 'react-native', 'Idempotency-Key': 'abc' },
    requestBody: null,
    responseHeaders: { 'content-type': 'application/json', 'x-pocketchaos-applied': 'delay:1500ms,failure:503' },
    bodyText: '{"chaosFault":true,"message":"Injected by PocketChaos"}',
    bodyTruncated: false,
    chaosApplied: 'delay:1500ms,failure:503',
    integrity: null,
    injectedCorruption: 0,
    queued: 'http_503',
    errorMessage: null,
    ...overrides,
  };
}

describe('InspectorModal', () => {
  it('shows status, latency, retries, headers and the pretty-printed body', async () => {
    await render(<InspectorModal result={result()} onClose={() => undefined} />);
    expect(screen.getByText('503')).toBeOnTheScreen();
    expect(screen.getByText('1512 ms')).toBeOnTheScreen();
    expect(screen.getByText('#2 503 · 1512 ms · waited 300 ms')).toBeOnTheScreen();
    expect(screen.getByText('Idempotency-Key')).toBeOnTheScreen();
    expect(screen.getByText('queued: http_503')).toBeOnTheScreen();
    expect(screen.getByLabelText('Raw response body')).toHaveTextContent(/^\{\s+"chaosFault": true,\s+"message": "Injected by PocketChaos"\s+\}$/);
  });

  it('renders hostile or non-JSON bodies verbatim as text', async () => {
    const html = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    await render(<InspectorModal result={result({ bodyText: html, responseHeaders: { 'content-type': 'text/html' } })} onClose={() => undefined} />);
    expect(screen.getByLabelText('Raw response body')).toHaveTextContent(html);
  });

  it('flags truncated bodies and requests with no response', async () => {
    await render(
      <InspectorModal
        result={result({ status: null, latencyMs: null, bodyText: '', bodyTruncated: true, responseHeaders: {}, outcome: 'timeout', errorMessage: 'No response within 4000 ms' })}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText('no response')).toBeOnTheScreen();
    expect(screen.getByText('No response within 4000 ms')).toBeOnTheScreen();
    expect(screen.getByText('Truncated to the first 20,000 characters.')).toBeOnTheScreen();
  });

  it('labels replayed results as delivered, without claiming payload integrity', async () => {
    await render(<InspectorModal result={result({ source: 'replay', outcome: 'success', status: 200, queued: null })} onClose={() => undefined} />);
    expect(screen.getByText('Delivered (integrity not checked)')).toBeOnTheScreen();
  });

  it('closes', async () => {
    const onClose = jest.fn();
    await render(<InspectorModal result={result()} onClose={onClose} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Close inspector' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('SummaryCard', () => {
  it('shows the live metrics', async () => {
    const summary = summarize([
      result({ outcome: 'success', status: 200, latencyMs: 100, queued: null, attempts: [] }),
      result({ outcome: 'schema_corruption', status: 200, latencyMs: 300, queued: null, attempts: [], injectedCorruption: 2 }),
    ]);
    await render(<SummaryCard summary={summary} running={false} />);
    expect(screen.getByLabelText('Success: 50%')).toBeOnTheScreen();
    expect(screen.getByLabelText('Avg latency: 200 ms')).toBeOnTheScreen();
    expect(screen.getByLabelText('Corrupted caught: 1')).toBeOnTheScreen();
    expect(screen.getByText(/Detector caught 1 of 1 injected corruptions/)).toBeOnTheScreen();
  });
});

describe('ErrorBoundary', () => {
  it('contains a render crash and lets the user retry', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let explode = true;
    function Flaky() {
      if (explode) throw new Error('Cannot read properties of null');
      return <Text>recovered</Text>;
    }
    await render(
      <ErrorBoundary area="The chaos runner">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByText('The chaos runner hit an unexpected error')).toBeOnTheScreen();
    explode = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('recovered')).toBeOnTheScreen();
  });
});
