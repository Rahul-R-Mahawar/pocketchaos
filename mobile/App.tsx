import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import type { ComponentType } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { InspectorProvider } from './src/components/InspectorModal';
import { OfflineScreen } from './src/screens/OfflineScreen';
import { PairScreen } from './src/screens/PairScreen';
import { RunnerScreen } from './src/screens/RunnerScreen';
import { ConfigProvider } from './src/state/ConfigContext';
import { QueueProvider, useQueue } from './src/state/QueueContext';
import { RunnerProvider } from './src/state/RunnerContext';
import type { IconName } from './src/ui/primitives';
import { colors } from './src/ui/theme';

const Tab = createBottomTabNavigator();

const navigationTheme: Theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, primary: colors.accent, background: colors.bg, card: colors.surface, border: colors.border, text: colors.text },
};

/** Each tab gets its own boundary, so a crash in one screen never takes the others down. */
function guarded(area: string, Screen: ComponentType) {
  return function GuardedScreen() {
    return (
      <ErrorBoundary area={area}>
        <Screen />
      </ErrorBoundary>
    );
  };
}

const PairTab = guarded('Pairing', PairScreen);
const RunnerTab = guarded('The chaos runner', RunnerScreen);
const OfflineTab = guarded('The offline queue', OfflineScreen);

const TAB_ICONS: Record<string, IconName> = { Pair: 'link', Runner: 'flash', Offline: 'cloud-offline' };

function Tabs() {
  const { items } = useQueue();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text, fontWeight: '700' },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarIcon: ({ color, size }) => <Ionicons name={TAB_ICONS[route.name] ?? 'ellipse'} size={size} color={color} />,
      })}
    >
      <Tab.Screen name="Pair" component={PairTab} options={{ title: 'Pair & Server' }} />
      <Tab.Screen name="Runner" component={RunnerTab} options={{ title: 'Chaos Runner' }} />
      <Tab.Screen
        name="Offline"
        component={OfflineTab}
        options={{ title: 'Offline Queue', ...(items.length ? { tabBarBadge: items.length } : {}) }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary area="PocketChaos">
        <ConfigProvider>
          <QueueProvider>
            <RunnerProvider>
              <InspectorProvider>
                <NavigationContainer theme={navigationTheme}>
                  <StatusBar style="light" />
                  <Tabs />
                </NavigationContainer>
              </InspectorProvider>
            </RunnerProvider>
          </QueueProvider>
        </ConfigProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
