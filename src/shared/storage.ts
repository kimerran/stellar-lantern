import type { Settings, StoredVault } from './types';
import { DEFAULT_AUTOLOCK_MINUTES, DEFAULT_NETWORK } from './constants';

// Thin typed wrapper over chrome.storage.local. Only the encrypted vault and
// non-secret settings live here (SPEC §7).

const VAULT_KEY = 'lantern.vault';
const SETTINGS_KEY = 'lantern.settings';

export async function getVault(): Promise<StoredVault | null> {
  const res = await chrome.storage.local.get(VAULT_KEY);
  return (res[VAULT_KEY] as StoredVault | undefined) ?? null;
}

export async function setVault(vault: StoredVault): Promise<void> {
  await chrome.storage.local.set({ [VAULT_KEY]: vault });
}

export async function clearVault(): Promise<void> {
  await chrome.storage.local.remove(VAULT_KEY);
}

const DEFAULT_SETTINGS: Settings = {
  network: DEFAULT_NETWORK,
  autoLockMinutes: DEFAULT_AUTOLOCK_MINUTES,
};

export async function getSettings(): Promise<Settings> {
  const res = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(res[SETTINGS_KEY] as Partial<Settings> | undefined) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function onSettingsChanged(cb: (settings: Settings) => void): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: string,
  ) => {
    if (area === 'local' && changes[SETTINGS_KEY]) {
      cb({ ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue as Partial<Settings>) });
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
