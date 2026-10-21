/**
 * QA: the same guarantees through the React providers and screens, where taps, renders and storage meet.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';
import { InspectorModal } from '../components/InspectorModal';
import { QUEUE_STORAGE_KEY } from '../queue/offlineQueue';
import type { RunResult } from '../runner/batchRunner';
import { OfflineScreen } from '../screens/OfflineScreen';
import { PairScreen } from '../screens/PairScreen';
import { useQueue } from '../state/QueueContext';
import { useRunner } from '../state/RunnerContext';
import { json, MemoryStorage, scriptedTransport, type Scripted } from '../test/fakes';
import { renderApp, seedPaired } from '../test/renderApp';

const CONFIG_KEY = '@pocketchaos/config/v1';

const probes: { queue: ReturnType<typeof useQueue> | null; runner: ReturnType<typeof useRunner> | null } = { queue: null, runner: null };
function Probes() {
  probes.queue = useQueue();
  probes.runner = useRunner();
  return null;
}
const queueApi = () => probes.queue as ReturnType<typeof useQueue>;
const runnerApi = () => probes.runner as ReturnType<typeof useRunner>;

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
        reason: 'simulated_offline',
        attempts: 0,
        lastError: null,
        inFlightSince: null,
      })),
    }),
  );
  return storage;
}

async function renderOffline(storage: MemoryStorage, script: (call: number) => Scripted) {
  const { transport, requests } = scriptedTransport((_request, call) => script(call));
  await renderApp(
    <View>
      <Probes />
      <OfflineScreen />
    </View>,
    { transport, storage },
  );
  await waitFor(() => expect(queueApi().ready && runnerApi().plan !== null).toBe(true));
  return requests;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedPaired();
});

describe('duplicate taps', () => {
  it('two Replay taps in the same frame run one sync: each queued request is sent once', async () => {
    const requests = await renderOffline(seededQueue(['/orders/a', '/orders/b', '/orders/c']), () => ({ status: 201 }));
    await act(async () => {
      void queueApi().replay();
      void queueApi().replay();
    });
    await waitFor(() => expect(screen.getByText('Delivered 3, rejected 0 of 3.')).toBeOnTheScreen());
    expect(requests.map((r) => r.headers['Idempotency-Key'])).toEqual(['key-1', 'key-2', 'key-3']);
  });

  it('two Run taps in the same frame start one batch, not two', async () => {
    const requests = await renderOffline(new MemoryStorage(), () => json({ ok: true }, { 'x-pocketchaos-applied': 'none' }));
    await act(async () => {
      void runnerApi().run();
      void runnerApi().run();
    });
    await waitFor(() => expect(runnerApi().running).toBe(false));
    // 2 endpoints × 5 requests.
    expect(requests).toHaveLength(10);
    expect(runnerApi().results).toHaveLength(10);
  });
});

describe('storage failures in the app', () => {
  it('a failed queue write mid-replay shows a notice, keeps the request queued, and the retry reuses its Idempotency-Key', async () => {
    const storage = seededQueue(['/orders/a', '/orders/b']);
    const requests = await renderOffline(storage, (call) => {
      if (call === 1) storage.failNextWrite = true;
      return { status: 201 };
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Replay & Sync Queue' }));
    expect(await screen.findByText(/Sync stopped: write failed/)).toBeOnTheScreen();
    expect(screen.getByText('2 pending')).toBeOnTheScreen();
    expect(screen.queryByText('sending')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Replay & Sync Queue' }));
    expect(await screen.findByText('Delivered 2, rejected 0 of 2.')).toBeOnTheScreen();
    expect(requests.map((r) => r.headers['Idempotency-Key'])).toEqual(['key-1', 'key-1', 'key-2']);
  });

  it('an unreadable saved queue is never overwritten by requests queued afterwards', async () => {
    const storage = seededQueue(['/orders/a', '/orders/b']);
    storage.failNextReadOf = QUEUE_STORAGE_KEY;
    await renderOffline(storage, () => ({ status: 201 }));
    expect(screen.getByText(/Could not read the saved offline queue/)).toBeOnTheScreen();

    await act(async () => {
      queueApi().setSimulateOffline(true);
    });
    await act(async () => {
      await runnerApi().run();
    });

    const saved = JSON.parse(storage.data.get(QUEUE_STORAGE_KEY) ?? '{}');
    expect(saved.items.slice(0, 2).map((item: { id: string }) => item.id)).toEqual(['key-1', 'key-2']);
    expect(saved.items).toHaveLength(12);
  });

  it('does not overwrite saved server settings when they could not be read at startup', async () => {
    const before = await AsyncStorage.getItem(CONFIG_KEY);
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('read failed'));
    await renderApp(<PairScreen />, { transport: scriptedTransport(() => json({})).transport });
    expect(await screen.findByLabelText('6-character pairing key')).toBeOnTheScreen();
    await act(async () => undefined);
    expect(await AsyncStorage.getItem(CONFIG_KEY)).toBe(before);
  });

  it('still pairs when the pairing cannot be saved', async () => {
    await AsyncStorage.clear();
    // The AsyncStorage mock's methods are plain jest.fn()s, which restoreMocks does not restore: do it by hand.
    const setItem = AsyncStorage.setItem as jest.Mock;
    const original = setItem.getMockImplementation();
    setItem.mockImplementation(async () => {
      throw new Error('disk full');
    });
    try {
      const pairing = { projectKey: 'K7Q2XM', proxyBasePath: '/proxy/K7Q2XM', endpoints: [] };
      await renderApp(<PairScreen />, { transport: scriptedTransport(() => json({ success: true, data: pairing })).transport });
      await fireEvent.changeText(await screen.findByLabelText('6-character pairing key'), 'k7q2xm');
      await fireEvent.press(screen.getByRole('button', { name: 'Pair device' }));
      expect(await screen.findByText(/Paired with K7Q2XM/)).toBeOnTheScreen();
      expect(setItem).toHaveBeenCalled();
    } finally {
      setItem.mockImplementation(original);
    }
  });
});

describe('simulated offline during a replay', () => {
  it('turning Simulate Offline on mid-replay stops the replay before the next request', async () => {
    const requests = await renderOffline(seededQueue(['/orders/a', '/orders/b', '/orders/c']), (call) => {
      if (call === 1) queueApi().setSimulateOffline(true);
      return { status: 201 };
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Replay & Sync Queue' }));
    expect(await screen.findByText(/Stopped at \/orders\/b \(Simulated offline mode is on\)/)).toBeOnTheScreen();
    expect(requests).toHaveLength(1);
    expect(screen.getByText('2 pending')).toBeOnTheScreen();
  });
});

describe('payload inspector', () => {
  it('shows a pathologically deep JSON body as text instead of crashing into the error boundary', async () => {
    const bodyText = '['.repeat(9_000) + ']'.repeat(9_000);
    const result = {
      id: 'r1', seq: 1, source: 'batch', endpointId: 'e1', endpointName: 'Profile', method: 'GET', path: '/users/profile',
      url: 'http://192.168.1.20:4000/proxy/K7Q2XM/users/profile', startedAt: '2026-10-21T10:00:00.000Z', outcome: 'success',
      status: 200, latencyMs: 12, attempts: [], requestHeaders: {}, requestBody: null, responseHeaders: { 'content-type': 'application/json' },
      bodyText, bodyTruncated: false, chaosApplied: 'none', integrity: null, injectedCorruption: 0, queued: null, errorMessage: null,
    } satisfies RunResult;
    await render(<InspectorModal result={result} onClose={() => undefined} />);
    expect(screen.queryByText('The inspector hit an unexpected error')).toBeNull();
    expect(screen.getByLabelText('Raw response body')).toHaveTextContent(bodyText);
  });
});
