import { describe, it, expect } from 'vitest';
import {
  generateMnemonic,
  isValidMnemonic,
  keypairFromMnemonic,
  importFromInput,
  isValidPublicKey,
} from '@core/wallet/wallet';

// SEP-0005 official test vector (test 1, account 0).
const SEP5_MNEMONIC =
  'illness spike retreat truth genius clock brain pass fit cave bargain toe';
const SEP5_ACCOUNT0_PUBLIC = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const SEP5_ACCOUNT0_SECRET = 'SBGWSG6BTNCKCOB3DIFBGCVMUPQFYPA2G4O34RMTB343OYPXU5DJDVMN';

describe('wallet derivation', () => {
  it('derives the known SEP-0005 address from the test-vector mnemonic', () => {
    const kp = keypairFromMnemonic(SEP5_MNEMONIC);
    expect(kp.publicKey()).toBe(SEP5_ACCOUNT0_PUBLIC);
  });

  it('generates a valid 12-word mnemonic', () => {
    const m = generateMnemonic(128);
    expect(m.split(' ')).toHaveLength(12);
    expect(isValidMnemonic(m)).toBe(true);
  });

  it('rejects an invalid mnemonic', () => {
    expect(isValidMnemonic('not a real mnemonic phrase at all nope nope nope nope')).toBe(false);
  });

  it('imports a mnemonic and stores the normalized phrase', () => {
    const res = importFromInput(`  ${SEP5_MNEMONIC.toUpperCase()}  `);
    expect(res.keypair.publicKey()).toBe(SEP5_ACCOUNT0_PUBLIC);
    expect(res.secretToStore).toBe(SEP5_MNEMONIC);
  });

  it('imports a raw S... secret seed', () => {
    const res = importFromInput(SEP5_ACCOUNT0_SECRET);
    expect(res.keypair.publicKey()).toBe(SEP5_ACCOUNT0_PUBLIC);
    expect(res.secretToStore).toBe(SEP5_ACCOUNT0_SECRET);
  });

  it('throws on garbage input', () => {
    expect(() => importFromInput('definitely not valid')).toThrow();
  });

  it('validates public keys', () => {
    expect(isValidPublicKey(SEP5_ACCOUNT0_PUBLIC)).toBe(true);
    expect(isValidPublicKey('GINVALID')).toBe(false);
  });
});
