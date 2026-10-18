import { randomInt } from 'node:crypto';

// Uppercase letters and digits without look-alikes (0/O, 1/I) so keys are easy to type on a phone.
const PROJECT_KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PROJECT_KEY_LENGTH = 6;
export const PROJECT_KEY_REGEX = /^[A-Z0-9]{6}$/;

export function generateProjectKey(): string {
  let key = '';
  for (let i = 0; i < PROJECT_KEY_LENGTH; i += 1) {
    key += PROJECT_KEY_ALPHABET.charAt(randomInt(PROJECT_KEY_ALPHABET.length));
  }
  return key;
}
