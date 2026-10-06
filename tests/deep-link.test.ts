import { describe, expect, it, beforeEach } from 'vitest';
import { assetStatements, deepLinkOrigins, parseDeepLink } from '@core/miniapps/deep-link';
import { MINI_APPS, miniAppSrc, type MiniApp } from '@core/miniapps/directory';
import { ANDROID_ORIGIN, WEB_APP_ORIGIN } from '@shared/origin';
import assetXml from '../android/app/src/main/res/values/asset_statements.xml?raw';
import manifest from '../android/app/src/main/AndroidManifest.xml?raw';
import { remoteAppOpen } from '../src/popup/screens/Apps';
import appsSrc from '../src/popup/screens/Apps.tsx?raw';
import { onDeepLink, peekDeepLink, receiveDeepLink, takeDeepLink } from '../src/popup/deep-link/inbox';

// #263: "Open in Lantern" opens only directory apps.
const CENTIENT: MiniApp = {
  id: 'centient',
  name: 'Centient',
  tagline: 't',
  category: 'Payments',
  icon: 'work',
  url: 'https://centient.work/',
  verified: true,
};
const BUNDLED: MiniApp = {
  id: 'b',
  name: 'B',
  tagline: 't',
  category: 'Tools',
  icon: 'x',
  path: 'miniapps/b/index.html',
  verified: true,
};
const APPS = [BUNDLED, CENTIENT];

const link = (target: string) => `lantern://open?url=${encodeURIComponent(target)}`;

describe('parseDeepLink', () => {
  it('opens a directory app at the URL given', () => {
    expect(parseDeepLink(link('https://centient.work/'), APPS)).toEqual({
      kind: 'open',
      url: 'https://centient.work/',
      app: CENTIENT,
    });
    const deep = parseDeepLink(link('https://centient.work/contributors?x=1#y'), APPS);
    expect(deep).toMatchObject({ kind: 'open', url: 'https://centient.work/contributors?x=1#y' });
  });

  it('accepts a trailing-slash path and a mixed-case host', () => {
    expect(parseDeepLink(`lantern://open/?url=${encodeURIComponent('https://centient.work')}`, APPS)).toMatchObject({
      kind: 'open',
      url: 'https://centient.work/',
    });
    expect(parseDeepLink(`lantern://OPEN?url=${encodeURIComponent('https://CENTIENT.work/')}`, APPS)).toMatchObject({
      kind: 'open',
      url: 'https://centient.work/',
    });
  });

  it('refuses an origin outside the directory and names it', () => {
    expect(parseDeepLink(link('https://evil.example/'), APPS)).toEqual({ kind: 'refused', origin: 'evil.example' });
    // Look-alikes of a directory origin are other origins.
    for (const t of [
      'https://centient.work.evil.com/',
      'https://evilcentient.work/',
      'https://sub.centient.work/',
      'https://centient.work:8443/',
    ]) {
      expect(parseDeepLink(link(t), APPS)?.kind).toBe('refused');
    }
  });

  it('refuses non-https schemes', () => {
    for (const t of [
      'http://centient.work/',
      'javascript:alert(1)',
      'javascript://centient.work/%0aalert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/hosts',
      'lantern://open?url=https://centient.work/',
      'intent://centient.work/#Intent;end',
    ]) {
      expect(parseDeepLink(link(t), APPS)).toEqual(expect.objectContaining({ kind: 'refused' }));
      expect(parseDeepLink(link(t), APPS)?.kind).not.toBe('open');
    }
  });

  it('refuses userinfo tricks', () => {
    // The host here is evil.com, not centient.work.
    expect(parseDeepLink(link('https://centient.work@evil.com/'), APPS)).toEqual({
      kind: 'refused',
      origin: 'evil.com',
    });
    expect(parseDeepLink(link('https://centient.work:pw@evil.com/'), APPS)?.kind).toBe('refused');
    // Credentials on the right host are refused too.
    expect(parseDeepLink(link('https://user@centient.work/'), APPS)?.kind).toBe('refused');
    // A raw (unencoded) `@` in the query doesn't change which URL is checked.
    expect(parseDeepLink('lantern://open?url=https://centient.work@evil.com/', APPS)?.kind).toBe('refused');
  });

  it('refuses encoded tricks', () => {
    // Double-encoded: decodes once to a string that isn't an https URL.
    expect(parseDeepLink(`lantern://open?url=${encodeURIComponent(encodeURIComponent('https://centient.work/'))}`, APPS)?.kind).toBe('refused');
    // Backslash / tab tricks the URL parser normalizes: still judged by the real host.
    expect(parseDeepLink(link('https://evil.com\\@centient.work/'), APPS)?.kind).toBe('refused');
    expect(parseDeepLink(link('https://evil.com\\.centient.work/'), APPS)?.kind).toBe('refused');
    // A second `url` makes which one was checked ambiguous.
    expect(
      parseDeepLink(`${link('https://centient.work/')}&url=${encodeURIComponent('https://evil.com/')}`, APPS)?.kind,
    ).toBe('refused');
    // Punycode look-alike host.
    expect(parseDeepLink(link('https://cеntient.work/'), APPS)?.kind).toBe('refused');
  });

  it('refuses malformed or missing targets', () => {
    expect(parseDeepLink('lantern://open', APPS)).toEqual({ kind: 'refused' });
    expect(parseDeepLink('lantern://open?url=', APPS)).toEqual({ kind: 'refused' });
    expect(parseDeepLink('lantern://open?url=not%20a%20url', APPS)).toEqual({ kind: 'refused' });
    expect(parseDeepLink('lantern://open/elsewhere?url=https%3A%2F%2Fcentient.work%2F', APPS)).toEqual({
      kind: 'refused',
    });
    expect(parseDeepLink(link(`https://centient.work/${'a'.repeat(3000)}`), APPS)?.kind).toBe('refused');
  });

  it('ignores anything that is not a lantern://open link', () => {
    expect(parseDeepLink('https://centient.work/', APPS)).toBeNull();
    expect(parseDeepLink('lantern://other?url=https%3A%2F%2Fcentient.work%2F', APPS)).toBeNull();
    expect(parseDeepLink('com.lantern.wallet://open?url=x', APPS)).toBeNull();
    expect(parseDeepLink('', APPS)).toBeNull();
    expect(parseDeepLink('::::', APPS)).toBeNull();
  });

  it('never opens a bundled app or Lantern itself', () => {
    const apps: MiniApp[] = [
      BUNDLED,
      { ...CENTIENT, id: 'android', url: `${ANDROID_ORIGIN}/` },
      { ...CENTIENT, id: 'web', url: `${WEB_APP_ORIGIN}/` },
      { ...CENTIENT, id: 'plain', url: 'http://plain.example/' },
    ];
    expect(deepLinkOrigins(apps)).toEqual([]);
    expect(parseDeepLink(link(`${ANDROID_ORIGIN}/`), apps)?.kind).toBe('refused');
    expect(parseDeepLink(link(`${WEB_APP_ORIGIN}/`), apps)?.kind).toBe('refused');
  });
});

describe('deepLinkOrigins / asset_statements', () => {
  it('lists each remote https directory origin once', () => {
    expect(deepLinkOrigins([BUNDLED, CENTIENT, { ...CENTIENT, id: 'c2', url: 'https://centient.work/x' }])).toEqual([
      'https://centient.work',
    ]);
  });

  it('builds the Digital Asset Links statement Centient expects', () => {
    expect(JSON.parse(assetStatements(['https://centient.work']))).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'web', site: 'https://centient.work' },
      },
    ]);
  });

  it('the committed Android resource names every directory origin', () => {
    for (const o of deepLinkOrigins(MINI_APPS)) expect(assetXml).toContain(`\\"site\\":\\"${o}\\"`);
  });

  it('the manifest declares the statements and the lantern://open filter', () => {
    expect(manifest).toContain('android:name="asset_statements" android:resource="@string/asset_statements"');
    expect(manifest).toMatch(
      /<intent-filter>\s*<action android:name="android.intent.action.VIEW" \/>\s*<category android:name="android.intent.category.DEFAULT" \/>\s*<category android:name="android.intent.category.BROWSABLE" \/>\s*<data android:scheme="lantern" android:host="open" \/>\s*<\/intent-filter>/,
    );
  });
});

describe('pending deep link (in memory)', () => {
  beforeEach(() => {
    const p = peekDeepLink();
    if (p) takeDeepLink(p.id);
  });

  it('holds the latest lantern://open link until taken', () => {
    let calls = 0;
    const off = onDeepLink(() => calls++);
    receiveDeepLink('https://not-a-deep-link.example/');
    receiveDeepLink(undefined);
    expect(peekDeepLink()).toBeNull();
    receiveDeepLink(link('https://evil.example/'));
    receiveDeepLink(link(MINI_APPS.find((a) => a.url)!.url!));
    expect(calls).toBe(2);
    const p = peekDeepLink()!;
    expect(p.link.kind).toBe('open');
    takeDeepLink(p.id - 1); // a stale id doesn't drop the newer link
    expect(peekDeepLink()).toBe(p);
    takeDeepLink(p.id);
    expect(peekDeepLink()).toBeNull();
    off();
  });
});

// #270 review F1: a link and a tap open the same directory app the same way, so
// a per-app frame property set for one can't be missing from the other.
describe('deep link opens like tapping the app', () => {
  it('builds the same Open as launchApp, apart from src', () => {
    const parsed = parseDeepLink(link('https://CENTIENT.work/contributors?x=1'), APPS);
    if (parsed?.kind !== 'open') throw new Error('expected open');
    const viaLink = remoteAppOpen(parsed.app, parsed.url);
    const viaTap = remoteAppOpen(CENTIENT, miniAppSrc(CENTIENT));
    expect(viaLink.src).toBe('https://centient.work/contributors?x=1');
    expect(viaTap.src).toBe('https://centient.work/');
    expect({ ...viaLink, src: '' }).toEqual({ ...viaTap, src: '' });
  });

  it('both Apps.tsx paths build the Open through remoteAppOpen', () => {
    expect(appsSrc).toContain('setOpen(remoteAppOpen(link.app, link.url));');
    expect(appsSrc).toContain('setOpen(remoteAppOpen(app, miniAppSrc(app)));');
    expect(appsSrc).not.toMatch(/setOpen\(\{ kind: 'url', src: (link\.url|miniAppSrc)/);
  });
});
