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
    // The failed refresh is not retried on every click: within the retry
    // interval the stale answer serves without a second fetch, then a retry.
    const fetched = calls.length;
    h.advance(10_000);
    expect((await h.get('/download/android')).headers.get('location')).toBe(APK);
    expect(calls).toHaveLength(fetched);
    h.advance(30_000);
    await h.get('/download/android');
    expect(calls).toHaveLength(fetched + 1);

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

// ── Private repo (#153): internal-lantern's Releases, read with a token ──────

const PRIV = 'kimerran/internal-lantern';
const GH_TOKEN = 'github_pat_TEST_do_not_leak_1234567890';
const assetApi = (id: number) => `https://api.github.com/repos/${PRIV}/releases/assets/${id}`;
const signed = (name: string) =>
  `https://release-assets.githubusercontent.com/github-production-release-asset/1/${name}?sp=r&sig=abc&se=2026-09-24T00%3A05%3A00Z`;
const SUMS = [
  `${'a'.repeat(64)}  lantern-0.2.0-testnet.apk`,
  `${'b'.repeat(64)}  lantern-extension-0.2.0.zip`,
].join('\n');
const PRIV_RELEASES = [
  {
    tag_name: 'v0.2.0-testnet.9',
    prerelease: true,
    draft: false,
    assets: [
      {
        name: 'lantern-0.2.0-testnet.apk',
        url: assetApi(11),
        browser_download_url: `https://github.com/${PRIV}/releases/download/v0.2.0-testnet.9/lantern-0.2.0-testnet.apk`,
      },
      {
        name: 'lantern-extension-0.2.0.zip',
        url: assetApi(12),
        browser_download_url: `https://github.com/${PRIV}/releases/download/v0.2.0-testnet.9/lantern-extension-0.2.0.zip`,
      },
      {
        name: 'SHA256SUMS.txt',
        url: assetApi(13),
        browser_download_url: `https://github.com/${PRIV}/releases/download/v0.2.0-testnet.9/SHA256SUMS.txt`,
      },
    ],
  },
];

interface Seen {
  url: string;
  headers: Record<string, string>;
  redirect?: string;
}

// A GitHub that serves private assets: the list and the asset API need the
// token; the asset API answers a 302 to a signed URL that needs nothing.
function privateGithub(
  opts: { seen?: Seen[]; listDown?: boolean; assetDown?: boolean; assetStatus?: number } = {},
): typeof fetch {
  let n = 0;
  return (async (url: string, init?: { headers?: Record<string, string>; redirect?: string }) => {
    const headers = init?.headers ?? {};
    opts.seen?.push({ url, headers, ...(init?.redirect ? { redirect: init.redirect } : {}) });
    const authed = headers.Authorization === `Bearer ${GH_TOKEN}`;
    if (url.startsWith(`https://api.github.com/repos/${PRIV}/releases?`)) {
      if (opts.listDown) throw new Error('api down');
      if (!authed) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => PRIV_RELEASES };
    }
    if (url.startsWith(assetApi(0).slice(0, -1))) {
      if (opts.assetDown) throw new Error('asset api down');
      if (!authed || headers.Accept !== 'application/octet-stream')
        return { ok: false, status: 404, headers: new Headers() };
      const status = opts.assetStatus ?? 302;
      const name = PRIV_RELEASES[0]!.assets.find((a) => a.url === url)!.name;
      n += 1;
      return {
        ok: status < 300,
        status,
        headers: new Headers(status === 302 ? { location: `${signed(name)}&n=${n}` } : {}),
      };
    }
    if (url.startsWith('https://release-assets.githubusercontent.com/')) {
      return { ok: true, status: 200, text: async () => `${SUMS}\n` };
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}

function privateHarness(
  over: Record<string, string> = {},
  fetchOpts: Parameters<typeof privateGithub>[0] = {},
) {
  const downloads = memoryDownloads();
  const lines: Array<Record<string, string | number>> = [];
  const app = createApp({
    env: env({ DOWNLOADS_REPO: PRIV, DOWNLOADS_GITHUB_TOKEN: GH_TOKEN, ...over }),
    store: memoryStore(),
    downloads,
    log: (l) => lines.push(l),
    nowDate: NOW,
    now: () => NOW().getTime(),
    fetchImpl: privateGithub(fetchOpts),
  });
  const get = (path: string) => app.request(path, { redirect: 'manual' });
  return { app, downloads, lines, get };
}

describe('private repo downloads (#153)', () => {
  it('302s a signed-out browser to a fresh signed storage URL for each click', async () => {
    const seen: Seen[] = [];
    const h = privateHarness({}, { seen });
    const a = await h.get('/download/android?src=homepage');
    expect(a.status).toBe(302);
    expect(a.headers.get('location')).toMatch(
      /^https:\/\/release-assets\.githubusercontent\.com\/.*lantern-0\.2\.0-testnet\.apk\?.*sig=/,
    );
    const e = await h.get('/download/extension');
    expect(e.headers.get('location')).toContain('lantern-extension-0.2.0.zip');
    // A second click resolves a NEW signed URL (they expire) but reuses the list.
    const a2 = await h.get('/download/android');
    expect(a2.headers.get('location')).not.toBe(a.headers.get('location'));
    expect(seen.filter((s) => s.url.includes('/releases?'))).toHaveLength(1);
    const assetCalls = seen.filter((s) => s.url.includes('/releases/assets/'));
    expect(assetCalls).toHaveLength(3);
    for (const c of assetCalls) {
      expect(c.redirect).toBe('manual');
      expect(c.headers.Accept).toBe('application/octet-stream');
    }
    // Attribution and the download log are unchanged.
    expect(h.downloads.rows).toHaveLength(3);
    expect(h.downloads.rows[0]).toMatchObject({ target: 'android', version: '0.2.0', src: 'homepage' });
  });

  it('the token goes only to api.github.com, and never into a response or a log line', async () => {
    const seen: Seen[] = [];
    const h = privateHarness({}, { seen });
    const responses = [
      await h.get('/download/android'),
      await h.get('/download/extension'),
      await h.get('/download/checksums'),
    ];
    for (const s of seen) {
      if (s.headers.Authorization) expect(s.url.startsWith('https://api.github.com/')).toBe(true);
    }
    expect(seen.some((s) => s.url.startsWith('https://release-assets.') && s.headers.Authorization)).toBe(
      false,
    );
    for (const r of responses) {
      const all = [...r.headers.entries()].map(([k, v]) => `${k}:${v}`).join('\n') + (await r.text());
      expect(all).not.toContain(GH_TOKEN);
    }
    expect(JSON.stringify(h.lines)).not.toContain(GH_TOKEN);
  });

  it('never sends the token to an asset URL outside this repo', async () => {
    const seen: Seen[] = [];
    const foreign = [
      {
        ...PRIV_RELEASES[0],
        assets: [
          {
            name: 'lantern-0.2.0-testnet.apk',
            url: 'https://api.github.com/repos/someone-else/repo/releases/assets/1',
            browser_download_url: 'https://github.com/x/y.apk',
          },
        ],
      },
    ];
    const impl = (async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push({ url, headers: init?.headers ?? {} });
      return { ok: true, status: 200, json: async () => foreign };
    }) as unknown as typeof fetch;
    const r = await createReleaseResolver({ repo: PRIV, token: GH_TOKEN, fetchImpl: impl }).resolve(
      'android',
    );
    expect(r.source).toBe('unavailable');
    expect(seen.map((s) => s.url)).toEqual([
      `https://api.github.com/repos/${PRIV}/releases?per_page=30`,
    ]);
  });

  it('GitHub down, the token rejected, or a 200 instead of a redirect → a 503 try-again page, never the private releases page', async () => {
    for (const fetchOpts of [
      { listDown: true },
      { assetDown: true },
      { assetStatus: 200 },
      { assetStatus: 401 },
    ]) {
      const h = privateHarness({}, fetchOpts);
      const r = await h.get('/download/android');
      expect(r.status, JSON.stringify(fetchOpts)).toBe(503);
      expect(r.headers.get('location')).toBeNull();
      expect(r.headers.get('retry-after')).toBe('60');
      expect(r.headers.get('cache-control')).toBe('no-store');
      const body = await r.text();
      expect(body).toContain('Downloads are temporarily unavailable');
      expect(body).not.toContain('github.com');
    }
    // A wrong token: the list 404s → same page.
    const wrong = privateHarness({ DOWNLOADS_GITHUB_TOKEN: 'github_pat_wrong' });
    expect((await wrong.get('/download/extension')).status).toBe(503);
  });

  it('a pinned public fallback still wins over the try-again page', async () => {
    const h = privateHarness(
      { DOWNLOAD_FALLBACK_ANDROID_URL: 'https://example.com/pinned.apk' },
      { assetDown: true },
    );
    const r = await h.get('/download/android');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://example.com/pinned.apk');
  });

  it('/download/checksums serves the release SHA256SUMS.txt via the signed URL, cached per tag', async () => {
    const seen: Seen[] = [];
    const h = privateHarness({}, { seen });
    const r = await h.get('/download/checksums');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(r.headers.get('x-lantern-release')).toBe('v0.2.0-testnet.9');
    expect(await r.text()).toBe(`${SUMS}\n`);
    await h.get('/download/checksums');
    expect(seen.filter((s) => s.url.startsWith('https://release-assets.'))).toHaveLength(1);
    // Not a download click: no row.
    expect(h.downloads.rows).toHaveLength(0);
  });

  it('checksums unavailable → 503 text, not a 404 from /download/:target', async () => {
    const h = privateHarness({}, { listDown: true });
    const r = await h.get('/download/checksums');
    expect(r.status).toBe(503);
    expect(await r.text()).toMatch(/temporarily unavailable/);
  });
});

describe('public repo checksums and token-less behaviour (#153)', () => {
  it('/download/checksums works signed out against the public mirror too', async () => {
    const sums = `${'c'.repeat(64)}  lantern-0.1.0-testnet.apk\n`;
    const seen: Seen[] = [];
    const impl = (async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push({ url, headers: init?.headers ?? {} });
      if (url.includes('/SHA256SUMS.txt')) return { ok: true, status: 200, text: async () => sums };
      return { ok: true, status: 200, json: async () => RELEASES };
    }) as unknown as typeof fetch;
    const app = createApp({ env: env(), store: null, downloads: null, log: () => {}, fetchImpl: impl });
    const r = await app.request('/download/checksums');
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(sums);
    expect(seen.every((s) => !s.headers.Authorization)).toBe(true);
  });

  it('rejects a checksums file that is not one', async () => {
    const impl = (async (url: string) => {
      if (url.includes('/SHA256SUMS.txt'))
        return { ok: true, status: 200, text: async () => '<html>not found</html>' };
      return { ok: true, status: 200, json: async () => RELEASES };
    }) as unknown as typeof fetch;
    const r = await createReleaseResolver({ repo: 'kimerran/stellar-lantern', fetchImpl: impl }).checksums();
    expect(r).toBeNull();
  });

  it('DOWNLOADS_GITHUB_TOKEN is optional and unset by default', () => {
    expect(env().downloadsGithubToken).toBeUndefined();
    expect(env({ DOWNLOADS_GITHUB_TOKEN: GH_TOKEN }).downloadsGithubToken).toBe(GH_TOKEN);
  });
});
