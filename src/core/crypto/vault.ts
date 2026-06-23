import type { VaultCipher } from '@shared/types';
import { PBKDF2_ITERATIONS } from '@shared/constants';

// AES-GCM encryption of a secret (mnemonic or S... seed) with a key derived
// from the user password via PBKDF2. Uses only Web Crypto primitives — never
// roll your own (AGENT §6). No secret is logged or persisted in plaintext.

const enc = new TextEncoder();
const dec = new TextDecoder();

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

async function deriveAesKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptSecret(plaintext: string, password: string): Promise<VaultCipher> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return {
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2',
    salt: toBase64(salt),
    iv: toBase64(iv),
    iterations: PBKDF2_ITERATIONS,
    ciphertext: toBase64(new Uint8Array(ct)),
  };
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Incorrect password.');
    this.name = 'WrongPasswordError';
  }
}

export async function decryptSecret(cipher: VaultCipher, password: string): Promise<string> {
  const salt = fromBase64(cipher.salt);
  const iv = fromBase64(cipher.iv);
  const key = await deriveAesKey(password, salt, cipher.iterations);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      fromBase64(cipher.ciphertext),
    );
    return dec.decode(pt);
  } catch {
    // AES-GCM auth tag mismatch == wrong password (or corrupt blob). Never
    // reveal which, never echo the ciphertext.
    throw new WrongPasswordError();
  }
}
