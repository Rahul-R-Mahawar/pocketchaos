/**
 * Local development without installing MongoDB: boots an in-memory mongod, then the normal API server.
 * Users, endpoints and logs are discarded when the process stops, so registered accounts do not survive a restart.
 * JWT_SECRET and CORS_ORIGINS still come from backend/.env or the environment, exactly as in production.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

async function main(): Promise<void> {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('pocketchaos');
  console.log('In-memory MongoDB ready (all data is discarded on exit)');
  // Loaded only now, because server.ts validates the environment (incl. MONGODB_URI) the moment it is required.
  // mongod is reaped together with this process.
  require('../src/server');
}

main().catch((err: unknown) => {
  console.error('Failed to start the in-memory dev server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
