import type { Env } from '../../src/config/env';

/**
 * src/config/env.ts validates at import time, so each case loads it in an isolated module registry
 * with a controlled process.env. loadEnvFile is stubbed so a developer's backend/.env cannot fill the gaps.
 */
const VALID_ENV = {
  MONGODB_URI: 'mongodb://127.0.0.1:27017/pocketchaos',
  JWT_SECRET: 'x'.repeat(48),
  CORS_ORIGINS: 'http://localhost:5173, https://dashboard.example.com',
};
const MANAGED_KEYS = ['NODE_ENV', 'PORT', 'MONGODB_URI', 'JWT_SECRET', 'JWT_EXPIRES_IN', 'CORS_ORIGINS', 'TRUST_PROXY'];

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(MANAGED_KEYS.map((key) => [key, process.env[key]]));
  for (const key of MANAGED_KEYS) delete process.env[key];
  jest.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function loadEnv(vars: Record<string, string>): Readonly<Env> {
  Object.assign(process.env, vars);
  let loaded: Readonly<Env> | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = (require('../../src/config/env') as typeof import('../../src/config/env')).env;
  });
  return loaded as Readonly<Env>;
}

describe('env validation (CONTEXT.md §3.1)', () => {
  it('parses a valid environment and applies non-secret defaults', () => {
    const env = loadEnv(VALID_ENV);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      JWT_EXPIRES_IN: '7d',
      TRUST_PROXY: 0,
      CORS_ORIGINS: ['http://localhost:5173', 'https://dashboard.example.com'],
    });
    expect(Object.isFrozen(env)).toBe(true);
  });

  it.each([
    ['MONGODB_URI', /MONGODB_URI/],
    ['JWT_SECRET', /JWT_SECRET/],
    ['CORS_ORIGINS', /CORS_ORIGINS/],
  ])('refuses to start without %s (no hardcoded fallback)', (key, message) => {
    const vars: Record<string, string> = { ...VALID_ENV };
    delete vars[key];
    expect(() => loadEnv(vars)).toThrow(message);
  });

  it.each([
    ['a JWT_SECRET shorter than 32 characters', { JWT_SECRET: 'short-secret' }, /JWT_SECRET/],
    ['a non-Mongo MONGODB_URI', { MONGODB_URI: 'postgres://db/app' }, /MONGODB_URI/],
    ['a CORS origin that is not a URL', { CORS_ORIGINS: 'localhost:5173' }, /CORS_ORIGINS/],
    ['an empty CORS_ORIGINS list', { CORS_ORIGINS: ' , ' }, /CORS_ORIGINS/],
    ['PORT out of range', { PORT: '70000' }, /PORT/],
    ['a malformed JWT_EXPIRES_IN', { JWT_EXPIRES_IN: 'forever' }, /JWT_EXPIRES_IN/],
  ])('rejects %s', (_label, overrides, message) => {
    expect(() => loadEnv({ ...VALID_ENV, ...overrides })).toThrow(message);
  });

  it('never echoes secret values in the error', () => {
    const leakyUri = 'mysql://admin:hunter2-super-secret@db.internal/app';
    let message = '';
    try {
      loadEnv({ ...VALID_ENV, MONGODB_URI: leakyUri, JWT_SECRET: 'tiny-secret-value' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/MONGODB_URI/);
    expect(message).not.toContain('hunter2');
    expect(message).not.toContain('tiny-secret-value');
  });
});
