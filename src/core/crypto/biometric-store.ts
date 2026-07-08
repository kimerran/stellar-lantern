// Platform selector for the biometric-gated wrapping-key store (#23 M2a).
// Mirrors the `getKV` / `__setKV` seam in shared/kv.ts: the session handler asks
// for a `BiometricStore` here without knowing the platform.
//
// The real native adapter (Android Keystore, and later extension WebAuthn-PRF) is
// a follow-up slice — it will replace `UNAVAILABLE` for its platform. Until then
// every platform gets the unavailable store, so biometric unlock stays inert
// (never enrols, unlock reports "cancelled") rather than pretending to work.

import type { BiometricStore } from './biometric-unlock';

const UNAVAILABLE: BiometricStore = {
  isAvailable: () => Promise.resolve(false),
  setKey: () => Promise.reject(new Error('Biometric unlock is not available on this device yet.')),
  getKey: () => Promise.resolve(null),
  clearKey: () => Promise.resolve(),
};

let override: BiometricStore | null = null;

/** The biometric store for the current platform (unavailable until an adapter lands). */
export function getBiometricStore(): BiometricStore {
  return override ?? UNAVAILABLE;
}

/** Test seam — inject a fake store (mirrors `__setKV`). Pass `null` to reset. */
export function __setBiometricStore(store: BiometricStore | null): void {
  override = store;
}
