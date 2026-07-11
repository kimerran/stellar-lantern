// Platform selector for the biometric-gated wrapping-key store (#23 M2a).
// Mirrors the `getKV` / `__setKV` seam in shared/kv.ts: the session handler asks
// for a `BiometricStore` here without knowing the platform.
//
// Native (Capacitor) → the real Keystore/Keychain adapter (secp-hardware-backed,
// device-verified). Extension/web → still unavailable (a WebAuthn-PRF adapter is
// a later follow-up), so biometric unlock stays inert there rather than pretending.

import { isNativePlatform } from '@shared/kv';
import type { BiometricStore } from './biometric-unlock';
import { nativeBiometricStore } from './biometric-store-native';

const UNAVAILABLE: BiometricStore = {
  isAvailable: () => Promise.resolve(false),
  setKey: () => Promise.reject(new Error('Biometric unlock is not available on this device yet.')),
  getKey: () => Promise.resolve(null),
  clearKey: () => Promise.resolve(),
};

let override: BiometricStore | null = null;

/** The biometric store for the current platform (unavailable off native for now). */
export function getBiometricStore(): BiometricStore {
  if (override) return override;
  return isNativePlatform() ? nativeBiometricStore : UNAVAILABLE;
}

/** Test seam — inject a fake store (mirrors `__setKV`). Pass `null` to reset. */
export function __setBiometricStore(store: BiometricStore | null): void {
  override = store;
}
