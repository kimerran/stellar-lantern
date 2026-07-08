// Native (Android/iOS) biometric-gated key store for #23 Milestone 2a — the real
// `BiometricStore` the session handler uses on device. Holds the 256-bit wrapping
// key in the platform Keystore/Keychain via `@capgo/capacitor-native-biometric`
// (Capacitor 8), released only after a successful biometric `verifyIdentity`.
//
// The plugin is loaded through a **variable-specifier dynamic import**, so:
//   • the extension/web bundle never pulls it in (it's platform-gated + unresolved
//     at build time), and
//   • the whole app still typechecks/builds without the package installed.
// Wiring it for a real device is the human step this slice leaves open: run
//   `npm install @capgo/capacitor-native-biometric && npx cap sync android`
// then verify the biometric prompt on hardware (Keystore can't be exercised in CI).

import type { BiometricStore } from './biometric-unlock';

// Namespace for the stored credential (one wrapping key per install).
const SERVER = 'lantern-biometric-unlock';
const USERNAME = 'lantern';

// ── Pure key codec (unit-tested) ─────────────────────────────────────────────
// The plugin stores a string "password"; the wrapping key is 32 raw bytes, so we
// base64 it in and validate strictly on the way out.

export function keyToCredential(key: Uint8Array): string {
  let bin = '';
  for (const b of key) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function credentialToKey(credential: string): Uint8Array | null {
  let bin: string;
  try {
    bin = atob(credential);
  } catch {
    return null;
  }
  if (bin.length !== 32) return null; // not a 256-bit wrapping key
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Plugin surface (only the methods we use) ─────────────────────────────────
interface NativeBiometricPlugin {
  isAvailable(): Promise<{ isAvailable?: boolean; deviceIsSecure?: boolean }>;
  verifyIdentity(opts: { reason?: string; title?: string; subtitle?: string }): Promise<void>;
  setCredentials(opts: { username: string; password: string; server: string }): Promise<void>;
  getCredentials(opts: { server: string }): Promise<{ username: string; password: string }>;
  deleteCredentials(opts: { server: string }): Promise<void>;
}

// Variable specifier + @vite-ignore so the bundler doesn't try to resolve the
// (optional, device-only) package at build time.
async function loadPlugin(): Promise<NativeBiometricPlugin> {
  const pkg: string = '@capgo/capacitor-native-biometric';
  const mod = (await import(/* @vite-ignore */ pkg)) as { NativeBiometric: NativeBiometricPlugin };
  return mod.NativeBiometric;
}

export const nativeBiometricStore: BiometricStore = {
  async isAvailable(): Promise<boolean> {
    try {
      const plugin = await loadPlugin();
      const res = await plugin.isAvailable();
      // Require both a usable biometric AND a secure lock screen (so the Keystore
      // key is actually hardware-protected).
      return res.isAvailable === true && res.deviceIsSecure !== false;
    } catch {
      return false;
    }
  },

  async setKey(key: Uint8Array): Promise<void> {
    const plugin = await loadPlugin();
    await plugin.setCredentials({ username: USERNAME, password: keyToCredential(key), server: SERVER });
  },

  async getKey(): Promise<Uint8Array | null> {
    try {
      const plugin = await loadPlugin();
      // The biometric prompt. Rejects on cancel / lockout / no-hardware.
      await plugin.verifyIdentity({
        reason: 'Unlock your Lantern wallet',
        title: 'Unlock Lantern',
        subtitle: 'Confirm your identity',
      });
      const creds = await plugin.getCredentials({ server: SERVER });
      return credentialToKey(creds.password);
    } catch {
      // Cancelled / unavailable / not enrolled — caller falls back to password.
      return null;
    }
  },

  async clearKey(): Promise<void> {
    try {
      const plugin = await loadPlugin();
      await plugin.deleteCredentials({ server: SERVER });
    } catch {
      /* nothing stored — already clear */
    }
  },
};
