import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setKV, type KV } from '@shared/kv';
import { lastPersistRequest, persistedState, requestPersistentStorage } from '@shared/web/persist';

// The web app keeps the wallet in the browser (#238). Without persistent
// storage the browser may evict it under storage pressure, and Safari deletes a
// tab's storage after 7 days without a visit. After a wallet is created the app
// asks to persist, records the answer, and Settings shows the live state.

function memKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
}

const storage = (persist: boolean, persisted = persist) =>
  ({
    persist: vi.fn(async () => persist),
    persisted: vi.fn(async () => persisted),
  }) as unknown as StorageManager;

afterEach(() => __setKV(null));

describe('requestPersistentStorage', () => {
  it('asks once and records a grant', async () => {
    const kv = memKV();
    __setKV(kv);
    const s = storage(true);
    expect(await requestPersistentStorage(s, () => 1000)).toBe('persisted');
    expect(s.persist).toHaveBeenCalledTimes(1);
    expect(await lastPersistRequest()).toEqual({ result: 'persisted', at: 1000 });
  });

  it('records a denial, so Settings can keep reminding', async () => {
    __setKV(memKV());
    expect(await requestPersistentStorage(storage(false), () => 2000)).toBe('not-persisted');
    expect(await lastPersistRequest()).toEqual({ result: 'not-persisted', at: 2000 });
  });

  it('reports unsupported where the Storage API is missing, and records that too', async () => {
    __setKV(memKV());
    expect(await requestPersistentStorage(undefined, () => 3000)).toBe('unsupported');
    expect(await lastPersistRequest()).toEqual({ result: 'unsupported', at: 3000 });
  });

  it('treats a throwing persist() as not persisted, never as granted', async () => {
    __setKV(memKV());
    const s = {
      persist: async () => Promise.reject(new Error('nope')),
    } as unknown as StorageManager;
    expect(await requestPersistentStorage(s)).toBe('not-persisted');
  });
});

describe('persistedState', () => {
  it('reads the live state, which can change after the request (e.g. once installed)', async () => {
    expect(await persistedState(storage(false, true))).toBe('persisted');
    expect(await persistedState(storage(false, false))).toBe('not-persisted');
    expect(await persistedState(undefined)).toBe('unsupported');
  });

  it('is null before any request was made', async () => {
    __setKV(memKV());
    expect(await lastPersistRequest()).toBeNull();
  });
});
