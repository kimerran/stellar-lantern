import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { __setKV, type KV } from '@shared/kv';
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
    lock();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).Capacitor;
  });

  it('routes to the in-process handler when running natively', async () => {
    const res = await sendMessage({ type: 'GET_STATUS' });
    expect(res).toEqual({ ok: true, data: { initialized: false, locked: true, address: null } });
  });
});
