import { describe, it, expect } from 'vitest';
import {
  generateMnemonic,
  isValidMnemonic,
  keypairFromMnemonic,
  importFromInput,
  isValidPublicKey,
} from '@core/wallet/wallet';
import {
  validateMnemonic as ourValidate,
  mnemonicToSeedSync as ourSeed,
} from '@core/wallet/mnemonic';
import {
  validateMnemonic as bip39Validate,
  mnemonicToSeedSync as bip39Seed,
} from 'bip39';

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

// Guards the English-only bip39 port (src/core/wallet/mnemonic.ts) against the
// upstream `bip39` package: behaviour must stay byte-for-byte identical for
// English mnemonics even though the port drops the other 9 wordlists.
describe('bip39 English parity', () => {
  it('derives the same seed as bip39 for the SEP-0005 vector', () => {
    expect(ourSeed(SEP5_MNEMONIC).toString('hex')).toBe(bip39Seed(SEP5_MNEMONIC).toString('hex'));
  });

  it('agrees with bip39 on generated + tampered mnemonics', () => {
    for (const strength of [128, 256] as const) {
      const m = generateMnemonic(strength);
      expect(ourValidate(m)).toBe(true);
      expect(bip39Validate(m)).toBe(true);
      expect(ourSeed(m).toString('hex')).toBe(bip39Seed(m).toString('hex'));
      // Flip the last word to a different valid English word -> bad checksum.
      const words = m.split(' ');
      words[words.length - 1] = words[words.length - 1] === 'zoo' ? 'zone' : 'zoo';
      const tampered = words.join(' ');
      expect(ourValidate(tampered)).toBe(bip39Validate(tampered));
    }
  });
});
