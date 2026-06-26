import { describe, it, expect } from 'vitest';
import {
  MINI_APPS,
  findMiniApp,
  miniAppSrc,
  normalizeUrl,
  displayOrigin,
} from '@core/miniapps/directory';

describe('mini-app directory', () => {
  it('has unique ids and well-formed bundled paths', () => {
    const ids = MINI_APPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const app of MINI_APPS) {
      expect(app.path).toMatch(/^miniapps\/[\w-]+\/index\.html$/);
      expect(app.path).toContain(app.id);
    }
  });

  it('looks up apps by id', () => {
    expect(findMiniApp('stardust-faucet')?.name).toBe('Stardust Faucet');
    expect(findMiniApp('does-not-exist')).toBeUndefined();
  });

  it('passes the wallet address to a bundled app as a url param', () => {
    const app = MINI_APPS[0]!;
    const src = miniAppSrc(app, 'GABC123');
    expect(src).toBe(`${app.path}?addr=GABC123`);
    expect(miniAppSrc(app)).toBe(app.path);
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
