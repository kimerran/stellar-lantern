import type { Settings, StoredVault } from './types';
import { DEFAULT_AUTOLOCK_MINUTES, DEFAULT_NETWORK } from './constants';
import { getKV, isNativePlatform } from './kv';

// Only the encrypted vault and non-secret settings live here (SPEC §7).
const VAULT_KEY = 'lantern.vault';
const SETTINGS_KEY = 'lantern.settings';

function parse<T>(raw: string | null): T | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function getVault(): Promise<StoredVault | null> {
  const kv = await getKV();
  return parse<StoredVault>(await kv.get(VAULT_KEY));
}

export async function setVault(vault: StoredVault): Promise<void> {
  const kv = await getKV();
  await kv.set(VAULT_KEY, JSON.stringify(vault));
}

export async function clearVault(): Promise<void> {
  const kv = await getKV();
  await kv.remove(VAULT_KEY);
}

const DEFAULT_SETTINGS: Settings = {
  network: DEFAULT_NETWORK,
  autoLockMinutes: DEFAULT_AUTOLOCK_MINUTES,
};

export async function getSettings(): Promise<Settings> {
  const kv = await getKV();
  return { ...DEFAULT_SETTINGS, ...(parse<Partial<Settings>>(await kv.get(SETTINGS_KEY)) ?? {}) };
}

// In-process settings subscribers, used on native only. The extension gets
// cross-surface change events for free via chrome.storage.onChanged; native is
// a single JS context with no storage events, so we fan writes out ourselves.
const nativeSettingsListeners = new Set<(settings: Settings) => void>();

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const kv = await getKV();
  const next = { ...(await getSettings()), ...patch };
  await kv.set(SETTINGS_KEY, JSON.stringify(next));
  if (isNativePlatform()) {
    for (const cb of nativeSettingsListeners) cb(next);
  }
  return next;
}

// Subscribe to settings changes so every mounted surface stays in sync. On the
// extension this bridges chrome.storage.onChanged; on native it registers with
// the in-process fan-out above (matching the extension's live-update behavior).
export function onSettingsChanged(cb: (settings: Settings) => void): () => void {
  if (isNativePlatform()) {
    nativeSettingsListeners.add(cb);
    return () => {
      nativeSettingsListeners.delete(cb);
    };
  }
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: string,
  ) => {
    if (area === 'local' && changes[SETTINGS_KEY]) {
      const parsed = parse<Partial<Settings>>(
        typeof changes[SETTINGS_KEY].newValue === 'string'
          ? (changes[SETTINGS_KEY].newValue as string)
          : JSON.stringify(changes[SETTINGS_KEY].newValue),
      );
      cb({ ...DEFAULT_SETTINGS, ...(parsed ?? {}) });
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
