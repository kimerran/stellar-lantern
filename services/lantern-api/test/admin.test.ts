import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { readEnv } from '../src/env';
import { memoryStore } from '../src/telemetry/store';
import { COOKIE, parseFilters, toCsv } from '../src/routes/admin';
import { identityKey, summarizeWallets, walletRows } from '../src/routes/admin-views';

// The analytics page (#104): cookie login against the admin token, the
// report rendered from the store with filters, CSV of the same rows.

const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const TOKEN = 'admin-test-token';
const UUID_A = '5f3d2f1e-9c2b-4a1d-8e7f-0123456789ab';
const UUID_B = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const ADDRESS = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const NOW = () => new Date('2026-09-20T12:00:00Z');

const env = (over: Record<string, string> = {}) =>
  readEnv({
    ANTHROPIC_API_KEY: 'sk-test',
    ALLOWED_ORIGINS: ORIGIN,
    TELEMETRY_ADMIN_TOKEN: TOKEN,
    RATE_LIMIT_PER_MIN: '1000',
    TELEMETRY_DAILY_CAP: '100000',
    ...over,
  });

function harness(over: Record<string, string> = {}, withStore = true) {
  const store = memoryStore();
  let clock = NOW();
  const app = createApp({
    env: env(over),
    store: withStore ? store : null,
    log: () => {},
    nowDate: () => clock,
    adminSessionNonce: 'test-nonce',
  });
  const advance = (ms: number) => void (clock = new Date(clock.getTime() + ms));
  const login = (token: string) =>
    app.request('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
  const cookieFrom = (r: Response) => r.headers.get('set-cookie')?.split(';')[0] ?? '';
  const get = (path: string, cookie = '') =>
    app.request(path, { headers: cookie ? { Cookie: cookie } : {} });
  const seed = async () => {
    const at = (d: string) => new Date(d);
    await store.insert(
      [
        {
          installId: UUID_A,
          platform: 'extension',
          appVersion: '0.1.0',
          network: 'testnet',
          event: 'session_start',
          props: {},
          ts: at('2026-09-10T10:00:00Z'),
          account: ADDRESS,
        },
        {
          installId: UUID_A,
          platform: 'extension',
          appVersion: '0.1.0',
          network: 'testnet',
          event: 'tx_signed',
          props: { kind: 'sign_and_submit', ok: true },
          ts: at('2026-09-10T10:01:00Z'),
          account: ADDRESS,
        },
        {
          installId: UUID_B,
          platform: 'android',
          appVersion: '0.1.0',
          network: 'testnet',
          event: 'session_start',
          props: {},
          ts: at('2026-09-11T10:00:00Z'),
          account: null,
        },
      ],
      at('2026-09-11T10:00:00Z'),
    );
    // An old row, outside the default 30-day window.
    await store.insert(
      [
        {
          installId: UUID_B,
          platform: 'android',
          appVersion: '0.0.9',
          network: 'testnet',
          event: 'session_start',
          props: {},
          ts: at('2026-07-01T10:00:00Z'),
          account: null,
        },
      ],
      at('2026-07-01T10:00:00Z'),
    );
  };
  return { app, store, login, cookieFrom, get, seed, advance };
}

describe('/admin login', () => {
  it('shows the login form without a session, and the report only after a right token', async () => {
    const h = harness();
    const anon = await h.get('/admin');
    expect(anon.status).toBe(401);
    expect(await anon.text()).toContain('Enter the admin token');
    expect(anon.headers.get('cache-control')).toBe('no-store');
    expect(anon.headers.get('x-robots-tag')).toBe('noindex');

    const wrong = await h.login('nope');
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('set-cookie')).toBeNull();
    expect(await wrong.text()).toContain('not right');

    const ok = await h.login(TOKEN);
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/admin');
    const cookie = ok.headers.get('set-cookie')!;
    expect(cookie).toMatch(
      new RegExp(
        `^${COOKIE}=\\d{13}\\.[0-9a-f]{64}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$`,
      ),
    );
    expect(cookie).not.toContain(TOKEN); // the cookie is a derived value, never the token

    const page = await h.get('/admin', h.cookieFrom(ok));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Lantern</span> analytics');
  });

  it('rejects a forged, foreign, tampered or expired cookie, and logout clears the session', async () => {
    const h = harness();
    expect((await h.get('/admin', `${COOKIE}=${'0'.repeat(64)}`)).status).toBe(401);
    expect((await h.get('/admin', `${COOKIE}=${TOKEN}`)).status).toBe(401);
    const fresh = h.cookieFrom(await h.login(TOKEN));
    // Moving the signed expiry forward breaks the MAC.
    const [name, value] = fresh.split('=') as [string, string];
    const [exp, mac] = value.split('.') as [string, string];
    expect((await h.get('/admin', `${name}=${Number(exp) + 3_600_000}.${mac}`)).status).toBe(401);
    // A copied cookie stops working once its 12 hours are up, even if the
    // client keeps sending it — the expiry is enforced server-side.
    expect((await h.get('/admin', fresh)).status).toBe(200);
    h.advance(12 * 3_600_000 + 1);
    expect((await h.get('/admin', fresh)).status).toBe(401);
    const cookie = h.cookieFrom(await h.login(TOKEN));
    const out = await h.app.request('/admin/logout', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(out.status).toBe(303);
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('is 404 everywhere when no admin token is configured, like the export', async () => {
    const h = harness({ TELEMETRY_ADMIN_TOKEN: '' });
    expect((await h.get('/admin')).status).toBe(404);
    expect((await h.login('anything')).status).toBe(404);
    expect((await h.get('/admin/export.csv')).status).toBe(404);
  });
});

describe('/admin pages', () => {
  it('dashboard: tiles, daily chart, event + verdict tables, honours the window and platform', async () => {
    const h = harness();
    await h.seed();
    const cookie = h.cookieFrom(await h.login(TOKEN));
    const page = await (await h.get('/admin', cookie)).text();
    expect(page).not.toContain('<script');
    expect(page).toContain('<form class="bar"'); // the toolbar
    expect(page).toContain('value="2026-08-21"'); // default since = now − 30 d
    expect(page).toContain('<b>1</b><span>wallets</span>'); // the anonymous install is not a wallet
    expect(page).toContain('<b>1</b><span>installs</span>');
    expect(page).toContain('<b>1</b><span>sessions</span>');
    expect(page).toContain('<b>1</b><span>transactions signed</span>');
    expect(page).toContain('<svg class="chart"'); // daily activity
    expect(page).toContain('2026-09-10: 2 events, 1 sessions, 1 wallets'); // bar tooltip
    expect(page).toContain('2026-09-11: 0 events, 0 sessions, 0 wallets'); // the anonymous day
    expect(page).toContain(
      '<code>session_start</code></td><td class="n">1</td><td class="n">1</td>',
    );
    expect(page).toContain('no transaction scans yet');
    expect(page).not.toContain(UUID_A);
    expect(page).not.toContain(UUID_B);
    expect(page).not.toContain('User 1');

    // The only android rows are anonymous: nothing to show, but the window is not empty.
    const android = await (await h.get('/admin?platform=android', cookie)).text();
    expect(android).toContain('<b>0</b><span>wallets</span>');
    expect(android).toContain('<b>0</b><span>transactions signed</span>');

    const none = await (await h.get('/admin?since=2027-01-01&until=2027-02-01', cookie)).text();
    expect(none).toContain('No activity in this window');
    expect(none).toContain('<svg class="chart"'); // an empty chart still renders
  });

  it('wallets: one row per address, anonymous installs absent, links to the drill-down, sortable', async () => {
    const h = harness();
    const B2 = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
    await h.seed();
    await h.store.insert(
      [
        {
          installId: UUID_B,
          platform: 'android',
          appVersion: '0.1.0',
          network: 'testnet',
          event: 'session_start',
          props: {},
          ts: new Date('2026-09-12T09:00:00Z'),
          account: B2,
        },
      ],
      new Date('2026-09-12T09:00:00Z'),
    );
    const cookie = h.cookieFrom(await h.login(TOKEN));
    const page = await (await h.get('/admin/wallets', cookie)).text();
    expect(page).not.toContain('<script');
    expect(page).toContain(`href="/admin/wallets/${ADDRESS}?`);
    expect(page).toContain(`href="/admin/wallets/${B2}?`);
    expect(page).not.toContain(UUID_B); // the anonymous install is neither a row nor a link
    expect(page).not.toContain('User 1');
    expect(page).not.toContain('anonymous</span>');
    expect(page).toContain('>GA7Q…VSGZ</a>');
    expect(page).toContain('>GDVE…ZA57</a>');
    expect(page).toContain('2 wallets');
    // Default sort is last seen (desc): the android wallet (09-12) comes first.
    expect(page.indexOf('GDVE…ZA57')).toBeLessThan(page.indexOf('GA7Q…VSGZ'));
    const byEvents = await (await h.get('/admin/wallets?sort=events', cookie)).text();
    expect(byEvents.indexOf('GA7Q…VSGZ')).toBeLessThan(byEvents.indexOf('GDVE…ZA57'));
    expect(byEvents).toContain('class="on">events</a>');
    const junk = await (await h.get('/admin/wallets?sort=drop%20table', cookie)).text();
    expect(junk).toContain('class="on">last seen</a>');
  });

  it('walletRows keeps only string accounts: null, undefined and empty are anonymous', () => {
    const base = {
      id: 1,
      installId: UUID_A,
      platform: 'extension',
      appVersion: '0.1.0',
      network: 'testnet',
      event: 'session_start',
      props: {},
      ts: '2026-09-10T10:00:00.000Z',
      receivedAt: '2026-09-10T10:00:00.000Z',
    };
    const rows = [
      { ...base, id: 1, account: ADDRESS },
      { ...base, id: 2, account: null },
      { ...base, id: 3 }, // omitted, as the shared Row type allows
      { ...base, id: 4, account: '' },
    ];
    expect(walletRows(rows).map((r) => r.id)).toEqual([1]);
    expect(summarizeWallets(rows)).toHaveLength(1); // no truncate() on a non-string
    // The download filter agrees: an empty account is no account.
    expect(identityKey({ account: '', installId: UUID_A })).toBe(UUID_A);
    expect(identityKey({ account: ADDRESS, installId: UUID_A })).toBe(ADDRESS);
  });

  it('drill-down: an address; an anonymous install and an unknown key are 404', async () => {
    const h = harness();
    await h.seed();
    const cookie = h.cookieFrom(await h.login(TOKEN));
    const a = await h.get(`/admin/wallets/${ADDRESS}`, cookie);
    expect(a.status).toBe(200);
    const at = await a.text();
    expect(at).toContain(ADDRESS);
    expect(at).toContain('<b>1</b><span>sessions</span>');
    expect(at).toContain('<b>1</b><span>tx signed</span>');
    expect(at).toContain('<code>tx_signed</code> (kind=sign_and_submit, ok=true)');
    expect(at).toContain(
      `/admin/export.csv?since=2026-08-21&amp;until=2026-09-21&amp;wallet=${ADDRESS}`,
    );
    expect(at).not.toContain(UUID_A);

    // An install id is a download filter, not a wallet page.
    const b = await h.get(`/admin/wallets/${UUID_B}`, cookie);
    expect(b.status).toBe(404);

    const missing = await h.get(`/admin/wallets/${'G' + 'A'.repeat(55)}`, cookie);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('No wallet with that key');
    expect((await h.get('/admin/wallets/not-a-key', cookie)).status).toBe(404);
  });

  it('an install that switches wallets is two identities; its pre-wallet rows stay anonymous', async () => {
    const h = harness();
    const B2 = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
    const at = (d: string) => new Date(d);
    await h.store.insert(
      [
        {
          installId: UUID_A,
          platform: 'extension',
          appVersion: '0.1.0',
          network: 'testnet',
          event: 'session_start',
          props: {},
          ts: at('2026-09-10T10:00:00Z'),
          account: null,
        },
        {
          installId: UUID_A,
          platform: 'extension',
          appVersion: '0.1.0',
          network: 'testnet',
          event: 'session_start',
          props: {},
          ts: at('2026-09-11T10:00:00Z'),
          account: ADDRESS,
        },
        {
          installId: UUID_A,
          platform: 'extension',
          appVersion: '0.1.0',
          network: 'testnet',
          event: 'tx_signed',
          props: { kind: 'sign_only', ok: true },
          ts: at('2026-09-12T10:00:00Z'),
          account: B2,
        },
      ],
      at('2026-09-12T10:00:00Z'),
    );
    const cookie = h.cookieFrom(await h.login(TOKEN));
    const list = await (await h.get('/admin/wallets', cookie)).text();
    expect(list).toContain('2 wallets'); // the pre-wallet row is not an identity on the pages
    expect((await h.get(`/admin/wallets/${B2}`, cookie)).status).toBe(200);
    const b2 = (await (await h.get(`/admin/export.json?wallet=${B2}`, cookie)).json()) as {
      rows: Array<{ event: string }>;
    };
    expect(b2.rows.map((r) => r.event)).toEqual(['tx_signed']);
    const a1 = (await (await h.get(`/admin/export.json?wallet=${ADDRESS}`, cookie)).json()) as {
      rows: unknown[];
    };
    expect(a1.rows).toHaveLength(1);
    const anon = (await (await h.get(`/admin/export.json?wallet=${UUID_A}`, cookie)).json()) as {
      rows: unknown[];
    };
    expect(anon.rows).toHaveLength(1); // …but its install id still selects it for download
    // Unknown wallet on a download is a 404, never an empty file.
    expect((await h.get(`/admin/export.csv?wallet=${'G' + 'B'.repeat(55)}`, cookie)).status).toBe(
      404,
    );
  });

  it('full report: still the emailed-style page, with the address label', async () => {
    const h = harness();
    await h.seed();
    const cookie = h.cookieFrom(await h.login(TOKEN));
    const page = await (await h.get('/admin/report', cookie)).text();
    expect(page).toContain('activity report');
    expect(page).toContain('GA7Q…VSGZ');
    expect(page).toContain('User 1');
    expect(page).not.toContain(UUID_A);
    const one = await (await h.get(`/admin/report?wallet=${ADDRESS}`, cookie)).text();
    expect(one).toContain('GA7Q…VSGZ');
    expect(one).not.toContain('User 1');
  });

  it('serves the same rows as CSV with the account column', async () => {
    const h = harness();
    await h.seed();
    const cookie = h.cookieFrom(await h.login(TOKEN));
    const res = await h.get(`/admin/export.csv?wallet=${ADDRESS}`, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain(
      'lantern-telemetry-GA7QYNF7-2026-08-21_2026-09-21.csv',
    );
    const lines = (await res.text()).trim().split('\n');
    expect(lines[0]).toBe(
      'id,installId,account,platform,appVersion,network,event,props,ts,receivedAt',
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(ADDRESS);
    expect(lines[2]).toContain('"{""kind"":""sign_and_submit"",""ok"":true}"');
    expect((await h.get('/admin/export.csv')).status).toBe(401);
  });

  it('serves the same rows as JSON, whole window or one wallet (by address or install id)', async () => {
    const h = harness();
    await h.seed();
    const cookie = h.cookieFrom(await h.login(TOKEN));
    const all = (await (await h.get('/admin/export.json', cookie)).json()) as {
      rows: Array<{ account: string | null; installId: string }>;
    };
    expect(all.rows).toHaveLength(3);
    expect(all.rows.filter((r) => r.account === ADDRESS)).toHaveLength(2);
    const one = (await (await h.get(`/admin/export.json?wallet=${UUID_B}`, cookie)).json()) as {
      rows: unknown[];
    };
    expect(one.rows).toHaveLength(1);
    const res = await h.get(`/admin/export.json?wallet=${ADDRESS}`, cookie);
    expect(res.headers.get('content-disposition')).toContain('.json');
    expect((await h.get('/admin/export.json')).status).toBe(401);
  });

  it('answers 503 with the login page when no database is configured', async () => {
    const h = harness({}, false);
    const cookie = h.cookieFrom(await h.login(TOKEN));
    const res = await h.get('/admin', cookie);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('No database');
  });
});

describe('helpers', () => {
  it('parseFilters defaults, validates, and ignores junk', () => {
    const now = new Date('2026-09-20T12:00:00Z');
    expect(parseFilters({}, now)).toEqual({
      since: '2026-08-21',
      until: '2026-09-21',
      wallet: '',
      platform: '',
    });
    expect(
      parseFilters({ since: '2026-01-01', until: 'nope', wallet: 'GABC', platform: 'ios' }, now),
    ).toEqual({
      since: '2026-01-01',
      until: '2026-09-21',
      wallet: '',
      platform: '',
    });
    // Not a calendar day, or an inverted window → the default window.
    expect(parseFilters({ since: '2026-99-99', until: '2026-02-30' }, now)).toMatchObject({
      since: '2026-08-21',
      until: '2026-09-21',
    });
    expect(parseFilters({ since: '2026-09-10', until: '2026-09-01' }, now)).toMatchObject({
      since: '2026-08-21',
      until: '2026-09-21',
    });
    expect(parseFilters({ since: '2026-09-10', until: '2026-09-10' }, now)).toMatchObject({
      since: '2026-08-21',
      until: '2026-09-21',
    });
    expect(parseFilters({ since: '2024-02-29', until: '2024-03-01' }, now)).toMatchObject({
      since: '2024-02-29',
      until: '2024-03-01',
    });
    expect(parseFilters({ wallet: ADDRESS, platform: 'android' }, now).wallet).toBe(ADDRESS);
    expect(parseFilters({ wallet: UUID_B }, now).wallet).toBe(UUID_B);
    expect(parseFilters({ account: ADDRESS }, now).wallet).toBe(ADDRESS); // legacy name
  });

  it('toCsv escapes quotes, commas and newlines', () => {
    const csv = toCsv([
      {
        id: 1,
        installId: 'i',
        platform: 'a,b',
        appVersion: '"q"',
        network: 'n',
        event: 'e',
        props: {},
        ts: 't',
        receivedAt: 'r',
        account: null,
      },
    ]);
    expect(csv.split('\n')[1]).toBe('1,i,,"a,b","""q""",n,e,{},t,r');
  });
});
