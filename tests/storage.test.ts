import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { __setKV, type KV } from '@shared/kv';
import { getVault, setVault, clearVault, getSettings, setSettings, onSettingsChanged } from '@shared/storage';
import type { Settings, StoredVault } from '@shared/types';

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

describe('chromeKV backward-compat: object-valued chrome.storage → JSON string', () => {
  afterEach(() => {
    delete (globalThis as any).chrome;
    __setKV(null);
  });

  it('rehydrates a legacy object-shaped vault written by an old extension install', async () => {
    // Ensure native path is NOT taken (no Capacitor global).
    delete (globalThis as any).Capacitor;
    // Reset the kv cache so getKV() re-runs platform detection.
    __setKV(null);

    // Mock chrome.storage.local.get returning an object (not a string).
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: VAULT }),
        },
      },
    };

    // getVault() calls getKV() → chromeKV.get → JSON.stringify(object) →
    // storage.ts parse<StoredVault>(JSON.stringify(VAULT)) → deep-equals VAULT.
    expect(await getVault()).toEqual(VAULT);
  });
});

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

describe('onSettingsChanged: in-process fan-out on native', () => {
  beforeEach(() => {
    (globalThis as any).Capacitor = { isNativePlatform: () => true };
    __setKV(memoryKV());
  });
  afterEach(() => {
    delete (globalThis as any).Capacitor;
    __setKV(null);
  });

  it('notifies subscribers with the new settings when they change', async () => {
    const seen: Settings[] = [];
    onSettingsChanged((s) => seen.push(s));
    await setSettings({ network: 'PUBLIC' });
    expect(seen.at(-1)?.network).toBe('PUBLIC');
    await setSettings({ autoLockMinutes: 5 });
    expect(seen.at(-1)).toMatchObject({ network: 'PUBLIC', autoLockMinutes: 5 });
    expect(seen).toHaveLength(2);
  });

  it('stops notifying after unsubscribe', async () => {
    const seen: Settings[] = [];
    const unsubscribe = onSettingsChanged((s) => seen.push(s));
    await setSettings({ network: 'PUBLIC' });
    unsubscribe();
    await setSettings({ network: 'TESTNET' });
    expect(seen).toHaveLength(1);
  });
});
