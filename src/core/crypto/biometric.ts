// Biometric-unlock envelope (#23 Milestone 2a). A convenience unlock that gates
// the existing AES-GCM vault behind platform biometrics instead of a typed
// password each time — WITHOUT weakening the vault: the PBKDF2/AES-GCM vault
// (crypto/vault.ts) is untouched; this only stores the *password* in a second
// envelope so it can be released after a biometric check.
//
// Design (prime directive: no secret material leaves the device):
//   • A random 256-bit "wrapping key" lives in the device's biometric-gated
//     secure store (Android Keystore via the native adapter — a separate slice).
//   • The vault password is AES-GCM-encrypted under that key and the resulting
//     blob is kept in ordinary storage. The blob is useless without the wrapping
//     key, and the wrapping key can only be read after a successful biometric
//     auth. So biometric unlock = get wrapping key → unwrap password → run the
//     normal `UNLOCK` (decryptSecret) path. Keeping only the small key in the
//     hardware-backed store (bulk stays in KV) is the standard envelope pattern.
//
// This module is the PURE crypto core — no native calls, no storage. It's fully
// unit-testable with Web Crypto. The native biometric adapter, the enable/disable
// orchestration, and the Unlock-screen button are follow-up slices.

const enc = new TextEncoder();
const dec = new TextDecoder();

// Raw wrapping-key length: AES-256.
export const WRAPPING_KEY_BYTES = 32;

export interface WrappedSecret {
  algorithm: 'AES-GCM';
  iv: string; // base64
  ciphertext: string; // base64
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== WRAPPING_KEY_BYTES) {
    throw new Error(`Wrapping key must be ${WRAPPING_KEY_BYTES} bytes.`);
  }
  // Copy into a fresh ArrayBuffer-backed view (avoids SharedArrayBuffer typing).
  return crypto.subtle.importKey('raw', Uint8Array.from(raw), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** A fresh random 256-bit wrapping key — belongs in the biometric-gated store. */
export function generateWrappingKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(WRAPPING_KEY_BYTES));
}

/** AES-GCM-encrypt the vault password under the wrapping key. */
export async function wrapSecret(plaintext: string, wrappingKey: Uint8Array): Promise<WrappedSecret> {
  const key = await importAesKey(wrappingKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { algorithm: 'AES-GCM', iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ct)) };
}

export class BiometricUnwrapError extends Error {
  constructor() {
    super('Could not unlock with biometrics.');
    this.name = 'BiometricUnwrapError';
  }
}

/**
 * Recover the vault password from its envelope using the wrapping key. Throws
 * `BiometricUnwrapError` on any auth-tag mismatch (wrong key / tampered blob) —
 * never revealing which, never echoing the ciphertext.
 */
export async function unwrapSecret(wrapped: WrappedSecret, wrappingKey: Uint8Array): Promise<string> {
  const key = await importAesKey(wrappingKey);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(wrapped.iv) },
      key,
      fromBase64(wrapped.ciphertext),
    );
    return dec.decode(pt);
  } catch {
    throw new BiometricUnwrapError();
  }
}
