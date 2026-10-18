import { randomBytes } from 'node:crypto';

// Set before src/config/env.ts is imported. Values already in process.env win over backend/.env,
// so a developer's local .env can never leak into the test run.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.JWT_EXPIRES_IN = '1h';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.TRUST_PROXY = '0';
// Placeholder only: every test file connects to its own in-memory MongoDB (tests/helpers/db.ts).
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/pocketchaos-test-placeholder';
