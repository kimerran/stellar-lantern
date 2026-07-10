import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { __setKV, type KV } from '@shared/kv';
import { __setBiometricStore } from '@core/crypto/biometric-store';
import { sendMessage } from '@shared/messages';
import { lock } from '@core/session/handler';

function memoryKV(): KV {
  const store = new Map<string, string>();
  return {
    get: async (k) => (store.has(k) ? store.get(k)! : null),
    set: async (k, v) => void store.set(k, v),
    remove: async (k) => void store.delete(k),
  };
}

describe('sendMessage native branch', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).Capacitor = { isNativePlatform: () => true };
    __setKV(memoryKV());
    // Faking native platform would otherwise route GET_STATUS to the real
    // Keystore adapter (whose @capgo web shim reports biometrics available in
    // the test env). This test is about message routing, not device biometrics —
    // pin a deterministic unavailable store so the assertion doesn't depend on
    // the ambient plugin. On a real device this path uses the genuine plugin.
    __setBiometricStore({
      isAvailable: () => Promise.resolve(false),
      setKey: () => Promise.resolve(),
      getKey: () => Promise.resolve(null),
      clearKey: () => Promise.resolve(),
    });
    lock();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).Capacitor;
    __setBiometricStore(null);
  });

  it('routes to the in-process handler when running natively', async () => {
    const res = await sendMessage({ type: 'GET_STATUS' });
    expect(res).toEqual({
      ok: true,
      data: { initialized: false, locked: true, address: null, biometricEnabled: false, biometricAvailable: false },
    });
  });
});
