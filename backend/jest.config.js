/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  // Plain file crawling: avoids depending on a working Watchman install (a broken one makes Jest find no tests).
  watchman: false,
  testMatch: ['**/*.test.ts'],
  // Runs before any test module is imported, so src/config/env.ts validates against test values.
  setupFiles: ['<rootDir>/tests/setup/env.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  // Spies on shared Node core modules (dns, timers/promises) must never leak between tests.
  restoreMocks: true,
  // First run may download a MongoDB binary for mongodb-memory-server.
  testTimeout: 30_000,
};
