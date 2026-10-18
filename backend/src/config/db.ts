import os from 'node:os';
import mongoose from 'mongoose';
import { ChaosEndpoint } from '../models/ChaosEndpoint';
import { RequestLog } from '../models/RequestLog';
import { User } from '../models/User';

export async function connectDatabase(uri: string): Promise<void> {
  mongoose.set('strictQuery', true);
  // Defence in depth against NoSQL operator injection: `$`-keys inside query filters are wrapped in $eq.
  mongoose.set('sanitizeFilter', true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    // Hand the driver `os` directly. Its default is a dynamic import('os'), which fails inside VM sandboxes
    // such as Jest; the driver then silently sends empty client metadata and the server rejects the handshake.
    runtimeAdapters: { os },
  });
  // Build indexes up front so unique constraints (email, projectKey, endpoint route) hold from the first request.
  await Promise.all([User.init(), ChaosEndpoint.init(), RequestLog.init()]);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
