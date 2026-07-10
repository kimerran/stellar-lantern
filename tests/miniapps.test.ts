import { describe, it, expect } from 'vitest';
import {
  MINI_APPS,
  findMiniApp,
  miniAppSrc,
  isRemoteMiniApp,
  normalizeUrl,
  displayOrigin,
} from '@core/miniapps/directory';

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
