import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { readEnv } from '../src/env';
import { memoryStore } from '../src/telemetry/store';
import { COOKIE, parseFilters, toCsv } from '../src/routes/admin';

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
  const app = createApp({
    env: env(over),
    store: withStore ? store : null,
    log: () => {},
    nowDate: NOW,
    adminSessionNonce: 'test-nonce',
  });
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
  return { app, store, login, cookieFrom, get, seed };
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
        `^${COOKIE}=[0-9a-f]{64}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$`,
      ),
    );
    expect(cookie).not.toContain(TOKEN); // the cookie is a derived value, never the token

    const page = await h.get('/admin', h.cookieFrom(ok));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('activity report');
  });

  it('rejects a forged or foreign cookie, and logout clears the session', async () => {
    const h = harness();
    expect((await h.get('/admin', `${COOKIE}=${'0'.repeat(64)}`)).status).toBe(401);
    expect((await h.get('/admin', `${COOKIE}=${TOKEN}`)).status).toBe(401);
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

describe('/admin report', () => {
  it('renders the report for the default window with the address label, and honours filters', async () => {
    const h = harness();
    await h.seed();
    const cookie = h.cookieFrom(await h.login(TOKEN));
    const page = await (await h.get('/admin', cookie)).text();
    expect(page).toContain('GA7Q…VSGZ'); // alpha install labelled by address
    expect(page).toContain(ADDRESS);
    expect(page).toContain('User 1'); // the anonymous android install
    expect(page).not.toContain(UUID_A);
    expect(page).not.toContain(UUID_B);
    expect(page).toContain('<form class="bar"'); // the toolbar
    expect(page).toContain('value="2026-08-21"'); // default since = now − 30 d
    expect(page).not.toContain('v0.0.9'); // the July row is outside the window

    const wallet = await (await h.get(`/admin?account=${ADDRESS}`, cookie)).text();
    expect(wallet).toContain('GA7Q…VSGZ');
    expect(wallet).not.toContain('User 1');

    const android = await (await h.get('/admin?platform=android', cookie)).text();
    expect(android).toContain('User 1');
    expect(android).not.toContain('GA7Q…VSGZ');

    const wide = await (await h.get('/admin?since=2026-06-01&until=2026-10-01', cookie)).text();
    expect(wide).toContain('v0.0.9');

    const none = await (await h.get('/admin?since=2027-01-01&until=2027-02-01', cookie)).text();
    expect(none).toContain('No activity in this window');
  });

  it('serves the same rows as CSV with the account column', async () => {
    const h = harness();
    await h.seed();
    const cookie = h.cookieFrom(await h.login(TOKEN));
    const res = await h.get(`/admin/export.csv?account=${ADDRESS}`, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain(
      'lantern-telemetry-2026-08-21_2026-09-21.csv',
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
      account: '',
      platform: '',
    });
    expect(
      parseFilters({ since: '2026-01-01', until: 'nope', account: 'GABC', platform: 'ios' }, now),
    ).toEqual({
      since: '2026-01-01',
      until: '2026-09-21',
      account: '',
      platform: '',
    });
    expect(parseFilters({ account: ADDRESS, platform: 'android' }, now).account).toBe(ADDRESS);
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
