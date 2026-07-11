import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { __setKV, type KV } from '@shared/kv';
import { getSettings } from '@shared/storage';
import {
  isFavorite,
  addFavorite,
  removeFavorite,
  toggleFavorite,
  orderedFavoriteApps,
  getFavoriteAppIds,
  toggleFavoriteApp,
} from '@core/miniapps/favorites';
import { MINI_APPS } from '@core/miniapps/directory';

function memoryKV(): KV {
  const store = new Map<string, string>();
  return {
    get: async (k) => (store.has(k) ? store.get(k)! : null),
    set: async (k, v) => void store.set(k, v),
    remove: async (k) => void store.delete(k),
  };
}

describe('favorites — pure list ops', () => {
  it('isFavorite reflects membership', () => {
    expect(isFavorite(['a', 'b'], 'a')).toBe(true);
    expect(isFavorite(['a', 'b'], 'c')).toBe(false);
    expect(isFavorite([], 'a')).toBe(false);
  });

  it('addFavorite appends once, in order; is idempotent and pure', () => {
    const base = ['a'];
    expect(addFavorite(base, 'b')).toEqual(['a', 'b']);
    expect(addFavorite(['a', 'b'], 'a')).toEqual(['a', 'b']);
    expect(base).toEqual(['a']); // input untouched
  });

  it('removeFavorite drops the id and is idempotent', () => {
    expect(removeFavorite(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(removeFavorite(['a'], 'z')).toEqual(['a']);
  });

  it('toggleFavorite flips presence, preserving order of the rest', () => {
    expect(toggleFavorite(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleFavorite(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('orderedFavoriteApps resolves ids to apps in pin order, dropping unknowns', () => {
    const resolved = orderedFavoriteApps(['lumen-notes', 'ghost-app', 'stardust-faucet']);
    expect(resolved.map((a) => a.id)).toEqual(['lumen-notes', 'stardust-faucet']);
    // Uses the real directory by default.
    expect(orderedFavoriteApps(MINI_APPS.map((a) => a.id))).toHaveLength(MINI_APPS.length);
    expect(orderedFavoriteApps([])).toEqual([]);
  });
});

describe('favorites — storage round-trip over the kv port', () => {
  beforeEach(() => __setKV(memoryKV()));
  afterEach(() => __setKV(null));

  it('defaults to an empty list when nothing is stored', async () => {
    expect(await getFavoriteAppIds()).toEqual([]);
  });

  it('persists a toggle and reads it back, then unfavorites', async () => {
    expect(await toggleFavoriteApp('stardust-faucet')).toEqual(['stardust-faucet']);
    // Round-trips through Settings storage (survives a "restart" = fresh read).
    expect(await getFavoriteAppIds()).toEqual(['stardust-faucet']);
    expect((await getSettings()).favoriteApps).toEqual(['stardust-faucet']);

    expect(await toggleFavoriteApp('lantern-demo')).toEqual(['stardust-faucet', 'lantern-demo']);
    expect(await getFavoriteAppIds()).toEqual(['stardust-faucet', 'lantern-demo']);

    // Toggling an existing favorite removes it, leaving the rest in order.
    expect(await toggleFavoriteApp('stardust-faucet')).toEqual(['lantern-demo']);
    expect(await getFavoriteAppIds()).toEqual(['lantern-demo']);
  });

  it('does not disturb other settings when favorites change', async () => {
    await toggleFavoriteApp('lantern-demo');
    const settings = await getSettings();
    expect(settings.favoriteApps).toEqual(['lantern-demo']);
    expect(settings.network).toBe('TESTNET'); // default preserved
  });
});
