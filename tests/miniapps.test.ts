import { describe, it, expect } from 'vitest';
import {
  MINI_APPS,
  findMiniApp,
  miniAppSrc,
  isRemoteMiniApp,
  normalizeUrl,
  displayOrigin,
  networkChip,
  appOrigins,
  type MiniApp,
} from '@core/miniapps/directory';
import { ANDROID_ORIGIN, WEB_APP_ORIGIN, LEGACY_ANDROID_ORIGIN } from '@shared/origin';
import appsSrc from '../src/popup/screens/Apps.tsx?raw';

describe('mini-app directory', () => {
  it('has unique ids; every app is exactly one of bundled/remote', () => {
    const ids = MINI_APPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const app of MINI_APPS) {
      // Exactly one of path / url — a bundled first-party page or a remote URL.
      expect(Boolean(app.path) !== Boolean(app.url)).toBe(true);
    }
  });

  it('has well-formed bundled paths', () => {
    for (const app of MINI_APPS.filter((a) => a.path)) {
      expect(app.path).toMatch(/^miniapps\/[\w-]+\/index\.html$/);
      expect(app.path).toContain(app.id);
    }
  });

  it('looks up apps by id', () => {
    expect(findMiniApp('stardust-faucet')?.name).toBe('Stardust Faucet');
    expect(findMiniApp('does-not-exist')).toBeUndefined();
  });

  it('passes the wallet address to a bundled app as a url param', () => {
    const app = findMiniApp('stardust-faucet')!;
    const src = miniAppSrc(app, 'GABC123');
    expect(src).toBe(`${app.path}?addr=GABC123`);
    expect(miniAppSrc(app)).toBe(app.path);
  });

  it('lists the Lantern demo app as a remote https entry that passes url validation', () => {
    const demo = findMiniApp('lantern-demo');
    expect(demo).toBeDefined();
    expect(isRemoteMiniApp(demo!)).toBe(true);
    expect(demo!.url).toBe('https://lanternmock.up.railway.app/');
    // Its url passes the same scheme check the URL bar enforces (https, real host).
    expect(normalizeUrl(demo!.url!)).not.toBeNull();
    // Remote apps launch from their raw url (the bridge, not a param, supplies
    // the address) — never appending the wallet address to the query string.
    expect(miniAppSrc(demo!, 'GABC123')).toBe(demo!.url);
    expect(miniAppSrc(demo!)).toBe(demo!.url);
  });

  it('lists Centient as a remote https Earn app with a session (#264)', () => {
    const app = findMiniApp('centient');
    expect(app).toBeDefined();
    expect(MINI_APPS.filter((a) => a.id === 'centient')).toHaveLength(1);
    expect(isRemoteMiniApp(app!)).toBe(true);
    // Opens at beta for the testnet launch; the apex is the same app (#279).
    expect(app!.url).toBe('https://beta.centient.work/');
    expect(app!.origins).toEqual(['https://centient.work']);
    expect(appOrigins(app!)).toEqual(['https://beta.centient.work', 'https://centient.work']);
    expect(new URL(app!.url!).protocol).toBe('https:');
    expect(normalizeUrl(app!.url!)).toBe(app!.url);
    expect(app!.session).toBe(true);
    expect(app!.category).toBe('Earn');
    expect(app!.tagline).toBe('Earn USDC by ranking AI answers.');
    expect(app!.icon).toMatch(/^[a-z0-9_]+$/); // a Material Symbols name, not a URL
    // Not verified until the device QA in slice 8 (#266).
    expect(app!.verified).toBe(false);
    // Testnet-only for now: a "Testnet" chip on mainnet, nothing on testnet.
    expect(networkChip(app!, 'PUBLIC')).toBe('Testnet');
    expect(networkChip(app!, 'TESTNET')).toBeNull();
  });

  it('only remote apps keep a session', () => {
    for (const app of MINI_APPS.filter((a) => a.session)) expect(isRemoteMiniApp(app)).toBe(true);
  });
});

describe('appOrigins (#279)', () => {
  const base: MiniApp = { id: 'x', name: 'X', tagline: 't', category: 'Tools', icon: 'x', url: 'https://beta.x.example/a?b#c', verified: false };

  it('is the url origin, then the extra origins, deduplicated', () => {
    expect(appOrigins(base)).toEqual(['https://beta.x.example']);
    expect(appOrigins({ ...base, origins: ['https://x.example', 'https://X.example/', 'https://beta.x.example'] })).toEqual([
      'https://beta.x.example',
      'https://x.example',
    ]);
    // A path on an extra entry is reduced to its origin; a port is kept.
    expect(appOrigins({ ...base, origins: ['https://x.example/path', 'https://x.example:8443'] })).toEqual([
      'https://beta.x.example',
      'https://x.example',
      'https://x.example:8443',
    ]);
  });

  it('drops anything that is not a plain https origin', () => {
    const bad = ['http://x.example', 'https://user@x.example', 'https://u:p@x.example', 'javascript:alert(1)', 'not a url', '', 'data:text/html,hi'];
    expect(appOrigins({ ...base, origins: bad })).toEqual(['https://beta.x.example']);
    expect(appOrigins({ ...base, origins: [42 as unknown as string] })).toEqual(['https://beta.x.example']);
  });

  it('never includes a Lantern origin', () => {
    const own = [ANDROID_ORIGIN, `${WEB_APP_ORIGIN}/x`, 'chrome-extension://abcdefghijklmnop'];
    expect(appOrigins({ ...base, origins: own })).toEqual(['https://beta.x.example']);
    expect(appOrigins({ ...base, url: `${ANDROID_ORIGIN}/`, origins: ['https://x.example'] })).toEqual([]);
    expect(appOrigins({ ...base, url: `${WEB_APP_ORIGIN}/`, origins: ['https://x.example'] })).toEqual([]);
    // The running page's own origin, when given as `self`.
    expect(appOrigins({ ...base, origins: ['https://preview.example.dev'] }, 'https://preview.example.dev')).toEqual([
      'https://beta.x.example',
    ]);
    // The legacy https://localhost isn't a Lantern origin to isLanternOrigin, but no entry lists it.
    for (const app of MINI_APPS) expect(appOrigins(app)).not.toContain(LEGACY_ANDROID_ORIGIN);
  });

  it('gives nothing to a bundled app or one whose own url does not qualify', () => {
    expect(appOrigins({ ...base, url: undefined, path: 'miniapps/x/index.html', origins: ['https://x.example'] })).toEqual([]);
    expect(appOrigins({ ...base, url: 'http://beta.x.example/', origins: ['https://x.example'] })).toEqual([]);
  });

  it('every directory app with extra origins is a remote app, and they are all https', () => {
    for (const app of MINI_APPS.filter((a) => a.origins?.length)) {
      expect(isRemoteMiniApp(app)).toBe(true);
      // Every listed extra survives the filter: a typo would silently drop it.
      expect(appOrigins(app)).toHaveLength(1 + new Set(app.origins).size);
    }
  });
});

describe('networkChip', () => {
  const base: MiniApp = { id: 'x', name: 'X', tagline: 't', category: 'Tools', icon: 'x', url: 'https://x.example/', verified: false };

  it('shows nothing for an app that runs anywhere', () => {
    expect(networkChip(base, 'PUBLIC')).toBeNull();
    expect(networkChip(base, 'TESTNET')).toBeNull();
    expect(networkChip({ ...base, networks: [] }, 'PUBLIC')).toBeNull();
  });

  it('shows nothing when the app runs on the active network', () => {
    expect(networkChip({ ...base, networks: ['TESTNET'] }, 'TESTNET')).toBeNull();
    expect(networkChip({ ...base, networks: ['TESTNET', 'PUBLIC'] }, 'PUBLIC')).toBeNull();
  });

  it('names where the app runs when the wallet is elsewhere', () => {
    expect(networkChip({ ...base, networks: ['TESTNET'] }, 'PUBLIC')).toBe('Testnet');
    expect(networkChip({ ...base, networks: ['PUBLIC'] }, 'TESTNET')).toBe('Mainnet');
  });

  it('the Apps tab row renders the chip from the active network', () => {
    expect(appsSrc).toContain('networkChip(app, network)');
    // Both lists (My apps + Discover) pass the network down.
    expect(appsSrc.match(/<AppRow[\s\S]*?network=\{network\}/g)?.length).toBe(2);
  });

  it('every directory app that names networks names real ones', () => {
    for (const app of MINI_APPS) {
      for (const n of app.networks ?? []) expect(['TESTNET', 'PUBLIC']).toContain(n);
    }
  });
});

describe('normalizeUrl', () => {
  it('adds https:// when no scheme is given', () => {
    expect(normalizeUrl('stellar.org')).toBe('https://stellar.org/');
  });

  it('keeps an explicit https url', () => {
    expect(normalizeUrl('https://example.com/path')).toBe('https://example.com/path');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeUrl('  example.com  ')).toBe('https://example.com/');
  });

  it('rejects empty / junk / non-web schemes', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl('notaurl')).toBeNull(); // no dot in host
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('chrome://settings')).toBeNull();
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
  });
});

describe('displayOrigin', () => {
  it('shows the host for a valid url', () => {
    expect(displayOrigin('https://example.com/a/b?c=1')).toBe('example.com');
  });
  it('falls back to the raw string when unparseable', () => {
    expect(displayOrigin('not a url')).toBe('not a url');
  });
});
