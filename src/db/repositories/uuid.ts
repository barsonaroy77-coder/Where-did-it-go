/**
 * Cryptographic UUID v4 generator.
 * Uses globalThis.crypto.randomUUID() supported natively across Hermes,
 * React Native 0.70+, Node.js, and modern browser runtimes.
 * Falls back to RFC4122 v4 pattern using Math.random() if crypto is unavailable.
 */
export function generateClientUuid(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }

  // RFC4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
