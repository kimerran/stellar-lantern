import { describe, expect, it } from 'vitest';

// The node-polyfills plugin shims `node:fs` (and `node:vm`) in test files, so
// read through the real Node modules, as tests/self-hosted-fonts.test.ts does.
const builtin = (globalThis as unknown as { process: { getBuiltinModule(m: string): unknown } })
  .process.getBuiltinModule;
const fs = builtin('fs') as typeof import('fs');
const vm = builtin('vm') as typeof import('vm');
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// The homepage's download buttons per device (homepage/app.js). app.js is a
// plain script, so it runs here in a VM with a stub DOM: its lanternPlatform()
// global decides which buttons stay, and the markup is checked for what a
// visitor without JS sees. Until app.golantern.xyz is hosted, app.js ships with
// WEB_APP_LIVE = false and every web-app mention stays hidden; the per-device
// tests run app.js with the switch flipped on, as it will be once it's live.

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

const LIVE_OFF = 'var WEB_APP_LIVE = false;';

/** Runs app.js against a stub DOM holding one element per data-cta name, each
 *  starting as the markup ships it. `live` runs it with WEB_APP_LIVE on. */
function run(userAgent: string, maxTouchPoints = 0, live = true) {
  const names = ['android', 'extension', 'web', 'web-hint', 'web-hint-browser', 'web-alt'] as const;
  const els = new Map<string, FakeEl>(
    names.map((n) => [
      n,
      {
        hidden: n !== 'android' && n !== 'extension',
        href: 'https://app.golantern.xyz/?src=homepage',
      },
    ]),
  );
  // Web-app links without a data-cta (the install card, the footer), hidden in the markup.
  const plainLinks: FakeEl[] = [0, 1].map(() => ({
    hidden: true,
    href: 'https://app.golantern.xyz/?src=homepage',
  }));
  // The pre-web-app wording (data-web-app-off), shown in the markup.
  const offText: FakeEl = { hidden: false, href: '' };
  const webApp = () => [...names.slice(2).map((n) => els.get(n) as FakeEl), ...plainLinks];
  const document = {
    documentElement: { classList: { add() {} } },
    getElementById: () => null,
    querySelectorAll: (sel: string) => {
      if (sel === 'a[href^="https://app.golantern.xyz/"]') {
        return [els.get('web') as FakeEl, ...plainLinks].filter((a) =>
          a.href.startsWith('https://app.golantern.xyz/'),
        );
      }
      if (sel === '[data-web-app]') return webApp();
      if (sel === '[data-web-app-off]') return [offText];
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
  if (!appJs.includes(LIVE_OFF)) throw new Error('app.js no longer declares WEB_APP_LIVE');
  vm.runInContext(live ? appJs.replace(LIVE_OFF, 'var WEB_APP_LIVE = true;') : appJs, ctx);
  const visible = names.filter((n) => !els.get(n)?.hidden);
  const webLinks = [els.get('web')?.href, ...plainLinks.map((a) => a.href)];
  return {
    visible,
    webHref: els.get('web')?.href,
    webLinks,
    plainLinksHidden: plainLinks.every((a) => a.hidden),
    offTextHidden: offText.hidden,
    platform: ctx.lanternPlatform as (ua: string, t: number) => string,
  };
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

  it('iPhone: every web-app link carries src=homepage-ios; elsewhere they stay homepage', () => {
    for (const href of run(UA.iphone, 5).webLinks) {
      expect(href).toBe('https://app.golantern.xyz/?src=homepage-ios');
    }
    for (const ua of [UA.android, UA.chromeWin, UA.firefoxLinux]) {
      for (const href of run(ua).webLinks) {
        expect(href).toBe('https://app.golantern.xyz/?src=homepage');
      }
    }
  });

  it('Android and desktop Chrome keep their buttons, plus the small web-app link', () => {
    for (const ua of [UA.android, UA.chromeWin]) {
      expect(run(ua).visible).toEqual(['android', 'extension', 'web-alt']);
    }
  });
});

describe('homepage: while the web app is not hosted (WEB_APP_LIVE = false)', () => {
  it('app.js ships with the switch off', () => {
    expect(appJs).toContain(LIVE_OFF);
  });

  it('every visitor gets the APK and the extension, and nothing points at the web app', () => {
    for (const [ua, touch] of [
      [UA.iphone, 5],
      [UA.mac, 5],
      [UA.android, 5],
      [UA.chromeWin, 0],
      [UA.firefoxLinux, 0],
    ] as const) {
      const r = run(ua, touch, false);
      expect(r.visible, ua).toEqual(['android', 'extension']);
      expect(r.plainLinksHidden, ua).toBe(true);
      expect(r.offTextHidden, ua).toBe(false);
    }
  });

  it('switched on, the web-app links and copy appear and the old wording goes', () => {
    const r = run(UA.iphone, 5);
    expect(r.plainLinksHidden).toBe(false);
    expect(r.offTextHidden).toBe(true);
  });
});

describe('homepage: the markup (what a visitor without JS sees)', () => {
  const ctas = [...html.matchAll(/<(\w+)([^>]*\bdata-cta="([\w-]+)"[^>]*)>/g)].map((m) => ({
    name: m[3],
    attrs: m[2],
  }));

  it('the APK and the extension are in the markup, visible', () => {
    for (const name of ['android', 'extension']) {
      const els = ctas.filter((c) => c.name === name);
      expect(els.length, name).toBeGreaterThan(0);
      for (const el of els) expect(el.attrs, name).not.toMatch(/\shidden\b/);
    }
  });

  it('every web-app element and link is marked data-web-app and starts hidden', () => {
    for (const name of ['web', 'web-hint', 'web-hint-browser', 'web-alt']) {
      const els = ctas.filter((c) => c.name === name);
      expect(els.length, name).toBeGreaterThan(0);
      for (const el of els)
        expect(el.attrs, name).toMatch(/\sdata-web-app(?![\w-])[^>]*\shidden\b/);
    }
    const links = [...html.matchAll(/<a\b[^>]*app\.golantern\.xyz[^>]*>/g)].map((m) => m[0]);
    expect(links.length).toBe(6);
    for (const a of links) expect(a).toMatch(/\sdata-web-app\s+hidden\b/);
    const gated = [...html.matchAll(/<\w+\b[^>]*\sdata-web-app(?![\w-])[^>]*>/g)].map((m) => m[0]);
    expect(gated.length).toBeGreaterThan(links.length);
    for (const el of gated) expect(el).toMatch(/\shidden\b/);
  });

  it('the pre-web-app wording shows in its place', () => {
    expect(html).toContain('<span data-web-app-off>Chrome extension &amp; Android APK</span>');
  });

  it('every web-app link carries ?src=homepage', () => {
    const links = [...html.matchAll(/href="(https:\/\/app\.golantern\.xyz[^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toBe('https://app.golantern.xyz/?src=homepage');
  });
});
