import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { readEnv } from '../src/env';
import { memoryStore } from '../src/telemetry/store';
import { purgeOnce } from '../src/telemetry/retention';
import {
  DOWNLOAD_COLUMNS,
  countryOf,
  memoryDownloads,
  srcOf,
  uaFamilyOf,
} from '../src/downloads/store';
import { createReleaseResolver, pickAsset } from '../src/downloads/releases';
import { buildDownloads, renderDownloadsCard } from '../src/routes/admin-views';
import { downloadsCsv } from '../src/routes/admin';
import routeSrc from '../src/routes/download.ts?raw';
import storeSrc from '../src/downloads/store.ts?raw';

// /download/<target> (#131): 302-and-log to the current Release asset (#130).
// A server log with a different privacy basis from app telemetry: no IP, no
// user-agent string, its own table, the same retention sweep.

const TOKEN = 'admin-token-for-tests';
const NOW = () => new Date('2026-09-22T12:00:00Z');
const APK =
  'https://github.com/kimerran/stellar-lantern/releases/download/v0.1.0-testnet.12/lantern-0.1.0-testnet.apk';
const ZIP =
  'https://github.com/kimerran/stellar-lantern/releases/download/v0.1.0-testnet.12/lantern-extension-0.1.0.zip';
const OLD_APK =
  'https://github.com/kimerran/stellar-lantern/releases/download/v0.0.9-testnet.3/lantern-0.0.9-testnet.apk';

// What the GitHub API returns: newest first, pre-releases included (which is
// why /releases/latest cannot be used — it hides them).
const RELEASES = [
  {
    tag_name: 'v0.1.0-testnet.12',
    prerelease: true,
    draft: false,
    assets: [
      { name: 'lantern-0.1.0-testnet.apk', browser_download_url: APK },
      { name: 'lantern-extension-0.1.0.zip', browser_download_url: ZIP },
      { name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/x/SHA256SUMS.txt' },
    ],
  },
  {
    tag_name: 'v0.1.0-testnet.11',
    prerelease: true,
    draft: true,
    assets: [
      { name: 'lantern-0.1.0-testnet.apk', browser_download_url: 'https://github.com/draft/apk' },
    ],
  },
  {
    tag_name: 'v0.0.9-testnet.3',
    prerelease: true,
    draft: false,
    assets: [{ name: 'lantern-0.0.9-testnet.apk', browser_download_url: OLD_APK }],
  },
];

function githubFetch(opts: { fail?: boolean; calls?: string[] } = {}): typeof fetch {
  return (async (url: string) => {
    opts.calls?.push(url);
    if (opts.fail) throw new Error('api down');
    return { ok: true, status: 200, json: async () => RELEASES };
  }) as unknown as typeof fetch;
}

function env(over: Record<string, string> = {}) {
  return readEnv({
    ANTHROPIC_API_KEY: 'sk-test',
    TELEMETRY_ADMIN_TOKEN: TOKEN,
    RATE_LIMIT_PER_MIN: '1000',
    ...over,
  });
}

function harness(
  over: Record<string, string> = {},
  fetchOpts: { fail?: boolean; calls?: string[] } = {},
) {
  const store = memoryStore();
  const downloads = memoryDownloads();
  let clock = NOW();
  const app = createApp({
    env: env(over),
    store,
    downloads,
    log: () => {},
    nowDate: () => clock,
    now: () => clock.getTime(),
    adminSessionNonce: 'test-nonce',
    fetchImpl: githubFetch(fetchOpts),
  });
  const advance = (ms: number) => void (clock = new Date(clock.getTime() + ms));
  const get = (path: string, headers: Record<string, string> = {}) =>
    app.request(path, { headers, redirect: 'manual' });
  return { app, store, downloads, get, advance };
}

describe('GET /download/<target>', () => {
  it('302s to the newest release asset for each target, and writes exactly one row', async () => {
    const h = harness();
    const a = await h.get('/download/android', {
      'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/128 Mobile',
    });
    expect(a.status).toBe(302);
    expect(a.headers.get('location')).toBe(APK);
    expect(a.headers.get('cache-control')).toBe('no-store');
    const e = await h.get('/download/extension', {
      'user-agent': 'Mozilla/5.0 (X11; Linux) Chrome/128.0 Safari/537.36',
    });
    expect(e.headers.get('location')).toBe(ZIP);
    expect(h.downloads.rows).toHaveLength(2);
    expect(h.downloads.rows[0]).toMatchObject({
      target: 'android',
      version: '0.1.0',
      src: '',
      uaFamily: 'android',
    });
    expect(h.downloads.rows[1]).toMatchObject({
      target: 'extension',
      version: '0.1.0',
      uaFamily: 'chrome-desktop',
    });
  });

  it('the asset name ends the way the phone needs: .apk, not a zip', async () => {
    const h = harness();
    const a = await h.get('/download/android');
    expect(new URL(a.headers.get('location')!).pathname).toMatch(/\.apk$/);
    const e = await h.get('/download/extension');
    expect(new URL(e.headers.get('location')!).pathname).toMatch(
      /lantern-extension-\d+\.\d+\.\d+\.zip$/,
    );
  });

  it('?src= is captured as a slug, anything else is dropped; ?v= pins a release', async () => {
    const h = harness();
    await h.get('/download/android?src=guide');
    await h.get('/download/android?src=Twitter');
    await h.get('/download/android?src=https://evil.example/x');
    await h.get('/download/android?src=' + encodeURIComponent('a'.repeat(40)));
    expect(h.downloads.rows.map((r) => r.src)).toEqual(['guide', 'twitter', '', '']);
    const pinned = await h.get('/download/android?v=0.0.9');
    expect(pinned.headers.get('location')).toBe(OLD_APK);
    expect(h.downloads.rows[4]).toMatchObject({ version: '0.0.9' });
    // An unknown pinned version falls through to the newest, never a 500.
    const missing = await h.get('/download/android?v=9.9.9');
    expect(missing.status).toBe(302);
  });

  it('unknown targets 404; a HEAD (link preview, uptime probe) redirects but is not a click', async () => {
    const h = harness();
    expect((await h.get('/download/ios')).status).toBe(404);
    const head = await h.app.request('/download/android', { method: 'HEAD', redirect: 'manual' });
    expect(head.status).toBe(302);
    expect(h.downloads.rows).toHaveLength(0);
  });

  it('stores no raw IP and no user-agent string — the row is exactly the declared columns', async () => {
    const h = harness();
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A) AppleWebKit/537.36 Chrome/128.0.6613.88 Mobile Safari/537.36';
    await h.get('/download/android?src=guide', {
      'user-agent': ua,
      'x-forwarded-for': '203.0.113.9, 198.51.100.7',
      'cf-ipcountry': 'PH',
    });
    const row = h.downloads.rows[0]!;
    expect(Object.keys(row).sort()).toEqual([...DOWNLOAD_COLUMNS].sort());
    const flat = JSON.stringify(row);
    expect(flat).not.toContain('203.0.113.9');
    expect(flat).not.toContain('198.51.100.7');
    expect(flat).not.toContain('Pixel');
    expect(flat).not.toContain('AppleWebKit');
    expect(row.country).toBe('PH');
    expect(row.uaFamily).toBe('android');
    // And the route never reads the address at all: no x-forwarded-for, no
    // remote address, no IP helper anywhere in the two files that write rows.
    for (const src of [routeSrc, storeSrc]) {
      expect(src).not.toMatch(/x-forwarded-for|clientIp|remoteAddr|socket\.remote/i);
    }
  });

  it('the Releases API being down does not break the link: stale cache, then the pinned fallback, then the releases page', async () => {
    // 1. Warm cache, then the API dies → the last good answer keeps serving.
    const calls: string[] = [];
    const fetchOpts = { fail: false, calls };
    const h = harness({}, fetchOpts);
    expect((await h.get('/download/android')).headers.get('location')).toBe(APK);
    fetchOpts.fail = true;
    h.advance(10 * 60_000); // past the 5-minute TTL
    expect((await h.get('/download/android')).headers.get('location')).toBe(APK);
    expect(h.downloads.rows).toHaveLength(2);

    // 2. Cold cache + API down + pinned fallback from the environment.
    const cold = harness(
      { DOWNLOAD_FALLBACK_ANDROID_URL: 'https://example.com/pinned.apk' },
      { fail: true },
    );
    const r = await cold.get('/download/android');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://example.com/pinned.apk');
    expect(cold.downloads.rows[0]).toMatchObject({ version: 'unknown' });

    // 3. Nothing at all → the human-usable releases page, still a 302.
    const bare = harness({}, { fail: true });
    const rp = await bare.get('/download/extension');
    expect(rp.status).toBe(302);
    expect(rp.headers.get('location')).toBe('https://github.com/kimerran/stellar-lantern/releases');
  });

  it('caches the release list ~5 minutes and shares one in-flight fetch', async () => {
    const calls: string[] = [];
    const h = harness({}, { calls });
    await Promise.all([
      h.get('/download/android'),
      h.get('/download/extension'),
      h.get('/download/android'),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(
      'https://api.github.com/repos/kimerran/stellar-lantern/releases?per_page=30',
    );
    h.advance(4 * 60_000);
    await h.get('/download/android');
    expect(calls).toHaveLength(1);
    h.advance(2 * 60_000);
    await h.get('/download/android');
    expect(calls).toHaveLength(2);
  });

  it('is rate limited per IP and capped per day, on its own limiter', async () => {
    const h = harness({ RATE_LIMIT_PER_MIN: '3', DOWNLOADS_DAILY_CAP: '5' });
    const ip = { 'x-forwarded-for': '198.51.100.1' };
    for (let i = 0; i < 3; i += 1) expect((await h.get('/download/android', ip)).status).toBe(302);
    expect((await h.get('/download/android', ip)).status).toBe(429);
    // Another IP still gets through until the daily cap.
    const other = { 'x-forwarded-for': '198.51.100.2' };
    expect((await h.get('/download/android', other)).status).toBe(302);
    expect((await h.get('/download/android', other)).status).toBe(302);
    expect((await h.get('/download/android', { 'x-forwarded-for': '198.51.100.3' })).status).toBe(
      429,
    );
    expect(h.downloads.rows).toHaveLength(5);
  });

  it('redirects without a database, and logs nothing', async () => {
    const app = createApp({
      env: env(),
      store: null,
      downloads: null,
      log: () => {},
      fetchImpl: githubFetch(),
    });
    const r = await app.request('/download/android', { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(APK);
  });
});

describe('release picking', () => {
  it('takes the newest non-draft release carrying the asset, pre-releases included', () => {
    expect(pickAsset(RELEASES, 'android')).toMatchObject({
      url: APK,
      version: '0.1.0',
      tag: 'v0.1.0-testnet.12',
    });
    expect(pickAsset(RELEASES, 'extension')).toMatchObject({ url: ZIP });
    expect(pickAsset(RELEASES, 'android', '0.0.9')).toMatchObject({ url: OLD_APK });
    expect(pickAsset(RELEASES, 'extension', '0.0.9')).toBeNull();
    expect(
      pickAsset(
        [
          {
            tag_name: 'v1.0.0',
            assets: [
              { name: 'lantern-1.0.0-testnet.apk', browser_download_url: 'https://x/a.apk' },
            ],
          },
        ],
        'android',
      ),
    ).toBeNull();
    expect(pickAsset('nope', 'android')).toBeNull();
    // Only https asset URLs are ever redirected to.
    expect(
      pickAsset(
        [
          {
            tag_name: 'v0.1.0-testnet.1',
            assets: [{ name: 'lantern-0.1.0-testnet.apk', browser_download_url: 'http://x/a.apk' }],
          },
        ],
        'android',
      ),
    ).toBeNull();
  });

  it('the resolver never sends a token', async () => {
    const seen: Array<Record<string, string>> = [];
    const impl = (async (_u: string, init?: { headers?: Record<string, string> }) => {
      seen.push(init?.headers ?? {});
      return { ok: true, status: 200, json: async () => RELEASES };
    }) as unknown as typeof fetch;
    await createReleaseResolver({ repo: 'kimerran/stellar-lantern', fetchImpl: impl }).resolve(
      'android',
    );
    expect(Object.keys(seen[0]!).map((k) => k.toLowerCase())).not.toContain('authorization');
  });
});

describe('row helpers', () => {
  it('bucket the user agent into three families and the country into a code or unknown', () => {
    expect(uaFamilyOf('Mozilla/5.0 (Linux; Android 14) Chrome/128 Mobile')).toBe('android');
    expect(uaFamilyOf('Mozilla/5.0 (Windows NT 10.0) Chrome/128.0 Safari/537.36')).toBe(
      'chrome-desktop',
    );
    expect(uaFamilyOf('Mozilla/5.0 (Windows NT 10.0) Edg/128.0')).toBe('chrome-desktop');
    expect(uaFamilyOf('Mozilla/5.0 (Macintosh) Safari/605.1.15')).toBe('other');
    expect(uaFamilyOf('curl/8.0')).toBe('other');
    expect(uaFamilyOf(undefined)).toBe('other');
    expect(countryOf((h) => (h === 'cf-ipcountry' ? 'ph' : undefined))).toBe('PH');
    expect(countryOf((h) => (h === 'cf-ipcountry' ? 'XXX' : undefined))).toBe('unknown');
    expect(countryOf(() => undefined)).toBe('unknown');
    expect(srcOf(' Chapter ')).toBe('chapter');
    expect(srcOf('a b')).toBe('');
    expect(srcOf(undefined)).toBe('');
  });
});

describe('retention', () => {
  it('sweeps the download log on the same window as telemetry', async () => {
    const store = memoryStore();
    const downloads = memoryDownloads();
    await downloads.insertDownload({
      target: 'android',
      version: '0.1.0',
      src: '',
      country: 'unknown',
      uaFamily: 'other',
      ts: new Date('2026-06-01T00:00:00Z'),
    });
    await downloads.insertDownload({
      target: 'android',
      version: '0.1.0',
      src: '',
      country: 'unknown',
      uaFamily: 'other',
      ts: new Date('2026-09-20T00:00:00Z'),
    });
    const n = await purgeOnce({ store, downloads, retentionDays: 90, now: NOW, log: () => {} });
    expect(n).toBe(1);
    expect(downloads.rows).toHaveLength(1);
  });
});

describe('/admin shows the funnel and exports the log', () => {
  const login = async (h: ReturnType<typeof harness>) => {
    const r = await h.app.request('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: TOKEN }).toString(),
    });
    return r.headers.get('set-cookie')!.split(';')[0]!;
  };

  it('download intents → installs → wallets that scanned, by src, with a CSV', async () => {
    const h = harness();
    await h.get('/download/android?src=guide', { 'cf-ipcountry': 'PH' });
    await h.get('/download/android?src=guide');
    await h.get('/download/extension?src=twitter');
    await h.store.insert(
      [
        {
          installId: '123e4567-e89b-42d3-a456-426614174000',
          platform: 'android',
          appVersion: '0.1.0',
          network: 'testnet',
          event: 'app_first_open',
          props: {},
          ts: NOW(),
          account: 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6',
        },
        {
          installId: '123e4567-e89b-42d3-a456-426614174000',
          platform: 'android',
          appVersion: '0.1.0',
          network: 'testnet',
          event: 'tx_scanned',
          props: { risk: 'low', action: 'allow' },
          ts: NOW(),
          account: 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6',
        },
        {
          installId: '223e4567-e89b-42d3-a456-426614174000',
          platform: 'extension',
          appVersion: '0.1.0',
          network: 'testnet',
          event: 'session_start',
          props: {},
          ts: NOW(),
        },
      ],
      NOW(),
    );
    const cookie = await login(h);
    const page = await (await h.app.request('/admin', { headers: { Cookie: cookie } })).text();
    expect(page).toContain('Download intents');
    expect(page).toMatch(/download intents \(clicks\)<\/td><td class="n">3/);
    expect(page).toMatch(/installs reporting \(opt-in\)<\/td><td class="n">2 \(67%\)/);
    expect(page).toMatch(/wallets that scanned<\/td><td class="n">1 \(33%\)/);
    expect(page).toContain('<code>guide</code></td><td class="n">2');
    expect(page).toContain('<code>twitter</code></td><td class="n">1');
    expect(page).toContain('android: 2');
    expect(page).not.toContain('downloads completed');
    expect(page).not.toContain('<script');

    const csv = await h.app.request('/admin/downloads.csv', { headers: { Cookie: cookie } });
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const text = await csv.text();
    expect(text.split('\n')[0]).toBe('id,target,version,src,country,uaFamily,ts');
    expect(text).toContain('1,android,0.1.0,guide,PH,other,2026-09-22T12:00:00.000Z');
    expect(text.trim().split('\n')).toHaveLength(4);
    // No session → no export.
    expect((await h.app.request('/admin/downloads.csv')).status).toBe(401);
  });

  it('buildDownloads fills every day of the window and never joins a click to a wallet', () => {
    const d = buildDownloads(
      [
        {
          id: 1,
          target: 'android',
          version: '0.1.0',
          src: '',
          country: 'unknown',
          uaFamily: 'other',
          ts: new Date('2026-09-21T09:00:00Z'),
        },
      ],
      [],
      '2026-09-20',
      '2026-09-23',
    );
    expect(d.daily.map((x) => x.day)).toEqual(['2026-09-20', '2026-09-21', '2026-09-22']);
    expect(d.daily[1]).toEqual({ day: '2026-09-21', android: 1, extension: 0 });
    expect(d.bySrc).toEqual([{ src: '(none)', count: 1 }]);
    expect(d.funnel).toEqual({ intents: 1, installs: 0, walletsScanned: 0 });
    expect(renderDownloadsCard(d, 'since=2026-09-20')).toContain(
      'intent, not a completed download',
    );
    expect(downloadsCsv([])).toBe('id,target,version,src,country,uaFamily,ts\n');
  });
});
