import { describe, it, expect } from 'vitest';
import {
  MINI_APPS,
  findMiniApp,
  miniAppSrc,
  isRemoteMiniApp,
  normalizeUrl,
  displayOrigin,
  networkChip,
  type MiniApp,
} from '@core/miniapps/directory';
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
    expect(app!.url).toBe('https://centient.work/');
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
