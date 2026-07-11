import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { __setKV, type KV } from '@shared/kv';
import { sendMessage } from '@shared/messages';
import { lock } from '@core/session/handler';
import { __setBiometricStore } from '@core/crypto/biometric-store';

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
    // Inject a deterministic unavailable biometric store: faking native above would
    // otherwise route GET_STATUS's availability probe into the real native adapter,
    // whose @capgo plugin *web* shim reports a mock availability under vitest (Node) —
    // making the assertion depend on a third-party stub. This keeps the unit test to
    // its actual subject (native message routing).
    __setBiometricStore({
      isAvailable: () => Promise.resolve(false),
      setKey: () => Promise.reject(new Error('unavailable')),
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
