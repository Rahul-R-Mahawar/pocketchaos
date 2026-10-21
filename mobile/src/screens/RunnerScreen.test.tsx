import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { TransportError } from '../api/http';
import { json, scriptedTransport, type Scripted } from '../test/fakes';
import { BASE_URL, renderApp, seedPaired } from '../test/renderApp';
import { RunnerScreen } from './RunnerScreen';

const profile = { id: 7, name: 'Ada', email: 'ada@example.com', active: true };
const clean = json(profile, { 'x-pocketchaos-applied': 'none' });
const corrupted = json({ ...profile, id: '7' }, { 'x-pocketchaos-applied': 'corrupt_json:1' });
const fault: Scripted = {
  status: 503,
  headers: { 'content-type': 'application/json', 'x-pocketchaos-applied': 'failure:503' },
  bodyText: '{"chaosFault":true,"message":"Injected by PocketChaos"}',
};

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedPaired();
});

async function renderRunner(script: (call: number) => Scripted) {
  const { transport, requests } = scriptedTransport((_request, call) => script(call));
  const rendered = await renderApp(<RunnerScreen />, { transport });
  await screen.findByRole('button', { name: 'Run chaos batch' });
  return { ...rendered, requests };
}

describe('RunnerScreen', () => {
  it('asks to pair first when nothing is paired', async () => {
    await AsyncStorage.clear();
    await renderApp(<RunnerScreen />, { transport: scriptedTransport(() => json({})).transport });
    expect(await screen.findByText('Not paired yet')).toBeOnTheScreen();
  });

  it('runs a batch against the selected endpoint and summarises faults, timeouts and corruption', async () => {
    const replies = [clean, corrupted, fault, new TransportError('timeout', 'No response within 4000 ms', 4000), clean];
    const { requests } = await renderRunner((call) => replies[call - 1] as Scripted);

    await fireEvent.press(screen.getByRole('button', { name: 'Profile' }));
    await fireEvent(screen.getByLabelText('Exponential backoff retries'), 'valueChange', false);
    await fireEvent.press(screen.getByRole('button', { name: 'Run chaos batch' }));

    await waitFor(() => expect(screen.getByLabelText('Success: 40%')).toBeOnTheScreen());
    expect(requests).toHaveLength(5);
    expect(requests[0]?.url).toBe(`${BASE_URL}/proxy/K7Q2XM/users/profile`);
    expect(requests[0]?.headers['x-client-platform']).toBe('react-native');
    expect(requests[0]?.timeoutMs).toBe(4000);
    expect(screen.getByLabelText('4xx/5xx faults: 1')).toBeOnTheScreen();
    expect(screen.getByLabelText('Timeouts: 1')).toBeOnTheScreen();
    expect(screen.getByLabelText('Corrupted caught: 1')).toBeOnTheScreen();
    expect(screen.getByLabelText('Queued: 1')).toBeOnTheScreen();
    expect(screen.getByText(/Detector caught 1 of 1 injected corruptions/)).toBeOnTheScreen();
  });

  it('opens the inspector for a corrupted result with the exact deviation and raw body', async () => {
    const replies = [clean, corrupted];
    await renderRunner((call) => replies[call - 1] ?? clean);
    await fireEvent.press(screen.getByRole('button', { name: 'Profile' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Requests per endpoint: 5' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Run chaos batch' }));

    const row = await screen.findByRole('button', { name: /GET \/users\/profile, SCHEMA_CORRUPTION_DETECTED, status 200/ });
    await fireEvent.press(row);

    expect(await screen.findByText('Payload Inspector')).toBeOnTheScreen();
    expect(screen.getByText('id: type_changed (expected number, got string)')).toBeOnTheScreen();
    expect(screen.getByLabelText('Raw response body')).toHaveTextContent(/"id": "7"/);
    // Shown as the chaos summary and again in the response header list.
    expect(screen.getAllByText('corrupt_json:1').length).toBeGreaterThanOrEqual(2);
  });

  it('shows rate-limit guidance instead of running an oversized batch', async () => {
    await renderRunner(() => clean);
    // 2 endpoints × 20 × (3 retries + 1) = 160 attempts: allowed. The plan guard itself is unit-tested.
    await fireEvent.press(screen.getByRole('radio', { name: 'Requests per endpoint: 20' }));
    expect(screen.getByText(/40 requests · up to 120 attempts/)).toBeOnTheScreen();
  });

  it('never crashes on a non-JSON or broken success body', async () => {
    await renderRunner(() => ({ status: 200, headers: { 'content-type': 'application/json' }, bodyText: '{"broken": ' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Profile' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Run chaos batch' }));
    const rows = await screen.findAllByRole('button', { name: /INVALID_JSON/ });
    expect(rows.length).toBeGreaterThan(0);
    expect(within(rows[0]!).getByText('INVALID_JSON')).toBeOnTheScreen();
  });
});
