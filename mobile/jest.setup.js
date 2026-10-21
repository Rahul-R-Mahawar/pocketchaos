/* global jest */
// In-memory AsyncStorage for tests (official mock shipped with the package).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Icon fonts load through expo-asset, which has no asset registry under Jest. Icons are decorative here.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
