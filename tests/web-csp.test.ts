import { describe, expect, it } from 'vitest';
import { WEB_CSP, webCspDirectives } from '../src/web/csp';
import { NETWORKS } from '@shared/constants';

// The web app's Content-Security-Policy (#238). A hosted wallet runs whatever
// the server sends, so the page itself refuses anything but its own files and
// the few services it needs.

const d = webCspDirectives();

describe('web app CSP', () => {
  it('runs only its own scripts: no inline, no eval, no other origin', () => {
    expect(d['script-src']).toEqual(["'self'"]);
    expect(WEB_CSP).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes|strict-dynamic|\*/);
  });

  it('loads styles, fonts, frames, workers and the manifest from itself only', () => {
    for (const k of [
      'default-src',
      'style-src',
      'font-src',
      'frame-src',
      'worker-src',
      'manifest-src',
    ]) {
      expect(d[k], k).toEqual(["'self'"]);
    }
  });

  it('blocks plugins, base-tag hijacks, and form posts elsewhere', () => {
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'none'"]);
    expect(d['form-action']).toEqual(["'self'"]);
  });

  it('connects only to testnet Horizon, testnet RPC, Friendbot and the Lantern API', () => {
    const t = NETWORKS.TESTNET;
    expect(new Set(d['connect-src'])).toEqual(
      new Set([
        "'self'",
        new URL(t.horizonUrl).origin,
        new URL(t.sorobanRpcUrl!).origin,
        new URL(t.friendbotUrl!).origin,
        'https://lantern-api-production-3fad.up.railway.app',
      ]),
    );
  });

  it('allows images from itself and data: URLs only (the Receive QR code)', () => {
    expect(d['img-src']).toEqual(["'self'", 'data:']);
  });

  it('serialises to one header/meta value', () => {
    expect(WEB_CSP.split('; ').length).toBe(Object.keys(d).length);
    expect(WEB_CSP).not.toContain('frame-ancestors'); // ignored in a <meta> tag; sent as a header instead
  });
});
