import { describe, it, expect } from 'vitest';
import { keyToCredential, credentialToKey } from '@core/crypto/biometric-store-native';
import { generateWrappingKey } from '@core/crypto/biometric';

// The plugin persists a string credential; only the pure base64 codec that turns
// the 256-bit wrapping key in/out of that string is unit-testable off-device.
describe('native biometric store — key codec', () => {
  it('round-trips a 256-bit key through the credential string', () => {
    const key = generateWrappingKey();
    const decoded = credentialToKey(keyToCredential(key));
    expect(decoded).not.toBeNull();
    expect(Buffer.from(decoded!).equals(Buffer.from(key))).toBe(true);
  });

  it('preserves every byte value (0x00..0xff)', () => {
    const key = new Uint8Array(32);
    for (let i = 0; i < 32; i++) key[i] = (i * 8) & 0xff;
    expect(credentialToKey(keyToCredential(key))).toEqual(key);
  });

  it('rejects a credential that does not decode to exactly 32 bytes', () => {
    expect(credentialToKey(keyToCredential(new Uint8Array(16)))).toBeNull(); // too short
    expect(credentialToKey(keyToCredential(new Uint8Array(48)))).toBeNull(); // too long
  });

  it('rejects a non-base64 / corrupt credential', () => {
    expect(credentialToKey('not valid base64 !!!')).toBeNull();
  });
});
