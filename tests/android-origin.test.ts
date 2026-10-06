import { describe, expect, it } from 'vitest';
import config from '../capacitor.config';
import {
  ANDROID_HOSTNAME,
  ANDROID_ORIGIN,
  LANTERN_ORIGINS,
  LEGACY_ANDROID_ORIGIN,
  WEB_APP_ORIGIN,
  isLanternOrigin,
} from '@shared/origin';

// #259: the Android app has its own origin, not Capacitor's shared
// https://localhost, and not the hosted web app's real origin.
describe('Android app origin', () => {
  it('capacitor.config.ts serves the app at android.golantern.xyz over https', () => {
    expect(config.server?.hostname).toBe(ANDROID_HOSTNAME);
    expect(config.server?.androidScheme).toBe('https');
    expect(ANDROID_ORIGIN).toBe('https://android.golantern.xyz');
  });

  it('is neither the shared Capacitor default nor the hosted web app', () => {
    expect(config.server?.hostname).not.toBe('localhost');
    expect(ANDROID_ORIGIN).not.toBe(LEGACY_ANDROID_ORIGIN);
    expect(ANDROID_ORIGIN).not.toBe(WEB_APP_ORIGIN);
    expect(new URL(ANDROID_ORIGIN).hostname.endsWith('.golantern.xyz')).toBe(true);
  });

  it('is a normalized origin (what window.location.origin returns)', () => {
    for (const o of LANTERN_ORIGINS) expect(new URL(o).origin).toBe(o);
  });
});

describe('isLanternOrigin', () => {
  it("recognizes Lantern's own origins and URLs on them", () => {
    expect(isLanternOrigin(ANDROID_ORIGIN, 'null')).toBe(true);
    expect(isLanternOrigin('https://android.golantern.xyz/index.html#apps', 'null')).toBe(true);
    expect(isLanternOrigin(WEB_APP_ORIGIN, 'null')).toBe(true);
    expect(isLanternOrigin('chrome-extension://abcdefghijklmnop/popup.html', 'null')).toBe(true);
  });

  it('treats the running page as Lantern', () => {
    expect(isLanternOrigin('http://localhost:5173/x', 'http://localhost:5173')).toBe(true);
  });

  it('fails closed on unparseable or opaque input', () => {
    expect(isLanternOrigin('not a url', 'null')).toBe(true);
    expect(isLanternOrigin('data:text/html,hi', 'null')).toBe(true);
    expect(isLanternOrigin('about:blank', 'null')).toBe(true);
  });

  it('does not claim dApps, look-alikes, or the legacy shared origin', () => {
    expect(isLanternOrigin('https://centient.app', ANDROID_ORIGIN)).toBe(false);
    expect(isLanternOrigin('https://golantern.xyz', ANDROID_ORIGIN)).toBe(false);
    expect(isLanternOrigin('http://android.golantern.xyz', ANDROID_ORIGIN)).toBe(false);
    expect(isLanternOrigin('https://android.golantern.xyz.evil.com', ANDROID_ORIGIN)).toBe(false);
    expect(isLanternOrigin(LEGACY_ANDROID_ORIGIN, ANDROID_ORIGIN)).toBe(false);
  });
});
