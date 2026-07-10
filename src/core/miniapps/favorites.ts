// Mini-app "favorites" / installs (#93). "Installing" an app is purely a
// BOOKMARK — it pins the app to a "My apps" section above the directory and
// grants NO new capabilities. Every launch still goes through the same
// sandboxed frame + connect + scan-gated sign path as an un-favorited app.
//
// Favorites are a list of MiniApp ids persisted in Settings (see
// shared/storage.ts), so they round-trip across restarts and live-update across
// surfaces for free via onSettingsChanged. Never store anything secret here —
// it's plain, public metadata.

import { getSettings, setSettings } from '@shared/storage';
import { MINI_APPS, type MiniApp } from './directory';

// ── Pure list ops (unit-tested; no I/O) ──

/** Is `id` currently favorited? */
export function isFavorite(favorites: readonly string[], id: string): boolean {
  return favorites.includes(id);
}

/** Add `id` (idempotent — appended once, in insertion order). */
export function addFavorite(favorites: readonly string[], id: string): string[] {
  return favorites.includes(id) ? [...favorites] : [...favorites, id];
}

/** Remove `id` (idempotent). */
export function removeFavorite(favorites: readonly string[], id: string): string[] {
  return favorites.filter((f) => f !== id);
}

/** Toggle `id`'s presence, preserving the order of the others. */
export function toggleFavorite(favorites: readonly string[], id: string): string[] {
  return favorites.includes(id) ? removeFavorite(favorites, id) : addFavorite(favorites, id);
}

/**
 * Resolve favorite ids to their directory entries, in the user's pin order.
 * Ids that no longer exist in the directory are dropped, so a stale favorite
 * (e.g. an app removed from a later build) never breaks the "My apps" section.
 */
export function orderedFavoriteApps(
  favorites: readonly string[],
  apps: readonly MiniApp[] = MINI_APPS,
): MiniApp[] {
  return favorites
    .map((id) => apps.find((a) => a.id === id))
    .filter((a): a is MiniApp => a !== undefined);
}

// ── Persistence (round-trip over the KV port via Settings) ──

/** The persisted favorite ids (empty when none). */
export async function getFavoriteAppIds(): Promise<string[]> {
  return (await getSettings()).favoriteApps ?? [];
}

/**
 * Toggle an app's favorite state and persist it. Returns the new list. The
 * write flows through setSettings, so onSettingsChanged fires and every mounted
 * surface re-renders its "My apps" section.
 */
export async function toggleFavoriteApp(id: string): Promise<string[]> {
  const next = toggleFavorite(await getFavoriteAppIds(), id);
  await setSettings({ favoriteApps: next });
  return next;
}
