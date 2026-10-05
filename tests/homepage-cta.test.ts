import { describe, expect, it } from 'vitest';

// The node-polyfills plugin shims `node:fs` (and `node:vm`) in test files, so
// read through the real Node modules, as tests/self-hosted-fonts.test.ts does.
const builtin = (globalThis as unknown as { process: { getBuiltinModule(m: string): unknown } }).process
  .getBuiltinModule;
const fs = builtin('fs') as typeof import('fs');
const vm = builtin('vm') as typeof import('vm');
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// The homepage's download buttons per device (homepage/app.js). app.js is a
// plain script, so it runs here in a VM with a stub DOM: its lanternPlatform()
// global decides which buttons stay, and the markup is checked for what a
// visitor without JS sees.

const appJs = read('homepage/app.js');
const html = read('homepage/index.html');

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
  // iPadOS asks for desktop sites: the same UA as a Mac.
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:139.0) Gecko/139.0 Firefox/139.0',
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  edgeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0',
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:139.0) Gecko/20100101 Firefox/139.0',
};

interface FakeEl {
  hidden: boolean;
  href: string;
}

/** Runs app.js against a stub DOM holding one element per data-cta name. */
function run(userAgent: string, maxTouchPoints = 0) {
  const names = ['android', 'extension', 'web', 'web-hint', 'web-hint-browser', 'web-alt'] as const;
  const els = new Map<string, FakeEl>(
    names.map((n) => [n, { hidden: false, href: 'https://app.golantern.xyz/?src=homepage' }]),
  );
  const document = {
    documentElement: { classList: { add() {} } },
    getElementById: () => null,
    querySelectorAll: (sel: string) => {
      const el = els.get(/^\[data-cta="([\w-]+)"\]$/.exec(sel)?.[1] ?? '');
      return el ? [el] : [];
    },
  };
  const ctx: Record<string, unknown> = {
    document,
    navigator: { userAgent, maxTouchPoints },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 0,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(appJs, ctx);
  const visible = names.filter((n) => !els.get(n)?.hidden);
  return { visible, webHref: els.get('web')?.href, platform: ctx.lanternPlatform as (ua: string, t: number) => string };
}

describe('homepage: which download fits the visitor', () => {
  const platform = run(UA.chromeWin).platform;

  it('recognises iPhone and iPadOS (a Mac UA with a touch screen) as iOS', () => {
    expect(platform(UA.iphone, 5)).toBe('ios');
    expect(platform(UA.iphoneChrome, 5)).toBe('ios');
    expect(platform(UA.mac, 5)).toBe('ios');
  });

  it('a real Mac (no touch screen) in Safari is neither APK nor extension', () => {
    expect(platform(UA.mac, 0)).toBe('other');
  });

  it('Android in any browser gets the APK', () => {
    expect(platform(UA.android, 5)).toBe('android');
    expect(platform(UA.androidFirefox, 5)).toBe('android');
  });

  it('desktop Chromium browsers get the extension', () => {
    expect(platform(UA.chromeWin, 0)).toBe('chrome');
    expect(platform(UA.edgeWin, 0)).toBe('chrome');
    expect(platform(UA.chromeMac, 0)).toBe('chrome');
  });

  it('desktop Firefox and an empty UA fall back to the web app', () => {
    expect(platform(UA.firefoxLinux, 0)).toBe('other');
    expect(platform('', 0)).toBe('other');
  });
});

describe('homepage: the buttons app.js leaves visible', () => {
  it('iPhone: "Open the web app" (src=homepage-ios) and the Home Screen hint, in place of the APK', () => {
    const r = run(UA.iphone, 5);
    expect(r.visible).toEqual(['web', 'web-hint']);
    expect(r.webHref).toBe('https://app.golantern.xyz/?src=homepage-ios');
  });

  it('iPadOS reporting as a Mac is treated as iOS', () => {
    const r = run(UA.mac, 5);
    expect(r.visible).toEqual(['web', 'web-hint']);
    expect(r.webHref).toBe('https://app.golantern.xyz/?src=homepage-ios');
  });

  it('a browser where neither applies: the web app (src=homepage) with the browser hint', () => {
    const r = run(UA.firefoxLinux);
    expect(r.visible).toEqual(['web', 'web-hint-browser']);
    expect(r.webHref).toBe('https://app.golantern.xyz/?src=homepage');
  });

  it('Android and desktop Chrome keep their buttons, plus the small web-app link', () => {
    for (const ua of [UA.android, UA.chromeWin]) {
      expect(run(ua).visible).toEqual(['android', 'extension', 'web-alt']);
    }
  });
});

describe('homepage: without JS every option shows', () => {
  const ctas = [...html.matchAll(/<(\w+)([^>]*\bdata-cta="([\w-]+)"[^>]*)>/g)].map((m) => ({
    name: m[3],
    attrs: m[2],
  }));

  it('the APK, the extension and the web app are all in the markup, visible', () => {
    for (const name of ['android', 'extension', 'web', 'web-hint']) {
      const els = ctas.filter((c) => c.name === name);
      expect(els.length, name).toBeGreaterThan(0);
      for (const el of els) expect(el.attrs, name).not.toMatch(/\shidden\b/);
    }
  });

  it('the device-specific extras start hidden', () => {
    for (const name of ['web-hint-browser', 'web-alt']) {
      const els = ctas.filter((c) => c.name === name);
      expect(els.length, name).toBeGreaterThan(0);
      for (const el of els) expect(el.attrs, name).toMatch(/\shidden\b/);
    }
  });

  it('every web-app link carries ?src=homepage', () => {
    const links = [...html.matchAll(/href="(https:\/\/app\.golantern\.xyz[^"]*)"/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toBe('https://app.golantern.xyz/?src=homepage');
  });
});
