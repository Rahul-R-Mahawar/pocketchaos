/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // Plain file crawling: a broken Watchman install makes Jest find zero tests and still exit 0.
  watchman: false,
  setupFiles: ['<rootDir>/jest.setup.js'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/.expo/'],
  clearMocks: true,
  restoreMocks: true,
};
