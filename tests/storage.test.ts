import { describe, it, expect, beforeEach } from 'vitest';
import {
  setKvStore,
  type KvStore,
  getVault,
  setVault,
  clearVault,
  getSettings,
  setSettings,
  onSettingsChanged,
} from '@shared/storage';
import type { StoredVault } from '@shared/types';

// An in-memory KvStore — the same injection point the Android (Capacitor
// Preferences) backend uses. Proves the wallet is host-agnostic.
function memoryKvStore(): KvStore {
  const map = new Map<string, unknown>();
  const subs = new Map<string, Set<(v: unknown) => void>>();
  return {
    async get<T>(key: string) {
      return (map.has(key) ? (map.get(key) as T) : null);
    },
    async set(key, value) {
      map.set(key, value);
      subs.get(key)?.forEach((cb) => cb(value));
    },
    async remove(key) {
      map.delete(key);
      subs.get(key)?.forEach((cb) => cb(undefined));
    },
    subscribe(key, cb) {
      const set = subs.get(key) ?? new Set();
      set.add(cb);
      subs.set(key, set);
      return () => set.delete(cb);
    },
  };
}

const SAMPLE_VAULT = {
  algorithm: 'AES-GCM',
  kdf: 'PBKDF2',
  iterations: 600_000,
  ciphertext: 'deadbeef',
} as unknown as StoredVault;

describe('storage seam (host-agnostic KvStore)', () => {
  beforeEach(() => setKvStore(memoryKvStore()));

  it('round-trips and clears the vault', async () => {
    expect(await getVault()).toBeNull();
    await setVault(SAMPLE_VAULT);
    expect(await getVault()).toEqual(SAMPLE_VAULT);
    await clearVault();
    expect(await getVault()).toBeNull();
  });

  it('returns defaults then merges setting patches', async () => {
    const def = await getSettings();
    expect(def.network).toBeDefined();
    expect(def.autoLockMinutes).toBeGreaterThan(0);

    const next = await setSettings({ network: 'PUBLIC' });
    expect(next.network).toBe('PUBLIC');
    // unspecified fields keep their defaults
    expect(next.autoLockMinutes).toBe(def.autoLockMinutes);
  });

  it('notifies subscribers on settings change', async () => {
    const seen: string[] = [];
    const off = onSettingsChanged((s) => seen.push(s.network));
    await setSettings({ network: 'PUBLIC' });
    await setSettings({ network: 'TESTNET' });
    off();
    await setSettings({ network: 'PUBLIC' });
    expect(seen).toEqual(['PUBLIC', 'TESTNET']); // none after unsubscribe
  });
});
