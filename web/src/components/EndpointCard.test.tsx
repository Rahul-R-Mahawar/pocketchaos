import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import type { ProxyTester } from '../api/proxyTester';
import type { ChaosConfig, EndpointDto } from '../api/types';
import { SLIDER_DEBOUNCE_MS } from '../hooks/useChaosSync';
import { API_BASE_URL, deferred, makeEndpoint, makeFakeApi, PROJECT_KEY, renderWithProviders } from '../test/fixtures';
import { EndpointCard } from './EndpointCard';

function withChaos(endpoint: EndpointDto, chaos: Partial<ChaosConfig>): EndpointDto {
  return { ...endpoint, chaosConfig: { ...endpoint.chaosConfig, ...chaos } };
}

/** Echoes each PATCH back like the server does. */
function echoingApi(endpoint: EndpointDto) {
  let current = endpoint;
  return makeFakeApi({
    updateChaos: vi.fn(async (_id: string, patch: Partial<ChaosConfig>) => {
      current = withChaos(current, patch);
      return current;
    }),
  });
}

function renderCard(endpoint = makeEndpoint(), api = echoingApi(endpoint), testProxy?: ProxyTester) {
  const onUpdated = vi.fn();
  const onDelete = vi.fn().mockResolvedValue(undefined);
  const rendered = renderWithProviders(<EndpointCard endpoint={endpoint} onUpdated={onUpdated} onDelete={onDelete} />, {
    api,
    ...(testProxy ? { testProxy } : {}),
  });
  return { ...rendered, onUpdated, onDelete };
}

const chaosSwitch = () => screen.getByRole('switch', { name: 'Chaos enabled' });
const corruptSwitch = () => screen.getByRole('switch', { name: 'Corrupt JSON payload' });

afterEach(() => {
  vi.useRealTimers();
});

describe('EndpointCard', () => {
  it('shows the full proxy URL built from the API origin and proxyPath', () => {
    renderCard();
    expect(screen.getByText(`${API_BASE_URL}/proxy/${PROJECT_KEY}/users/profile`)).toBeInTheDocument();
  });

  it('toggles chaos optimistically and sends one immediate PATCH', async () => {
    const pending = deferred<EndpointDto>();
    const endpoint = makeEndpoint();
    const api = makeFakeApi({ updateChaos: vi.fn(() => pending.promise) });
    const { onUpdated } = renderCard(endpoint, api);

    await userEvent.setup().click(chaosSwitch());
    expect(chaosSwitch()).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(api.updateChaos).toHaveBeenCalledWith(endpoint.id, { enabled: true }));
    expect(await screen.findByText('Saving…')).toBeInTheDocument();

    await act(async () => pending.resolve(withChaos(endpoint, { enabled: true })));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(onUpdated).toHaveBeenCalledWith(withChaos(endpoint, { enabled: true }));
    expect(api.updateChaos).toHaveBeenCalledTimes(1);
  });

  it('coalesces a slider drag into one debounced PATCH with numeric values', async () => {
    vi.useFakeTimers();
    const endpoint = makeEndpoint();
    const api = echoingApi(endpoint);
    renderCard(endpoint, api);
    const latency = screen.getByLabelText('Latency');

    for (const value of ['500', '1500', '3000', '4200']) fireEvent.change(latency, { target: { value } });
    expect(screen.getByText('4,200 ms')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(SLIDER_DEBOUNCE_MS - 50));
    expect(api.updateChaos).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(api.updateChaos).toHaveBeenCalledTimes(1);
    expect(api.updateChaos).toHaveBeenCalledWith(endpoint.id, { delayMs: 4200 });
  });

  it('reaches both slider boundaries: delayMs 10000 and failureRate 100', async () => {
    vi.useFakeTimers();
    const endpoint = makeEndpoint();
    const api = echoingApi(endpoint);
    renderCard(endpoint, api);
    fireEvent.change(screen.getByLabelText('Latency'), { target: { value: '10000' } });
    fireEvent.change(screen.getByLabelText('Failure rate'), { target: { value: '100' } });
    await act(() => vi.advanceTimersByTimeAsync(SLIDER_DEBOUNCE_MS));
    expect(api.updateChaos).toHaveBeenCalledWith(endpoint.id, { delayMs: 10_000, failureRate: 100 });
    expect(screen.getByText('10,000 ms')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('sends the selected fault status immediately', async () => {
    const endpoint = makeEndpoint();
    const api = echoingApi(endpoint);
    renderCard(endpoint, api);
    await userEvent.setup().selectOptions(screen.getByLabelText('Fault status code'), '503');
    await waitFor(() => expect(api.updateChaos).toHaveBeenCalledWith(endpoint.id, { overrideStatusCode: 503 }));
  });

  it('shows null as the default 500, and keeps a non-preset status set through the API', () => {
    renderCard(makeEndpoint());
    expect(screen.getByLabelText('Fault status code')).toHaveValue('500');
    expect(screen.getByRole('option', { name: /500 Internal Server Error \(default\)/ })).toBeInTheDocument();
  });

  it('keeps a non-preset status (e.g. 418) selectable', () => {
    renderCard(withChaos(makeEndpoint(), { overrideStatusCode: 418 }));
    expect(screen.getByLabelText('Fault status code')).toHaveValue('418');
  });

  it('rolls back and explains when a PATCH fails', async () => {
    const endpoint = makeEndpoint();
    const api = makeFakeApi({
      updateChaos: vi.fn().mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'Too many requests, please slow down')),
    });
    renderCard(endpoint, api);

    await userEvent.setup().click(corruptSwitch());
    expect(await screen.findByText(/Not saved: Too many requests/)).toBeInTheDocument();
    expect(corruptSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('never lets a slow response overwrite a newer pending edit', async () => {
    vi.useFakeTimers();
    const endpoint = makeEndpoint();
    const first = deferred<EndpointDto>();
    const second = deferred<EndpointDto>();
    const api = makeFakeApi({
      updateChaos: vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
    });
    renderCard(endpoint, api);

    fireEvent.click(chaosSwitch());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(api.updateChaos).toHaveBeenNthCalledWith(1, endpoint.id, { enabled: true });

    // While the first PATCH is in flight, the user drags the failure slider.
    fireEvent.change(screen.getByLabelText('Failure rate'), { target: { value: '40' } });
    await act(() => vi.advanceTimersByTimeAsync(SLIDER_DEBOUNCE_MS));
    expect(api.updateChaos).toHaveBeenCalledTimes(1);

    // The first response still has failureRate 0. It must not reset the slider while the second PATCH is pending.
    await act(async () => first.resolve(withChaos(endpoint, { enabled: true })));
    expect(api.updateChaos).toHaveBeenNthCalledWith(2, endpoint.id, { failureRate: 40 });
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(chaosSwitch()).toHaveAttribute('aria-checked', 'true');

    await act(async () => second.resolve(withChaos(endpoint, { enabled: true, failureRate: 40 })));
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('"Test in Browser" hits the proxy URL with the endpoint method and shows the result as text', async () => {
    const testProxy = vi.fn().mockResolvedValue({
      kind: 'response',
      status: 503,
      latencyMs: 1520,
      chaosApplied: 'delay:1500ms,failure:503',
      contentType: 'text/html',
      bodyPreview: '<img src=x onerror="alert(1)">',
      truncated: false,
    });
    const endpoint = makeEndpoint({ method: 'POST' });
    renderCard(endpoint, echoingApi(endpoint), testProxy as unknown as ProxyTester);

    await userEvent.setup().click(screen.getByRole('button', { name: /test in browser/i }));
    expect(testProxy).toHaveBeenCalledWith(`${API_BASE_URL}${endpoint.proxyPath}`, 'POST');

    const result = await screen.findByRole('status');
    expect(result).toHaveTextContent('503');
    expect(result).toHaveTextContent('1,520 ms');
    expect(result).toHaveTextContent('fault 503');
    expect(result).toHaveTextContent('<img src=x onerror="alert(1)">');
    expect(result.querySelector('img')).toBeNull();
  });

  it('recovers if the proxy tester itself throws, instead of staying stuck on "Waiting for proxy…"', async () => {
    const testProxy = vi.fn().mockRejectedValue(new Error('tester crashed'));
    const endpoint = makeEndpoint();
    renderCard(endpoint, echoingApi(endpoint), testProxy as unknown as ProxyTester);

    await userEvent.setup().click(screen.getByRole('button', { name: /test in browser/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('tester crashed');
    expect(screen.getByRole('button', { name: /test in browser/i })).toBeEnabled();
  });

  it('asks for confirmation before deleting', async () => {
    const endpoint = makeEndpoint();
    const { onDelete } = renderCard(endpoint);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: `Delete GET ${endpoint.path}` }));
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(endpoint.id);
  });
});
