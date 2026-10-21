import { randomUUID } from 'expo-crypto';

/** Cryptographically random v4 UUID (Hermes has no global crypto.randomUUID). Used as idempotency keys. */
export function newId(): string {
  return randomUUID();
}
