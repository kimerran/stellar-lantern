import type { KV } from './kv';

// The web build's KV port (#237): one IndexedDB object store of string values,
// with the same interface as chrome.storage and Capacitor Preferences. Not
// localStorage: that is synchronous, capped at a few MB, and evicted the same
// way, so it buys nothing.
//
// One connection per port, opened lazily and reused. Each call is its own
// transaction, so a write is durable once its promise resolves.

const DB_NAME = 'lantern';
const STORE = 'kv';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function createIdbKV(opts: { factory?: IDBFactory; dbName?: string } = {}): KV {
  const factory = opts.factory ?? indexedDB;
  let db: Promise<IDBDatabase> | null = null;

  const open = () => {
    db ??= new Promise((resolve, reject) => {
      const req = factory.open(opts.dbName ?? DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        db = null; // let the next call retry
        reject(req.error);
      };
    });
    return db;
  };

  return {
    async get(key) {
      const store = (await open()).transaction(STORE, 'readonly').objectStore(STORE);
      const v = await request<unknown>(store.get(key));
      return typeof v === 'string' ? v : null;
    },
    async set(key, value) {
      const tx = (await open()).transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      await done(tx);
    },
    async remove(key) {
      const tx = (await open()).transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      await done(tx);
    },
  };
}
