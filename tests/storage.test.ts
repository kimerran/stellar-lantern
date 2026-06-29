import { describe, it, expect, beforeEach } from 'vitest';
import { __setKV, type KV } from '@shared/kv';
import { getVault, setVault, clearVault, getSettings, setSettings } from '@shared/storage';
import type { StoredVault } from '@shared/types';

function memoryKV(): KV {
  const store = new Map<string, string>();
  return {
    get: async (k) => (store.has(k) ? store.get(k)! : null),
    set: async (k, v) => void store.set(k, v),
    remove: async (k) => void store.delete(k),
  };
}

const VAULT: StoredVault = {
  version: 1,
  address: 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6',
  cipher: {
    algorithm: 'AES-GCM', kdf: 'PBKDF2', salt: 'c2FsdA==', iv: 'aXY=',
    iterations: 600000, ciphertext: 'Y2lwaGVy',
  },
};

describe('storage over the kv port', () => {
  beforeEach(() => __setKV(memoryKV()));

  it('returns null when no vault is stored', async () => {
    expect(await getVault()).toBeNull();
  });

  it('round-trips the vault through the kv port', async () => {
    await setVault(VAULT);
    expect(await getVault()).toEqual(VAULT);
    await clearVault();
    expect(await getVault()).toBeNull();
  });

  it('returns default settings and merges patches', async () => {
    const defaults = await getSettings();
    expect(defaults.network).toBe('TESTNET');
    expect(defaults.autoLockMinutes).toBe(15);
    const next = await setSettings({ network: 'PUBLIC' });
    expect(next.network).toBe('PUBLIC');
    expect((await getSettings()).network).toBe('PUBLIC');
  });
});
