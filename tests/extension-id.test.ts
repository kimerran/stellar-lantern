import { describe, expect, it } from 'vitest';
import manifest from '../manifest.config';
import {
  EXTENSION_ID,
  EXTENSION_ORIGIN,
  EXTENSION_PUBLIC_KEY,
  isLanternOrigin,
} from '@shared/origin';

// #284: the extension's id is pinned by the manifest's `key`, so every install
// (unpacked from any folder) has the same origin, which a dApp like Centient
// can allowlist in frame-ancestors. Chrome's id is the first 128 bits of
// SHA-256 over the DER public key, written with the letters a–p.

async function chromeExtensionId(base64Der: string): Promise<string> {
  const der = Uint8Array.from(atob(base64Der), (c) => c.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', der));
  return [...digest.slice(0, 16)]
    .map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15)))
    .join('');
}

describe('the pinned extension id (#284)', () => {
  it('EXTENSION_ID is the id Chrome derives from EXTENSION_PUBLIC_KEY', async () => {
    expect(await chromeExtensionId(EXTENSION_PUBLIC_KEY)).toBe(EXTENSION_ID);
    expect(EXTENSION_ID).toMatch(/^[a-p]{32}$/);
  });

  it('the manifest carries the key', async () => {
    const m =
      typeof manifest === 'function'
        ? await manifest({ command: 'build', mode: 'production' })
        : manifest;
    expect((m as { key?: string }).key).toBe(EXTENSION_PUBLIC_KEY);
  });

  it('the key is a public key only: no private key material in the repo constant', () => {
    expect(EXTENSION_PUBLIC_KEY).not.toMatch(/PRIVATE|BEGIN/);
    // A 2048-bit RSA SubjectPublicKeyInfo is 294 bytes (392 base64 chars).
    expect(atob(EXTENSION_PUBLIC_KEY)).toHaveLength(294);
  });

  it('the extension origin is a Lantern origin', () => {
    expect(EXTENSION_ORIGIN).toBe(`chrome-extension://${EXTENSION_ID}`);
    expect(isLanternOrigin(EXTENSION_ORIGIN, 'null')).toBe(true);
  });
});
