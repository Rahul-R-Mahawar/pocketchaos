import AsyncStorage from '@react-native-async-storage/async-storage';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import type { Transport } from '../api/http';
import type { PairData } from '../api/pocketChaosApi';
import { InspectorProvider } from '../components/InspectorModal';
import { ConfigProvider } from '../state/ConfigContext';
import { QueueProvider } from '../state/QueueContext';
import { RunnerProvider } from '../state/RunnerContext';
import { makePairedEndpoint, MemoryStorage, sequentialIds } from './fakes';

export const BASE_URL = 'http://192.168.1.20:4000';

export const PAIR_DATA: PairData = {
  projectKey: 'K7Q2XM',
  proxyBasePath: '/proxy/K7Q2XM',
  endpoints: [
    makePairedEndpoint({
      id: 'e1',
      name: 'Profile',
      path: '/users/profile',
      chaosConfig: { enabled: true, delayMs: 1500, failureRate: 50, overrideStatusCode: 503, corruptJson: true },
    }),
    makePairedEndpoint({ id: 'e2', name: 'Create order', method: 'POST', path: '/orders', proxyPath: '/proxy/K7Q2XM/orders' }),
  ],
};

/** Seeds AsyncStorage as if the device had already paired, so screens start in the paired state. */
export async function seedPaired(data: PairData = PAIR_DATA) {
  await AsyncStorage.setItem(
    '@pocketchaos/config/v1',
    JSON.stringify({ presetId: 'custom', port: 4000, customUrl: BASE_URL, projectKey: data.projectKey }),
  );
  await AsyncStorage.setItem('@pocketchaos/pairing/v1', JSON.stringify({ baseUrl: BASE_URL, pairedAt: '2026-10-21T10:00:00.000Z', data }));
}

export async function renderApp(ui: ReactElement, options: { transport: Transport; hostUri?: string | null; storage?: MemoryStorage }) {
  const storage = options.storage ?? new MemoryStorage();
  const result = await render(
    <ConfigProvider transport={options.transport} hostUri={options.hostUri ?? '192.168.1.20:8081'}>
      <QueueProvider storage={storage} newId={sequentialIds()}>
        <RunnerProvider newId={sequentialIds()} resilience={{ sleep: async () => undefined, random: () => 1 }}>
          <InspectorProvider>{ui}</InspectorProvider>
        </RunnerProvider>
      </QueueProvider>
    </ConfigProvider>,
  );
  return { ...result, storage };
}
