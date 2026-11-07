import * as Crypto from 'expo-crypto';

/**
 * Cryptographic UUID v4 generator.
 * Uses expo-crypto's randomUUID() per PRD v4.0 requirements.
 *
 * NOTE: Adding expo-crypto introduces native code and requires a new development build.
 */
export function generateClientUuid(): string {
  return Crypto.randomUUID();
}
