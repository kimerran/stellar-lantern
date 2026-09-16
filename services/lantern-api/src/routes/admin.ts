// The analytics page (#104): the activity report, served.
//
//   GET  /admin              no session → login form; session → the report
//                            ?since=YYYY-MM-DD&until=YYYY-MM-DD&account=G…&platform=extension|android
//   POST /admin/login        form field `token` → timingSafeEqual against TELEMETRY_ADMIN_TOKEN
//                            → session cookie → 303 /admin
//   POST /admin/logout       clears the cookie → 303 /admin
//   GET  /admin/export.csv   the raw rows for the same filters, `account` included
//
// The cookie never carries the token: its value is an HMAC of the token under
// a nonce minted at boot, so a restart invalidates every session and a leaked
// cookie cannot be replayed against the export API. Same report code as the
// offline `npm run report:activity` (src/core/telemetry/report.ts), so the
// page and the emailed file never disagree. No admin token configured → 404,
// exactly like the export.

import { Hono } from 'hono';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { buildReport, renderHtml, esc, CSS, type Row } from '@lantern/telemetry-report';
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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sessionValue(token: string, nonce: string): string {
  return createHmac('sha256', nonce).update(token).digest('hex');
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
  account: string; // '' = all
  platform: string; // '' = all
}

export function parseFilters(q: Record<string, string | undefined>, now: Date): Filters {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const until = DATE_RE.test(q.until ?? '') ? q.until! : day(new Date(now.getTime() + DAY_MS));
  const since = DATE_RE.test(q.since ?? '') ? q.since! : day(new Date(now.getTime() - 30 * DAY_MS));
  const account = ACCOUNT_RE.test(q.account ?? '') ? q.account! : '';
  const platform = q.platform === 'extension' || q.platform === 'android' ? q.platform : '';
  return { since, until, account, platform };
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
      if (f.account && r.account !== f.account) continue;
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

function toolbar(f: Filters): string {
  const opt = (v: string, label: string) =>
    `<option value="${v}"${f.platform === v ? ' selected' : ''}>${label}</option>`;
  const qs = new URLSearchParams({
    since: f.since,
    until: f.until,
    ...(f.account ? { account: f.account } : {}),
    ...(f.platform ? { platform: f.platform } : {}),
  }).toString();
  return `<form class="bar" method="get" action="/admin">
<label>From (inclusive)<input type="date" name="since" value="${esc(f.since)}"></label>
<label>To (exclusive)<input type="date" name="until" value="${esc(f.until)}"></label>
<label>Wallet<input type="text" name="account" value="${esc(f.account)}" placeholder="G… (all)" size="20"></label>
<label>Platform<select name="platform">${opt('', 'all')}${opt('extension', 'Chrome')}${opt('android', 'Android')}</select></label>
<button type="submit">Apply</button>
<a class="btn ghost" href="/admin/export.csv?${esc(qs)}">Download CSV</a>
<button class="ghost" type="submit" formmethod="post" formaction="/admin/logout">Sign out</button>
</form>`;
}

export function adminRoutes(deps: AdminDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date());
  const nonce = deps.sessionNonce ?? randomBytes(32).toString('hex');
  const log = deps.log;
  const session = deps.adminToken ? sessionValue(deps.adminToken, nonce) : null;

  const hasSession = (cookieHeader: string | undefined): boolean => {
    if (!session) return false;
    const given = cookieOf(cookieHeader);
    return given !== null && same(given, session);
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
    if (!deps.adminToken || !session) return c.json({ error: 'not_found' }, 404);
    const started = Date.now();
    const body = await c.req.parseBody();
    const token = typeof body.token === 'string' ? body.token : '';
    if (!token || !same(token, deps.adminToken)) {
      log({ route: 'admin_login', status: 401, outcome: 'unauthorized', ms: Date.now() - started });
      return c.html(loginPage('That token is not right.'), 401);
    }
    c.header('Set-Cookie', setCookie(session, SESSION_HOURS * 3600));
    log({ route: 'admin_login', status: 303, outcome: 'ok', ms: Date.now() - started });
    return c.redirect('/admin', 303);
  });

  app.post('/admin/logout', (c) => {
    if (!session) return c.json({ error: 'not_found' }, 404);
    c.header('Set-Cookie', setCookie('', 0));
    return c.redirect('/admin', 303);
  });

  app.get('/admin', async (c) => {
    if (!session) return c.json({ error: 'not_found' }, 404);
    if (!hasSession(c.req.header('cookie'))) return c.html(loginPage(), 401);
    if (!deps.store) return c.html(loginPage('No database is configured on this deployment.'), 503);
    const f = parseFilters(c.req.query(), now());
    const rows = await loadRows(deps.store, f);
    const report = buildReport(rows, {
      since: `${f.since}T00:00:00.000Z`,
      until: `${f.until}T00:00:00.000Z`,
      registryCount: null,
      registryId: deps.registryId,
      now,
    });
    log({ route: 'admin_report', status: 200, rows: rows.length });
    return c.html(renderHtml(report, toolbar(f)));
  });

  app.get('/admin/export.csv', async (c) => {
    if (!session) return c.json({ error: 'not_found' }, 404);
    if (!hasSession(c.req.header('cookie'))) return c.html(loginPage(), 401);
    if (!deps.store) return c.json({ error: 'unavailable' }, 503);
    const f = parseFilters(c.req.query(), now());
    const rows = await loadRows(deps.store, f);
    log({ route: 'admin_csv', status: 200, rows: rows.length });
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header(
      'Content-Disposition',
      `attachment; filename="lantern-telemetry-${f.since}_${f.until}.csv"`,
    );
    return c.body(toCsv(rows));
  });

  return app;
}
