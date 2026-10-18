import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/db';

/**
 * One in-memory MongoDB per test file. Jest isolates modules per file, so each file also gets its own
 * mongoose instance and files can run in parallel workers without sharing data.
 */
let server: MongoMemoryServer | undefined;

export async function startTestDatabase(): Promise<void> {
  server = await MongoMemoryServer.create();
  await connectDatabase(server.getUri('pocketchaos-test'));
}

export async function clearTestDatabase(): Promise<void> {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

export async function stopTestDatabase(): Promise<void> {
  await disconnectDatabase();
  await server?.stop();
  server = undefined;
}

/** Standard lifecycle: fresh database per file, empty collections per test. */
export function useTestDatabase(): void {
  beforeAll(startTestDatabase, 120_000);
  afterEach(clearTestDatabase);
  afterAll(stopTestDatabase);
}
