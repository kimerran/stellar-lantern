// The analytics page (#104): the activity report, served.
//
//   GET  /admin                no session → login form; session → the dashboard (#106)
//                              ?since=YYYY-MM-DD&until=YYYY-MM-DD&platform=extension|android
//   GET  /admin/wallets        one row per identity, ?sort=lastSeen|firstSeen|events|sessions|txSigned|highRiskGated
//   GET  /admin/wallets/:key   drill-down: key = G… address, or the install id of an anonymous install
//   GET  /admin/report         the full emailed-style report for the window
//   POST /admin/login          form field `token` → timingSafeEqual against TELEMETRY_ADMIN_TOKEN
//                              → session cookie → 303 /admin
//   POST /admin/logout         clears the cookie → 303 /admin
//   GET  /admin/export.csv     the raw rows for the same filters, `account` included
//   GET  /admin/export.json    same rows as { rows: [...] }; add &wallet=<key> for one identity
//
// The cookie never carries the token: its value is an HMAC of the token under
// a nonce minted at boot, so a restart invalidates every session and a leaked
// cookie cannot be replayed against the export API. Same report code as the
// offline `npm run report:activity` (src/core/telemetry/report.ts), so the
// page and the emailed file never disagree. No admin token configured → 404,
// exactly like the export.

import { Hono, type Context } from 'hono';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { buildReport, renderHtml, esc, CSS, type Row } from '@lantern/telemetry-report';
import {
  buildDashboard,
  dailySeries,
  renderDashboard,
  renderNotFound,
  renderWallet,
  renderWallets,
  sortWallets,
  summarizeWallets,
  walletTrail,
  WALLET_SORTS,
  type WalletSort,
} from './admin-views';
import type { TelemetryRow, TelemetryStore } from '../telemetry/store';
import { EXPORT_PAGE } from './telemetry';

export interface AdminDeps {
  store: TelemetryStore | null;
  adminToken?: string;
  registryId: string;
  now?: () => Date;
  log: (line: Record<string, string | number>) => void;
  // Injectable so tests can mint a known session.
  sessionNonce?: string;
}

export const COOKIE = 'lantern_admin';
const SESSION_HOURS = 12;
const DAY_MS = 86_400_000;
const MAX_ROWS = 50_000; // page cap: alpha volumes are tiny; a runaway range still terminates
const ACCOUNT_RE = /^G[A-Z2-7]{55}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Session value = `<expiresAtMs>.<hmac(nonce, token + "." + expiresAtMs)>`.
// The expiry is signed in and enforced server-side: Max-Age only tells a
// well-behaved browser to drop the cookie; a copied header must die too.
function sessionValue(token: string, nonce: string, expiresAt: number): string {
  const mac = createHmac('sha256', nonce).update(`${token}.${expiresAt}`).digest('hex');
  return `${expiresAt}.${mac}`;
}
function sessionValid(given: string, token: string, nonce: string, nowMs: number): boolean {
  const dot = given.indexOf('.');
  if (dot <= 0) return false;
  const expiresAt = Number(given.slice(0, dot));
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowMs) return false;
  return same(given, sessionValue(token, nonce, expiresAt));
}
function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function cookieOf(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}
function setCookie(value: string, maxAgeSec: number): string {
  return `${COOKIE}=${value}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`;
}

// Report rows are ISO strings; store rows are Dates.
const toRow = (r: TelemetryRow): Row => ({
  id: r.id,
  installId: r.installId,
  platform: r.platform,
  appVersion: r.appVersion,
  network: r.network,
  event: r.event,
  props: r.props,
  ts: r.ts.toISOString(),
  receivedAt: r.receivedAt.toISOString(),
  account: r.account ?? null,
});

export interface Filters {
  since: string; // YYYY-MM-DD, inclusive
  until: string; // YYYY-MM-DD, exclusive
  wallet: string; // identity key (G… or install id) for downloads; '' = all
  platform: string; // '' = all
}

export function parseFilters(q: Record<string, string | undefined>, now: Date): Filters {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const until = DATE_RE.test(q.until ?? '') ? q.until! : day(new Date(now.getTime() + DAY_MS));
  const since = DATE_RE.test(q.since ?? '') ? q.since! : day(new Date(now.getTime() - 30 * DAY_MS));
  const w = q.wallet ?? q.account ?? '';
  const wallet = ACCOUNT_RE.test(w) || UUID_RE.test(w) ? w : '';
  const platform = q.platform === 'extension' || q.platform === 'android' ? q.platform : '';
  return { since, until, wallet, platform };
}

async function loadRows(store: TelemetryStore, f: Filters): Promise<Row[]> {
  const out: Row[] = [];
  let afterId: number | undefined;
  for (;;) {
    const page = await store.export({
      since: new Date(`${f.since}T00:00:00Z`),
      until: new Date(`${f.until}T00:00:00Z`),
      ...(afterId !== undefined ? { afterId } : {}),
      limit: EXPORT_PAGE,
    });
    for (const r of page) {
      if (f.platform && r.platform !== f.platform) continue;
      out.push(toRow(r));
    }
    if (page.length < EXPORT_PAGE || out.length >= MAX_ROWS) return out;
    afterId = page[page.length - 1]!.id;
  }
}

export function toCsv(rows: Row[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [
    'id',
    'installId',
    'account',
    'platform',
    'appVersion',
    'network',
    'event',
    'props',
    'ts',
    'receivedAt',
  ];
  const lines = rows.map((r) =>
    [
      r.id,
      r.installId,
      r.account ?? '',
      r.platform,
      r.appVersion,
      r.network,
      r.event,
      JSON.stringify(r.props),
      r.ts,
      r.receivedAt,
    ]
      .map(cell)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n') + '\n';
}

function loginPage(error = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lantern analytics — sign in</title><style>${CSS}</style></head><body><main>
<div class="login"><h1><span>Lantern</span> analytics</h1><p class="meta">Enter the admin token to open the activity report.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/admin/login"><label>Admin token<input type="password" name="token" autocomplete="current-password" autofocus required></label><button type="submit">Sign in</button></form>
</div></main></body></html>`;
}

export function queryString(f: Filters): string {
  return new URLSearchParams({
    since: f.since,
    until: f.until,
    ...(f.platform ? { platform: f.platform } : {}),
    ...(f.wallet ? { wallet: f.wallet } : {}),
  }).toString();
}
const windowText = (f: Filters) => `${f.since} → ${f.until} (UTC)`;

function toolbar(f: Filters, action: string): string {
  const opt = (v: string, label: string) =>
    `<option value="${v}"${f.platform === v ? ' selected' : ''}>${label}</option>`;
  return `<form class="bar" method="get" action="${esc(action)}">
<label>From (inclusive)<input type="date" name="since" value="${esc(f.since)}"></label>
<label>To (exclusive)<input type="date" name="until" value="${esc(f.until)}"></label>
<label>Platform<select name="platform">${opt('', 'all')}${opt('extension', 'Chrome')}${opt('android', 'Android')}</select></label>
<button type="submit">Apply</button>
<button class="ghost" type="submit" formmethod="post" formaction="/admin/logout">Sign out</button>
</form>`;
}

export function adminRoutes(deps: AdminDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date());
  const nonce = deps.sessionNonce ?? randomBytes(32).toString('hex');
  const log = deps.log;
  const token = deps.adminToken ?? null;

  const hasSession = (cookieHeader: string | undefined): boolean => {
    if (!token) return false;
    const given = cookieOf(cookieHeader);
    return given !== null && sessionValid(given, token, nonce, now().getTime());
  };

  app.use('/admin/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
  });
  app.use('/admin', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
  });

  app.post('/admin/login', async (c) => {
    if (!token) return c.json({ error: 'not_found' }, 404);
    const started = Date.now();
    const body = await c.req.parseBody();
    const given = typeof body.token === 'string' ? body.token : '';
    if (!given || !same(given, token)) {
      log({ route: 'admin_login', status: 401, outcome: 'unauthorized', ms: Date.now() - started });
      return c.html(loginPage('That token is not right.'), 401);
    }
    const expiresAt = now().getTime() + SESSION_HOURS * 3600_000;
    c.header('Set-Cookie', setCookie(sessionValue(token, nonce, expiresAt), SESSION_HOURS * 3600));
    log({ route: 'admin_login', status: 303, outcome: 'ok', ms: Date.now() - started });
    return c.redirect('/admin', 303);
  });

  app.post('/admin/logout', (c) => {
    if (!token) return c.json({ error: 'not_found' }, 404);
    c.header('Set-Cookie', setCookie('', 0));
    return c.redirect('/admin', 303);
  });

  // Session + store gate shared by every page; returns the rows for the window
  // (platform-filtered), or the response to send instead.
  type Gate = { rows: Row[]; f: Filters } | { deny: Response };
  const gate = async (c: Context, html: boolean): Promise<Gate> => {
    if (!token) return { deny: c.json({ error: 'not_found' }, 404) };
    if (!hasSession(c.req.header('cookie'))) return { deny: c.html(loginPage(), 401) };
    if (!deps.store)
      return {
        deny: html
          ? c.html(loginPage('No database is configured on this deployment.'), 503)
          : c.json({ error: 'unavailable' }, 503),
      };
    const f = parseFilters(c.req.query(), now());
    return { rows: await loadRows(deps.store, f), f };
  };
  // Rows narrowed to one identity when ?wallet= is set (downloads, drill-down).
  const narrow = (rows: Row[], f: Filters): Row[] =>
    f.wallet ? (walletTrail(rows, f.wallet)?.rows ?? []) : rows;

  app.get('/admin', async (c) => {
    const g = await gate(c, true);
    if ('deny' in g) return g.deny;
    const { rows, f } = g;
    const d = buildDashboard(rows, f.since, f.until);
    log({ route: 'admin_dashboard', status: 200, rows: rows.length });
    return c.html(
      renderDashboard(d, {
        toolbar: toolbar(f, '/admin'),
        qs: queryString(f),
        window: windowText(f),
      }),
    );
  });

  app.get('/admin/wallets', async (c) => {
    const g = await gate(c, true);
    if ('deny' in g) return g.deny;
    const { rows, f } = g;
    const sortQ = c.req.query('sort') ?? '';
    const sort: WalletSort = (WALLET_SORTS as string[]).includes(sortQ)
      ? (sortQ as WalletSort)
      : 'lastSeen';
    const ws = sortWallets(summarizeWallets(rows), sort);
    log({ route: 'admin_wallets', status: 200, rows: rows.length });
    return c.html(
      renderWallets(ws, {
        toolbar: toolbar(f, '/admin/wallets'),
        qs: queryString(f),
        window: windowText(f),
        sort,
      }),
    );
  });

  app.get('/admin/wallets/:key', async (c) => {
    const g = await gate(c, true);
    if ('deny' in g) return g.deny;
    const { rows, f } = g;
    const key = c.req.param('key');
    const w = ACCOUNT_RE.test(key) || UUID_RE.test(key) ? walletTrail(rows, key) : null;
    if (!w) {
      log({ route: 'admin_wallet', status: 404 });
      return c.html(renderNotFound(queryString(f)), 404);
    }
    log({ route: 'admin_wallet', status: 200, rows: w.rows.length });
    return c.html(
      renderWallet(w, dailySeries(w.rows, f.since, f.until), {
        qs: queryString(f),
        window: windowText(f),
      }),
    );
  });

  app.get('/admin/report', async (c) => {
    const g = await gate(c, true);
    if ('deny' in g) return g.deny;
    const { rows, f } = g;
    const report = buildReport(narrow(rows, f), {
      since: `${f.since}T00:00:00.000Z`,
      until: `${f.until}T00:00:00.000Z`,
      registryCount: null,
      registryId: deps.registryId,
      now,
    });
    log({ route: 'admin_report', status: 200, rows: rows.length });
    const nav = `<nav class="tabs"><a href="/admin?${esc(queryString(f))}">← Dashboard</a><a href="/admin/wallets?${esc(queryString(f))}">Wallets</a></nav>`;
    return c.html(renderHtml(report, nav + toolbar(f, '/admin/report')));
  });

  const fileStem = (f: Filters) =>
    `lantern-telemetry-${f.wallet ? f.wallet.slice(0, 8) + '-' : ''}${f.since}_${f.until}`;

  app.get('/admin/export.csv', async (c) => {
    const g = await gate(c, false);
    if ('deny' in g) return g.deny;
    const rows = narrow(g.rows, g.f);
    log({ route: 'admin_csv', status: 200, rows: rows.length });
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${fileStem(g.f)}.csv"`);
    return c.body(toCsv(rows));
  });

  app.get('/admin/export.json', async (c) => {
    const g = await gate(c, false);
    if ('deny' in g) return g.deny;
    const rows = narrow(g.rows, g.f);
    log({ route: 'admin_json', status: 200, rows: rows.length });
    c.header('Content-Disposition', `attachment; filename="${fileStem(g.f)}.json"`);
    return c.json({ rows });
  });

  return app;
}
