import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIdbKV } from '@shared/idb-kv';

// The web build's storage (#237): the same KV port as chrome.storage and
// Capacitor Preferences, on IndexedDB. A fresh factory per test, so no state
// leaks between cases.
const fresh = () => createIdbKV({ factory: new IDBFactory() });

describe('IndexedDB KV port', () => {
  it('returns null for a key that was never set', async () => {
    expect(await fresh().get('lantern.vault')).toBeNull();
  });

  it('round-trips a string value exactly', async () => {
    const kv = fresh();
    const value = JSON.stringify({ v: 1, ct: 'AbC/+=', note: 'ñ 💡 "quoted"\n' });
    await kv.set('lantern.vault', value);
    expect(await kv.get('lantern.vault')).toBe(value);
  });

  it('overwrites on a second set', async () => {
    const kv = fresh();
    await kv.set('k', 'one');
    await kv.set('k', 'two');
    expect(await kv.get('k')).toBe('two');
  });

  it('removes a key, and removing a missing key is not an error', async () => {
    const kv = fresh();
    await kv.set('k', 'v');
    await kv.remove('k');
    expect(await kv.get('k')).toBeNull();
    await expect(kv.remove('never-set')).resolves.toBeUndefined();
  });

  it('keeps keys separate', async () => {
    const kv = fresh();
    await kv.set('a', '1');
    await kv.set('b', '2');
    expect(await kv.get('a')).toBe('1');
    expect(await kv.get('b')).toBe('2');
  });

  it('persists across instances on the same database, like a page reload', async () => {
    const factory = new IDBFactory();
    await createIdbKV({ factory }).set('lantern.vault', 'sealed');
    expect(await createIdbKV({ factory }).get('lantern.vault')).toBe('sealed');
  });
});
