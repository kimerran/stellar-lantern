import type { Settings, StoredVault } from './types';
import { DEFAULT_AUTOLOCK_MINUTES, DEFAULT_NETWORK } from './constants';

// Persistence for the encrypted vault and non-secret settings (SPEC §7).
//
// The wallet runs in two hosts: the MV3 extension (chrome.storage.local) and,
// on mobile, a Capacitor WebView (Capacitor Preferences). Both expose the same
// tiny key/value contract below, so the rest of the app is host-agnostic.
//
// Default adapter = chrome.storage (extension). On Android, the mobile entry
// calls `setKvStore(capacitorKvStore)` at startup before any wallet code runs.
// Tests can inject an in-memory store the same way.

const VAULT_KEY = 'lantern.vault';
const SETTINGS_KEY = 'lantern.settings';

/** Minimal key/value contract a host must provide. Values are JSON-serialisable. */
export interface KvStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /** Subscribe to external changes for a key. Returns an unsubscribe fn. */
  subscribe(key: string, cb: (newValue: unknown) => void): () => void;
}

// ── Default: chrome.storage.local (MV3 extension) ────────────────────────────
const chromeKvStore: KvStore = {
  async get<T>(key: string): Promise<T | null> {
    const res = await chrome.storage.local.get(key);
    return (res[key] as T | undefined) ?? null;
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async remove(key) {
    await chrome.storage.local.remove(key);
  },
  subscribe(key, cb) {
    const listener = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area === 'local' && changes[key]) cb(changes[key].newValue);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  },
};

let store: KvStore = chromeKvStore;

/**
 * Override the active storage backend. Call once at host startup, before any
 * wallet code reads/writes (e.g. the Android entry injects a Capacitor
 * Preferences-backed KvStore; tests inject an in-memory one).
 */
export function setKvStore(next: KvStore): void {
  store = next;
}

// ── Vault ────────────────────────────────────────────────────────────────────
export async function getVault(): Promise<StoredVault | null> {
  return store.get<StoredVault>(VAULT_KEY);
}

export async function setVault(vault: StoredVault): Promise<void> {
  await store.set(VAULT_KEY, vault);
}

export async function clearVault(): Promise<void> {
  await store.remove(VAULT_KEY);
}

// ── Settings ──────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS: Settings = {
  network: DEFAULT_NETWORK,
  autoLockMinutes: DEFAULT_AUTOLOCK_MINUTES,
};

export async function getSettings(): Promise<Settings> {
  const stored = await store.get<Partial<Settings>>(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await store.set(SETTINGS_KEY, next);
  return next;
}

export function onSettingsChanged(cb: (settings: Settings) => void): () => void {
  return store.subscribe(SETTINGS_KEY, (newValue) => {
    cb({ ...DEFAULT_SETTINGS, ...(newValue as Partial<Settings>) });
  });
}
