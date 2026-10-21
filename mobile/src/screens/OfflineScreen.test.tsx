import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';
import { QUEUE_STORAGE_KEY } from '../queue/offlineQueue';
import { json, MemoryStorage, scriptedTransport, type Scripted } from '../test/fakes';
import { BASE_URL, renderApp, seedPaired } from '../test/renderApp';
import { OfflineScreen } from './OfflineScreen';
import { RunnerScreen } from './RunnerScreen';

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedPaired();
});

function seededQueue(paths: string[]): MemoryStorage {
  const storage = new MemoryStorage();
  storage.data.set(
    QUEUE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      nextSeq: paths.length + 1,
      failed: [],
      items: paths.map((path, index) => ({
        id: `key-${index + 1}`,
        seq: index + 1,
        projectKey: 'K7Q2XM',
        endpointId: 'e2',
        endpointName: 'Create order',
        method: 'POST',
        path,
        body: '{"qty":1}',
        createdAt: '2026-10-21T10:00:00.000Z',
        reason: 'network_error',
        attempts: 0,
        lastError: null,
        inFlightSince: null,
      })),
    }),
  );
  return storage;
}

describe('OfflineScreen', () => {
  it('replays the queue in order with each request\'s idempotency key, then empties it', async () => {
    const { transport, requests } = scriptedTransport(() => ({ status: 201 }));
    await renderApp(<OfflineScreen />, { transport, storage: seededQueue(['/orders/a', '/orders/b', '/orders/c']) });
    expect(await screen.findByText('3 pending')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Replay & Sync Queue' }));
    expect(await screen.findByText('Delivered 3, rejected 0 of 3.')).toBeOnTheScreen();
    expect(requests.map((r) => [r.method, r.url, r.headers['Idempotency-Key'], r.body])).toEqual([
      ['POST', `${BASE_URL}/proxy/K7Q2XM/orders/a`, 'key-1', '{"qty":1}'],
      ['POST', `${BASE_URL}/proxy/K7Q2XM/orders/b`, 'key-2', '{"qty":1}'],
      ['POST', `${BASE_URL}/proxy/K7Q2XM/orders/c`, 'key-3', '{"qty":1}'],
    ]);
    expect(screen.getByText('0 pending')).toBeOnTheScreen();
  });

  it('stops at a 503 and keeps the remaining requests in order', async () => {
    const replies: Scripted[] = [{ status: 201 }, { status: 503 }];
    const { transport, requests } = scriptedTransport((_r, call) => replies[call - 1] ?? { status: 201 });
    await renderApp(<OfflineScreen />, { transport, storage: seededQueue(['/orders/a', '/orders/b', '/orders/c']) });
    await screen.findByText('3 pending');

    await fireEvent.press(screen.getByRole('button', { name: 'Replay & Sync Queue' }));
    expect(await screen.findByText(/Stopped at \/orders\/b \(HTTP 503\)/)).toBeOnTheScreen();
    expect(requests).toHaveLength(2);
    expect(screen.getByText('2 pending')).toBeOnTheScreen();
    expect(screen.getByLabelText('Queued POST /orders/b')).toBeOnTheScreen();
  });

  it('refuses to replay while offline mode is simulated', async () => {
    const { transport, requests } = scriptedTransport(() => ({ status: 201 }));
    await renderApp(<OfflineScreen />, { transport, storage: seededQueue(['/orders/a']) });
    await screen.findByText('1 pending');
    await fireEvent(screen.getByLabelText('Simulate Offline Mode'), 'valueChange', true);
    expect(screen.getByRole('button', { name: 'Replay & Sync Queue' })).toBeDisabled();
    expect(screen.getByText('Turn off Simulate Offline Mode to replay.')).toBeOnTheScreen();
    expect(requests).toHaveLength(0);
  });

  it('full journey: simulate offline → batch is queued and persisted → back online → replay delivers', async () => {
    const storage = new MemoryStorage();
    const { transport, requests } = scriptedTransport((request) =>
      request.method === 'POST' ? { status: 201 } : json({ ok: true }, { 'x-pocketchaos-applied': 'none' }),
    );
    await renderApp(
      <View>
        <OfflineScreen />
        <RunnerScreen />
      </View>,
      { transport, storage },
    );
    await screen.findByRole('button', { name: 'Run chaos batch' });

    await fireEvent(screen.getByLabelText('Simulate Offline Mode'), 'valueChange', true);
    await fireEvent.press(screen.getByRole('button', { name: 'Create order' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Run chaos batch' }));

    expect(await screen.findByText('5 pending')).toBeOnTheScreen();
    expect(requests).toHaveLength(0);
    expect(JSON.parse(storage.data.get(QUEUE_STORAGE_KEY) ?? '{}').items).toHaveLength(5);

    await fireEvent(screen.getByLabelText('Simulate Offline Mode'), 'valueChange', false);
    await fireEvent.press(screen.getByRole('button', { name: 'Replay & Sync Queue' }));
    await waitFor(() => expect(screen.getByText('Delivered 5, rejected 0 of 5.')).toBeOnTheScreen());
    expect(requests).toHaveLength(5);
    expect(new Set(requests.map((r) => r.headers['Idempotency-Key'])).size).toBe(5);
  });
});
