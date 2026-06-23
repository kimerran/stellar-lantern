import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, WrongPasswordError } from '@core/crypto/vault';

describe('vault crypto', () => {
  it('round-trips a secret with the correct password', async () => {
    const secret = 'illness spike retreat truth genius clock brain pass fit cave bargain toe';
    const cipher = await encryptSecret(secret, 'correct horse battery staple');

    expect(cipher.algorithm).toBe('AES-GCM');
    expect(cipher.kdf).toBe('PBKDF2');
    expect(cipher.iterations).toBeGreaterThanOrEqual(600_000);
    // ciphertext must not contain the plaintext
    expect(cipher.ciphertext).not.toContain('illness');

    const out = await decryptSecret(cipher, 'correct horse battery staple');
    expect(out).toBe(secret);
  });

  it('fails cleanly with a wrong password', async () => {
    const cipher = await encryptSecret('top secret', 'password-one');
    await expect(decryptSecret(cipher, 'password-two')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('uses a unique salt and iv per encryption', async () => {
    const a = await encryptSecret('x', 'pw');
    const b = await encryptSecret('x', 'pw');
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });
});
