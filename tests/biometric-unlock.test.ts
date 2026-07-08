import { describe, it, expect, beforeEach } from 'vitest';
import type { KV } from '@shared/kv';
import {
  BIOMETRIC_BLOB_KEY,
  enableBiometricUnlock,
  biometricUnlock,
  disableBiometricUnlock,
  isBiometricEnabled,
  type BiometricStore,
} from '@core/crypto/biometric-unlock';

// In-memory KV.
function memKv(): KV {
  const m = new Map<string, string>();
  return {
    get: (k) => Promise.resolve(m.get(k) ?? null),
    set: (k, v) => {
      m.set(k, v);
      return Promise.resolve();
    },
    remove: (k) => {
      m.delete(k);
      return Promise.resolve();
    },
  };
}

// A fake biometric store. `unlocked` simulates the user passing / dismissing the
// prompt; `available` simulates hardware presence.
function fakeStore(opts: { available?: boolean; unlocked?: boolean } = {}) {
  let key: Uint8Array | null = null;
  const state = { available: opts.available ?? true, unlocked: opts.unlocked ?? true };
  const store: BiometricStore = {
    isAvailable: () => Promise.resolve(state.available),
    setKey: (k) => {
      key = k;
      return Promise.resolve();
    },
    getKey: () => Promise.resolve(state.unlocked ? key : null),
    clearKey: () => {
      key = null;
      return Promise.resolve();
    },
  };
  return { store, state, peekKey: () => key, setKey: (k: Uint8Array | null) => (key = k) };
}

describe('biometric unlock orchestration', () => {
  let kv: KV;
  beforeEach(() => {
    kv = memKv();
  });

  it('enable → stores a wrapping key + a wrapped blob; unlock recovers the password', async () => {
    const s = fakeStore();
    expect(await isBiometricEnabled(kv)).toBe(false);

    await enableBiometricUnlock('hunter2', { store: s.store, kv });
    expect(await isBiometricEnabled(kv)).toBe(true);
    expect(s.peekKey()).not.toBeNull();
    expect(await kv.get(BIOMETRIC_BLOB_KEY)).toContain('AES-GCM');

    const res = await biometricUnlock({ store: s.store, kv });
    expect(res).toEqual({ ok: true, password: 'hunter2' });
  });

  it('reports not-enrolled before enabling', async () => {
    const s = fakeStore();
    expect(await biometricUnlock({ store: s.store, kv })).toEqual({ ok: false, reason: 'not-enrolled' });
  });

  it('reports cancelled when the biometric prompt is dismissed', async () => {
    const s = fakeStore();
    await enableBiometricUnlock('pw', { store: s.store, kv });
    s.state.unlocked = false; // user cancels / no auth
    expect(await biometricUnlock({ store: s.store, kv })).toEqual({ ok: false, reason: 'cancelled' });
  });

  it('reports failed when the stored key no longer matches the blob (re-enrol needed)', async () => {
    const s = fakeStore();
    await enableBiometricUnlock('pw', { store: s.store, kv });
    s.setKey(new Uint8Array(32)); // key rotated out from under the blob
    expect(await biometricUnlock({ store: s.store, kv })).toEqual({ ok: false, reason: 'failed' });
  });

  it('reports failed on an unreadable blob', async () => {
    const s = fakeStore();
    await kv.set(BIOMETRIC_BLOB_KEY, 'not-json');
    expect(await biometricUnlock({ store: s.store, kv })).toEqual({ ok: false, reason: 'failed' });
  });

  it('disable clears both the key and the blob', async () => {
    const s = fakeStore();
    await enableBiometricUnlock('pw', { store: s.store, kv });
    await disableBiometricUnlock({ store: s.store, kv });
    expect(await isBiometricEnabled(kv)).toBe(false);
    expect(s.peekKey()).toBeNull();
    expect(await biometricUnlock({ store: s.store, kv })).toEqual({ ok: false, reason: 'not-enrolled' });
  });
});
