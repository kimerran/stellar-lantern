import { describe, it, expect } from 'vitest';
import {
  generateWrappingKey,
  wrapSecret,
  unwrapSecret,
  BiometricUnwrapError,
  WRAPPING_KEY_BYTES,
  type WrappedSecret,
} from '@core/crypto/biometric';

describe('biometric unlock envelope', () => {
  it('round-trips the password with the correct wrapping key', async () => {
    const key = generateWrappingKey();
    const wrapped = await wrapSecret('correct horse battery staple', key);
    expect(wrapped.algorithm).toBe('AES-GCM');
    expect(await unwrapSecret(wrapped, key)).toBe('correct horse battery staple');
  });

  it('generates a 256-bit random key (distinct each time)', () => {
    const a = generateWrappingKey();
    const b = generateWrappingKey();
    expect(a.length).toBe(WRAPPING_KEY_BYTES);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('uses a fresh IV per wrap (same input → different ciphertext)', async () => {
    const key = generateWrappingKey();
    const a = await wrapSecret('pw', key);
    const b = await wrapSecret('pw', key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(await unwrapSecret(a, key)).toBe('pw');
    expect(await unwrapSecret(b, key)).toBe('pw');
  });

  it('rejects unwrapping with the wrong key (BiometricUnwrapError)', async () => {
    const wrapped = await wrapSecret('secret', generateWrappingKey());
    await expect(unwrapSecret(wrapped, generateWrappingKey())).rejects.toThrow(BiometricUnwrapError);
  });

  it('rejects a tampered ciphertext', async () => {
    const key = generateWrappingKey();
    const wrapped = await wrapSecret('secret', key);
    const tampered: WrappedSecret = { ...wrapped, ciphertext: flipLastByte(wrapped.ciphertext) };
    await expect(unwrapSecret(tampered, key)).rejects.toThrow(BiometricUnwrapError);
  });

  it('rejects a wrapping key of the wrong length', async () => {
    await expect(wrapSecret('x', new Uint8Array(16))).rejects.toThrow(/32 bytes/);
    const wrapped = await wrapSecret('x', generateWrappingKey());
    await expect(unwrapSecret(wrapped, new Uint8Array(31))).rejects.toThrow(/32 bytes/);
  });
});

// Flip the last byte of a base64 blob so its decoded bytes differ (GCM tag fails).
function flipLastByte(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const last = bytes.length - 1;
  bytes[last] = (bytes[last] ?? 0) ^ 0xff;
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return btoa(out);
}
