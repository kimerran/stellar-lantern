import { describe, expect, it } from 'vitest';
import { isIos, isInstalled, needsHomeScreenStep, type InstallEnv } from '@shared/web/install';

// Safari deletes a site's script-writable storage (IndexedDB included) after 7
// days without a visit, unless the site was added to the Home Screen (#238).
// So on iOS the web app asks to be installed before a wallet is created.

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0 Mobile/15E148 Safari/604.1';
// iPadOS asks for desktop sites by default and reports itself as a Mac.
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36';

const env = (o: Partial<InstallEnv>): InstallEnv => ({
  userAgent: '',
  maxTouchPoints: 0,
  standalone: undefined,
  displayModeStandalone: false,
  ...o,
});

describe('isIos', () => {
  it('recognises iPhone browsers, Safari or not (they all use WebKit storage rules)', () => {
    expect(isIos(env({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5 }))).toBe(true);
    expect(isIos(env({ userAgent: IPHONE_CHROME, maxTouchPoints: 5 }))).toBe(true);
  });

  it('recognises an iPad that reports itself as a Mac, by its touch screen', () => {
    expect(isIos(env({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 5 }))).toBe(true);
  });

  it('does not mistake a real Mac or Android for iOS', () => {
    expect(isIos(env({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 0 }))).toBe(false);
    expect(isIos(env({ userAgent: ANDROID_CHROME, maxTouchPoints: 5 }))).toBe(false);
  });
});

describe('needsHomeScreenStep', () => {
  it('is true for an iPhone in a browser tab', () => {
    expect(needsHomeScreenStep(env({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5 }))).toBe(true);
  });

  it('is false once launched from the Home Screen (either signal)', () => {
    const iphone = { userAgent: IPHONE_SAFARI, maxTouchPoints: 5 };
    expect(isInstalled(env({ ...iphone, standalone: true }))).toBe(true);
    expect(needsHomeScreenStep(env({ ...iphone, standalone: true }))).toBe(false);
    expect(needsHomeScreenStep(env({ ...iphone, displayModeStandalone: true }))).toBe(false);
  });

  it('is false off iOS: other browsers only get an optional install prompt', () => {
    expect(needsHomeScreenStep(env({ userAgent: ANDROID_CHROME, maxTouchPoints: 5 }))).toBe(false);
    expect(needsHomeScreenStep(env({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 0 }))).toBe(false);
  });
});
