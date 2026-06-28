import { Preferences } from '@capacitor/preferences';
import type { KvStore } from '@shared/storage';

// KvStore backed by Capacitor Preferences (Android). Values are JSON strings.
// Preferences has no native change feed, but on mobile all writes happen in this
// single JS context, so we notify subscribers locally on set/remove — enough for
// settings reactivity in the UI.
//
// NOTE: Preferences is convenient app storage, not a hardware keystore. The
// vault stored here is already AES-GCM/PBKDF2-encrypted (core/crypto), so the
// secret is never at rest in plaintext. Hardening to the Android Keystore is a
// tracked follow-up (issue #4).
export function capacitorKvStore(): KvStore {
  const subs = new Map<string, Set<(v: unknown) => void>>();

  const notify = (key: string, value: unknown) => subs.get(key)?.forEach((cb) => cb(value));

  return {
    async get<T>(key: string): Promise<T | null> {
      const { value } = await Preferences.get({ key });
      if (value == null) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      await Preferences.set({ key, value: JSON.stringify(value) });
      notify(key, value);
    },
    async remove(key) {
      await Preferences.remove({ key });
      notify(key, undefined);
    },
    subscribe(key, cb) {
      const set = subs.get(key) ?? new Set();
      set.add(cb);
      subs.set(key, set);
      return () => set.delete(cb);
    },
  };
}
