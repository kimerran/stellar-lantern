import { describe, it, expect } from 'vitest';
import {
  OPAQUE_SANDBOX,
  SESSION_SANDBOX,
  remoteFrameSandbox,
  replyTargetOrigin,
  isFromFramedApp,
} from '@core/miniapps/frame';
import { MINI_APPS, isRemoteMiniApp } from '@core/miniapps/directory';
import { ANDROID_ORIGIN, WEB_APP_ORIGIN, isLanternOrigin } from '@shared/origin';

// node-polyfills shims `node:fs` in tests; read through the real Node module.
const fs = (globalThis as unknown as { process: { getBuiltinModule(m: 'fs'): typeof import('fs') } }).process.getBuiltinModule('fs');

const hasSameOrigin = (sandbox: string) => sandbox.split(/\s+/).includes('allow-same-origin');
const APP = 'https://centient.work/lantern';
// The running page's origin per platform (the extension's is chrome-extension://<id>).
const SELVES = [ANDROID_ORIGIN, WEB_APP_ORIGIN, 'chrome-extension://abcdefghijklmnop'];

describe('remote frame sandbox (#260)', () => {
  it('the opaque sandbox never has allow-same-origin; the session one does', () => {
    expect(hasSameOrigin(OPAQUE_SANDBOX)).toBe(false);
    expect(hasSameOrigin(SESSION_SANDBOX)).toBe(true);
    expect(SESSION_SANDBOX.startsWith(OPAQUE_SANDBOX)).toBe(true);
  });

  it('a session directory app gets allow-same-origin', () => {
    for (const self of SELVES) expect(remoteFrameSandbox(APP, true, self)).toBe(SESSION_SANDBOX);
  });

  it('without session (the URL bar, ordinary directory apps) the frame stays opaque', () => {
    for (const self of SELVES) expect(remoteFrameSandbox(APP, false, self)).toBe(OPAQUE_SANDBOX);
  });

  it('allow-same-origin is never applied to Lantern’s own origin, even with session', () => {
    const own = [
      `${ANDROID_ORIGIN}/`,
      `${ANDROID_ORIGIN}/index.html#apps`,
      `${WEB_APP_ORIGIN}/miniapps/x/index.html`,
      'chrome-extension://abcdefghijklmnop/popup.html',
      'chrome-extension://someotherextension/page.html',
    ];
    for (const src of own) {
      for (const self of SELVES) expect(hasSameOrigin(remoteFrameSandbox(src, true, self))).toBe(false);
    }
    // The running page's own origin, whatever it is (e.g. a preview deploy).
    expect(hasSameOrigin(remoteFrameSandbox('https://preview.example.dev/a', true, 'https://preview.example.dev'))).toBe(false);
  });

  it('uses location.origin when no self is passed', () => {
    const self = globalThis.location?.origin;
    if (self && self !== 'null' && /^https:/.test(self)) {
      expect(hasSameOrigin(remoteFrameSandbox(`${self}/x`, true))).toBe(false);
    }
    expect(remoteFrameSandbox(APP, true)).toBe(SESSION_SANDBOX);
  });

  it('only https URLs can get a session; anything else fails closed', () => {
    for (const src of ['http://centient.work/', 'data:text/html,hi', 'javascript:alert(1)', 'not a url', '', 'about:blank']) {
      expect(remoteFrameSandbox(src, true, ANDROID_ORIGIN)).toBe(OPAQUE_SANDBOX);
    }
  });

  it('a non-boolean session flag does not grant a session', () => {
    expect(remoteFrameSandbox(APP, 'true' as unknown as boolean, ANDROID_ORIGIN)).toBe(OPAQUE_SANDBOX);
  });
});

describe('replies and incoming messages (#260)', () => {
  it('replies to a session app go to its origin only', () => {
    expect(replyTargetOrigin(APP, SESSION_SANDBOX)).toBe('https://centient.work');
    expect(replyTargetOrigin('https://app.example.org:8443/a?b#c', SESSION_SANDBOX)).toBe('https://app.example.org:8443');
  });

  it('replies to an opaque frame use * (its origin is "null", not a valid target)', () => {
    expect(replyTargetOrigin(APP, OPAQUE_SANDBOX)).toBe('*');
  });

  it('accepts a message only from the frame window and the expected origin', () => {
    const win = {};
    const other = {};
    // Session frame
    expect(isFromFramedApp({ source: win, origin: 'https://centient.work' }, win, 'https://centient.work')).toBe(true);
    expect(isFromFramedApp({ source: win, origin: 'https://evil.example' }, win, 'https://centient.work')).toBe(false);
    expect(isFromFramedApp({ source: win, origin: 'null' }, win, 'https://centient.work')).toBe(false);
    expect(isFromFramedApp({ source: other, origin: 'https://centient.work' }, win, 'https://centient.work')).toBe(false);
    // Opaque frame
    expect(isFromFramedApp({ source: win, origin: 'null' }, win, '*')).toBe(true);
    expect(isFromFramedApp({ source: win, origin: 'https://centient.work' }, win, '*')).toBe(false);
    expect(isFromFramedApp({ source: other, origin: 'null' }, win, '*')).toBe(false);
    // No frame
    expect(isFromFramedApp({ source: null, origin: 'null' }, null, '*')).toBe(false);
  });
});

describe('directory session apps (#260)', () => {
  it('every session app is a remote https app off Lantern’s origins', () => {
    for (const app of MINI_APPS.filter((a) => a.session)) {
      expect(isRemoteMiniApp(app)).toBe(true);
      expect(new URL(app.url!).protocol).toBe('https:');
      for (const self of SELVES) expect(isLanternOrigin(app.url!, self)).toBe(false);
    }
  });

  it('Apps.tsx takes its sandbox from frame.ts and never hard-codes allow-same-origin', () => {
    const src = fs.readFileSync(new URL('../src/popup/screens/Apps.tsx', import.meta.url), 'utf8');
    expect(src).toContain('remoteFrameSandbox(');
    expect(src).not.toMatch(/sandbox=\{?["'`][^"'`]*allow-same-origin/);
    expect(src).not.toContain("postMessage(message, '*')");
  });
});
