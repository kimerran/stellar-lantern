// Platform-selected key-value port. The extension uses chrome.storage.local;
// native (Capacitor) uses @capacitor/preferences. Values are always strings
// so both backends behave identically (Preferences only stores strings).

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export function isNativePlatform(): boolean {
  const cap = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === 'function' ? cap.isNativePlatform() : false;
}

// chrome.storage previously stored objects; return them as JSON strings so the
// storage layer can JSON.parse uniformly (backward compatible with old vaults).
const chromeKV: KV = {
  async get(key) {
    const res = await chrome.storage.local.get(key);
    const v = (res as Record<string, unknown>)[key];
    if (v === undefined) return null;
    return typeof v === 'string' ? v : JSON.stringify(v);
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async remove(key) {
    await chrome.storage.local.remove(key);
  },
};

let cached: KV | null = null;

export async function getKV(): Promise<KV> {
  if (cached) return cached;
  if (isNativePlatform()) {
    const { Preferences } = await import('@capacitor/preferences');
    cached = {
      get: async (key) => (await Preferences.get({ key })).value,
      set: async (key, value) => void (await Preferences.set({ key, value })),
      remove: async (key) => void (await Preferences.remove({ key })),
    };
  } else {
    cached = chromeKV;
  }
  return cached;
}

// Test hook — inject an in-memory KV and bypass platform detection.
export function __setKV(impl: KV | null): void {
  cached = impl;
}
