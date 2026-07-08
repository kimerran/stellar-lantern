// Biometric-unlock orchestration (#23 Milestone 2a). Ties the envelope crypto
// (biometric.ts) to two seams — a biometric-gated key store and ordinary KV — so
// the flow is platform-agnostic and unit-testable. The native adapter (Android
// Keystore) and the extension adapter (WebAuthn PRF) implement `BiometricStore`;
// this module never touches native APIs directly.
//
// Split of responsibilities:
//   • `BiometricStore` — the small 256-bit wrapping key, held behind a biometric
//     prompt in a hardware-backed store. Reading it requires a live biometric auth.
//   • KV — the wrapped-password blob (from `wrapSecret`), useless without the key.
// Enable = generate key → store it → wrap the password → save the blob. Unlock =
// read the blob → biometric-read the key → unwrap → hand the password to the
// normal `UNLOCK` path. Nothing here weakens the PBKDF2/AES-GCM vault.

import type { KV } from '@shared/kv';
import { generateWrappingKey, wrapSecret, unwrapSecret, type WrappedSecret } from './biometric';

// The wrapped-password envelope lives here in ordinary storage.
export const BIOMETRIC_BLOB_KEY = 'lantern.biometric';

/**
 * A biometric-gated store for the wrapping key. Implemented by the native adapter
 * (Android Keystore, a follow-up slice). `getKey` triggers the platform biometric
 * prompt and resolves to the key on success, or `null` if unavailable / cancelled
 * / not enrolled — a cancellation must never throw the caller into an error state.
 */
export interface BiometricStore {
  isAvailable(): Promise<boolean>;
  setKey(key: Uint8Array): Promise<void>;
  getKey(): Promise<Uint8Array | null>;
  clearKey(): Promise<void>;
}

export interface BiometricDeps {
  store: BiometricStore;
  kv: KV;
}

/** True once biometric unlock has been enrolled (a wrapped blob exists). */
export async function isBiometricEnabled(kv: KV): Promise<boolean> {
  return (await kv.get(BIOMETRIC_BLOB_KEY)) != null;
}

/**
 * Enrol biometric unlock for the given (already-verified) vault password. Mints a
 * fresh wrapping key into the biometric-gated store and saves the password
 * wrapped under it. Call only after the password has been confirmed (e.g. right
 * after a successful typed unlock), so a bad password can't be enrolled.
 */
export async function enableBiometricUnlock(password: string, deps: BiometricDeps): Promise<void> {
  const key = generateWrappingKey();
  await deps.store.setKey(key);
  const wrapped = await wrapSecret(password, key);
  await deps.kv.set(BIOMETRIC_BLOB_KEY, JSON.stringify(wrapped));
}

export type BiometricUnlockResult =
  | { ok: true; password: string }
  | { ok: false; reason: 'not-enrolled' | 'cancelled' | 'failed' };

/**
 * Attempt a biometric unlock. Returns the recovered vault password on success.
 * Fail-soft and typed so the UI can fall back to the password field:
 *  - `not-enrolled`: no blob saved.
 *  - `cancelled`: the biometric prompt was dismissed / unavailable (store → null).
 *  - `failed`: the blob is unreadable or doesn't match the key (tamper / re-enrol needed).
 * The recovered password still goes through the normal `UNLOCK` (`decryptSecret`),
 * so a `failed` here never yields access.
 */
export async function biometricUnlock(deps: BiometricDeps): Promise<BiometricUnlockResult> {
  const blob = await deps.kv.get(BIOMETRIC_BLOB_KEY);
  if (blob == null) return { ok: false, reason: 'not-enrolled' };

  let wrapped: WrappedSecret;
  try {
    wrapped = JSON.parse(blob) as WrappedSecret;
  } catch {
    return { ok: false, reason: 'failed' };
  }

  const key = await deps.store.getKey();
  if (key == null) return { ok: false, reason: 'cancelled' };

  try {
    return { ok: true, password: await unwrapSecret(wrapped, key) };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Turn biometric unlock off — clear both the wrapping key and the blob. */
export async function disableBiometricUnlock(deps: BiometricDeps): Promise<void> {
  await deps.store.clearKey();
  await deps.kv.remove(BIOMETRIC_BLOB_KEY);
}
