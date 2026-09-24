import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { DEFAULT_ALPHA_JOIN_URL, readEnv } from '../src/env';
import { memoryStore } from '../src/telemetry/store';
import { purgeOnce } from '../src/telemetry/retention';
import { DOWNLOAD_COLUMNS, memoryDownloads, type DownloadStore } from '../src/downloads/store';
import { buildDownloads, buildJoins } from '../src/routes/admin-views';
import routeSrc from '../src/routes/join.ts?raw';

// /join (#162): a 302 to the alpha testers' WhatsApp group that records the
// click with its ?src=, so the homepage CTA stays attributable (#131). Same
// log, privacy basis and retention as /download; never a download intent.

const TOKEN = 'admin-token-for-tests';
const NOW = () => new Date('2026-09-22T12:00:00Z');
const INVITE = 'https://chat.whatsapp.com/L3bNrVe8f0ZJoE7E6AsNT9';
const APK =
  'https://github.com/kimerran/stellar-lantern/releases/download/v0.1.0-testnet.12/lantern-0.1.0-testnet.apk';

const RELEASES = [
  {
    tag_name: 'v0.1.0-testnet.12',
    prerelease: true,
    draft: false,
    assets: [{ name: 'lantern-0.1.0-testnet.apk', browser_download_url: APK }],
  },
];
const githubFetch = (async () => ({
  ok: true,
  status: 200,
  json: async () => RELEASES,
})) as unknown as typeof fetch;

function env(over: Record<string, string> = {}) {
  return readEnv({
    ANTHROPIC_API_KEY: 'sk-test',
    TELEMETRY_ADMIN_TOKEN: TOKEN,
    RATE_LIMIT_PER_MIN: '1000',
    ...over,
  });
}

function harness(over: Record<string, string> = {}, downloads: DownloadStore = memoryDownloads()) {
  const store = memoryStore();
  const lines: Array<Record<string, string | number>> = [];
  const app = createApp({
    env: env(over),
    store,
    downloads,
    log: (l) => void lines.push(l),
    nowDate: NOW,
    now: () => NOW().getTime(),
    adminSessionNonce: 'test-nonce',
    fetchImpl: githubFetch,
  });
  const get = (path: string, headers: Record<string, string> = {}) =>
    app.request(path, { headers, redirect: 'manual' });
  return { app, store, downloads: downloads as ReturnType<typeof memoryDownloads>, get, lines };
}

describe('GET /join', () => {
  it('302s to the group invite with no-store, and writes exactly one row', async () => {
    const h = harness();
    const r = await h.get('/join?src=homepage', {
      'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/128 Mobile',
    });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(INVITE);
    // Never a cacheable 301: a cached redirect would skip the count.
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(h.downloads.rows).toHaveLength(1);
    expect(h.downloads.rows[0]).toMatchObject({
      target: 'alpha',
      version: '',
      src: 'homepage',
      country: 'unknown',
      uaFamily: 'android',
      ts: NOW(),
    });
  });

  it('one row per GET; ?src= is a slug or nothing, exactly as /download', async () => {
    const h = harness();
    await h.get('/join?src=homepage');
    await h.get('/join?src=Guide');
    await h.get('/join?src=https://evil.example/x');
    await h.get('/join?src=' + encodeURIComponent('a'.repeat(40)));
    await h.get('/join');
    expect(h.downloads.rows.map((r) => r.src)).toEqual(['homepage', 'guide', '', '', '']);
    // Garbage src never changes where the visitor goes.
    const r = await h.get('/join?src=%3Cscript%3E');
    expect(r.headers.get('location')).toBe(INVITE);
  });

  it('a HEAD (link preview, uptime probe) redirects but is not a click', async () => {
    const h = harness();
    const head = await h.app.request('/join?src=homepage', { method: 'HEAD', redirect: 'manual' });
    expect(head.status).toBe(302);
    expect(head.headers.get('location')).toBe(INVITE);
    expect(h.downloads.rows).toHaveLength(0);
  });

  it('stores no raw IP and no user-agent string — the row is exactly the declared columns', async () => {
    const h = harness();
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A) AppleWebKit/537.36 Chrome/128.0.6613.88 Mobile Safari/537.36';
    await h.get('/join?src=homepage', {
      'user-agent': ua,
      'x-forwarded-for': '203.0.113.9, 198.51.100.7',
      'cf-ipcountry': 'PH',
    });
    const row = h.downloads.rows[0]!;
    expect(Object.keys(row).sort()).toEqual([...DOWNLOAD_COLUMNS].sort());
    const flat = JSON.stringify(row);
    for (const s of ['203.0.113.9', '198.51.100.7', 'Pixel', 'AppleWebKit']) {
      expect(flat).not.toContain(s);
    }
    expect(row.country).toBe('PH');
    expect(routeSrc).not.toMatch(/x-forwarded-for|clientIp|remoteAddr|socket\.remote/i);
  });

  it('redirects without a database, and logs nothing', async () => {
    const app = createApp({ env: env(), store: null, downloads: null, log: () => {} });
    const r = await app.request('/join?src=homepage', { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(INVITE);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('a store failure never costs the visitor the invite', async () => {
    const broken: DownloadStore = {
      insertDownload: async () => {
        throw new Error('db down');
      },
      listDownloads: async () => [],
      purgeDownloadsBefore: async () => 0,
    };
    const h = harness({}, broken);
    const r = await h.get('/join?src=homepage');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(INVITE);
    expect(h.lines).toContainEqual({ route: 'join', status: 302, code: 'store_error' });
  });

  it('shares the /download limiter: per-IP window and daily cap', async () => {
    const h = harness({ RATE_LIMIT_PER_MIN: '2', DOWNLOADS_DAILY_CAP: '3' });
    const ip = { 'x-forwarded-for': '198.51.100.1' };
    expect((await h.get('/join', ip)).status).toBe(302);
    expect((await h.get('/download/android', ip)).status).toBe(302);
    expect((await h.get('/join', ip)).status).toBe(429);
    const other = { 'x-forwarded-for': '198.51.100.2' };
    expect((await h.get('/join', other)).status).toBe(302);
    expect((await h.get('/join', { 'x-forwarded-for': '198.51.100.3' })).status).toBe(429);
    expect(h.downloads.rows).toHaveLength(3);
  });
});

describe('ALPHA_JOIN_URL', () => {
  it('defaults to the group invite', () => {
    expect(env().alphaJoinUrl).toBe(INVITE);
    expect(DEFAULT_ALPHA_JOIN_URL).toBe(INVITE);
    expect(env({ ALPHA_JOIN_URL: '' }).alphaJoinUrl).toBe(INVITE);
  });

  it('an override is used by the route (a reset invite needs no deploy of code)', async () => {
    const other = 'https://chat.whatsapp.com/AbC123newInvite';
    expect(env({ ALPHA_JOIN_URL: other }).alphaJoinUrl).toBe(other);
    const h = harness({ ALPHA_JOIN_URL: other });
    expect((await h.get('/join')).headers.get('location')).toBe(other);
  });

  it('boot fails on anything but a https://chat.whatsapp.com/<code> invite', () => {
    for (const bad of [
      'http://chat.whatsapp.com/L3bNrVe8f0ZJoE7E6AsNT9',
      'https://evil.example/L3bNrVe8f0ZJoE7E6AsNT9',
      'https://chat.whatsapp.com.evil.example/abc',
      'https://chat.whatsapp.com/',
      'https://chat.whatsapp.com/abc?x=https://evil.example',
      'https://user@chat.whatsapp.com/abc',
      'javascript:alert(1)',
    ]) {
      expect(() => env({ ALPHA_JOIN_URL: bad }), bad).toThrow(/ALPHA_JOIN_URL/);
    }
  });
});

describe('retention', () => {
  it('sweeps join rows on the same window as downloads and telemetry', async () => {
    const store = memoryStore();
    const downloads = memoryDownloads();
    const row = { target: 'alpha' as const, version: '', src: 'homepage', country: 'unknown' };
    await downloads.insertDownload({
      ...row,
      uaFamily: 'other',
      ts: new Date('2026-06-01T00:00:00Z'),
    });
    await downloads.insertDownload({
      ...row,
      uaFamily: 'other',
      ts: new Date('2026-09-20T00:00:00Z'),
    });
    const n = await purgeOnce({ store, downloads, retentionDays: 90, now: NOW, log: () => {} });
    expect(n).toBe(1);
    expect(downloads.rows).toHaveLength(1);
    expect(downloads.rows[0]!.ts.toISOString()).toBe('2026-09-20T00:00:00.000Z');
  });
});

describe('/admin shows joins on their own, and the download funnel is unchanged', () => {
  const login = async (h: ReturnType<typeof harness>) => {
    const r = await h.app.request('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: TOKEN }).toString(),
    });
    return r.headers.get('set-cookie')!.split(';')[0]!;
  };

  it('joins by src on their own card; download intents do not count them', async () => {
    const h = harness();
    await h.get('/download/android?src=guide');
    await h.get('/join?src=homepage');
    await h.get('/join?src=homepage');
    await h.get('/join?src=guide');
    await h.get('/join');
    const cookie = await login(h);
    const page = await (await h.app.request('/admin', { headers: { Cookie: cookie } })).text();
    // The funnel still says one download intent, not five.
    expect(page).toMatch(/download intents \(clicks\)<\/td><td class="n">1</);
    expect(page).toContain('android: 1');
    expect(page).toContain(
      '<th>src</th><th class="n">clicks</th></tr><tr><td><code>guide</code></td><td class="n">1</td></tr></table>',
    );
    expect(page).toContain('Alpha group joins');
    expect(page).toContain('group clicks: 4');
    expect(page).toContain('<code>homepage</code></td><td class="n">2');
    expect(page).toContain('<code>(none)</code></td><td class="n">1');
    expect(page).not.toContain('<script');

    const csv = await (
      await h.app.request('/admin/downloads.csv', { headers: { Cookie: cookie } })
    ).text();
    expect(csv.split('\n')[0]).toBe('id,target,version,src,country,uaFamily,ts');
    expect(csv).toContain('2,alpha,,homepage,unknown,other,2026-09-22T12:00:00.000Z');
  });

  it('buildDownloads ignores join rows entirely; buildJoins counts only them', () => {
    const base = { version: '0.1.0', country: 'unknown', uaFamily: 'other' as const };
    const ts = new Date('2026-09-21T09:00:00Z');
    const log = [
      { id: 1, target: 'android' as const, src: 'guide', ts, ...base },
      { id: 2, target: 'alpha' as const, src: 'homepage', ts, ...base, version: '' },
      { id: 3, target: 'alpha' as const, src: '', ts, ...base, version: '' },
    ];
    const d = buildDownloads(log, [], '2026-09-20', '2026-09-23');
    expect(d.total).toBe(1);
    expect(d.funnel.intents).toBe(1);
    expect(d.byTarget).toEqual({ android: 1 });
    expect(d.bySrc).toEqual([{ src: 'guide', count: 1 }]);
    expect(d.daily[1]).toEqual({ day: '2026-09-21', android: 1, extension: 0 });
    expect(buildJoins(log)).toEqual({
      total: 2,
      bySrc: [
        { src: '(none)', count: 1 },
        { src: 'homepage', count: 1 },
      ],
    });
  });
});
