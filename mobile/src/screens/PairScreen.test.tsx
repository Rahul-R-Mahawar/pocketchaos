import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { TransportError } from '../api/http';
import { json, scriptedTransport } from '../test/fakes';
import { PAIR_DATA, renderApp } from '../test/renderApp';
import { PairScreen, sanitizeProjectKey } from './PairScreen';

beforeEach(async () => {
  await AsyncStorage.clear();
});

const resolvedUrl = () => screen.getByLabelText('Resolved backend URL');
const keyInput = () => screen.getByLabelText('6-character pairing key');

describe('sanitizeProjectKey', () => {
  it('uppercases, strips separators and caps at 6', () => {
    expect(sanitizeProjectKey('k7q-2xm9')).toBe('K7Q2XM');
    expect(sanitizeProjectKey(' ab c ')).toBe('ABC');
  });
});

describe('PairScreen', () => {
  it('enforces the 6-character uppercase key before allowing pairing', async () => {
    const { transport, requests } = scriptedTransport(() => json({}));
    await renderApp(<PairScreen />, { transport });

    await fireEvent.changeText(keyInput(), 'k7q');
    expect(keyInput().props.value).toBe('K7Q');
    expect(screen.getByText('3 more character(s)')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Pair device' })).toBeDisabled();
    expect(requests).toHaveLength(0);
  });

  it('defaults to the LAN host detected from the Expo dev server, on port 4000', async () => {
    await renderApp(<PairScreen />, { transport: scriptedTransport(() => json({})).transport, hostUri: '192.168.1.20:8081' });
    await waitFor(() => expect(resolvedUrl()).toHaveTextContent('http://192.168.1.20:4000'));
  });

  it('switches presets and ports', async () => {
    await renderApp(<PairScreen />, { transport: scriptedTransport(() => json({})).transport });
    await fireEvent.press(screen.getByRole('button', { name: 'Android Emulator' }));
    expect(resolvedUrl()).toHaveTextContent('http://10.0.2.2:4000');

    await fireEvent.changeText(screen.getByLabelText('Backend port'), '4100');
    expect(resolvedUrl()).toHaveTextContent('http://10.0.2.2:4100');

    await fireEvent.press(screen.getByRole('button', { name: 'Localhost' }));
    expect(resolvedUrl()).toHaveTextContent('http://localhost:4100');
  });

  it('validates a custom LAN/cloud URL', async () => {
    await renderApp(<PairScreen />, { transport: scriptedTransport(() => json({})).transport });
    await fireEvent.press(screen.getByRole('button', { name: 'Custom URL' }));
    await fireEvent.changeText(screen.getByLabelText('Custom URL (LAN IP or deployed)'), '192.168.1.50:4000');
    expect(screen.getByText(/including http/)).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Custom URL (LAN IP or deployed)'), 'https://api.pocketchaos.dev/');
    expect(resolvedUrl()).toHaveTextContent('https://api.pocketchaos.dev');
  });

  it('pairs and lists every endpoint with its active chaos rules', async () => {
    const { transport, requests } = scriptedTransport(() => json({ success: true, data: PAIR_DATA }));
    await renderApp(<PairScreen />, { transport });
    await fireEvent.changeText(keyInput(), 'K7Q2XM');
    await fireEvent.press(screen.getByRole('button', { name: 'Pair device' }));

    expect(await screen.findByText('Paired with K7Q2XM')).toBeOnTheScreen();
    expect(requests[0]?.url).toBe('http://192.168.1.20:4000/api/mobile/pair/K7Q2XM');
    expect(screen.getByText('+1500 ms')).toBeOnTheScreen();
    expect(screen.getByText('50% → 503')).toBeOnTheScreen();
    expect(screen.getByText('corrupt JSON')).toBeOnTheScreen();
    expect(screen.getByText('Chaos off: requests pass through')).toBeOnTheScreen();
    expect(screen.getByLabelText('POST /orders')).toBeOnTheScreen();
  });

  it('explains an unreachable backend with a device-specific hint', async () => {
    const { transport } = scriptedTransport(() => new TransportError('network', 'down', 3));
    await renderApp(<PairScreen />, { transport });
    await fireEvent.press(screen.getByRole('button', { name: 'Localhost' }));
    await fireEvent.changeText(keyInput(), 'K7Q2XM');
    await fireEvent.press(screen.getByRole('button', { name: 'Pair device' }));
    expect(await screen.findByText(/Cannot reach http:\/\/localhost:4000.*physical device/)).toBeOnTheScreen();
  });

  it('shows an unexpected (non-PocketChaos) response as an error instead of crashing', async () => {
    const { transport } = scriptedTransport(() => ({ status: 200, bodyText: '<html>captive portal</html>' }));
    await renderApp(<PairScreen />, { transport });
    await fireEvent.changeText(keyInput(), 'K7Q2XM');
    await fireEvent.press(screen.getByRole('button', { name: 'Pair device' }));
    expect(await screen.findByText(/Not a PocketChaos API response/)).toBeOnTheScreen();
  });

  it('tests the connection against /health', async () => {
    const { transport, requests } = scriptedTransport(() => ({ ...json({ success: true, data: { status: 'ok' } }), latencyMs: 37 }));
    await renderApp(<PairScreen />, { transport });
    await fireEvent.press(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Backend reachable (37 ms)')).toBeOnTheScreen();
    expect(requests[0]?.url).toBe('http://192.168.1.20:4000/health');
  });
});
