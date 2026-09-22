// The analytics UI's views (#106): dashboard, wallets table, per-wallet
// drill-down. Pure functions over report rows + server-rendered HTML; the
// only "chart" is inline SVG. No script anywhere — asserted by test. Uses the
// shared report module's palette and escaping so the pages match the emailed
// report (src/core/telemetry/report.ts).

import { esc, CSS, type Row, type UserTrail } from '@lantern/telemetry-report';
import type { DownloadRow } from '../downloads/store';

// ── Model ────────────────────────────────────────────────────────────────────

// One identity per ROW: the row's wallet address. Row-local on purpose: an
// install that switches wallets shows up as two identities — nothing is
// re-attributed. Rows with no address (non-alpha builds, or an alpha install's
// rows sent before it had a wallet) are not wallets and are dropped from every
// page here by `walletRows`; they stay in the raw exports and the full report.
// `identityKey` is the download-side key, shared with the row filter in
// admin.ts (there, an install id still selects an anonymous install's rows);
// it agrees with `walletRows` that an empty account is no account, so a
// drill-down and its download name the same identity.
export interface WalletSummary {
  key: string; // the address — the URL segment
  label: string; // "GA7Q…VSGZ"
  account: string;
  installs: number;
  platforms: string[];
  appVersion: string; // latest seen
  network: string;
  firstSeen: string;
  lastSeen: string;
  events: number;
  sessions: number;
  txSigned: number;
  txScanned: number;
  highRiskGated: number;
  messagesScanned: number;
}

export interface Daily {
  day: string; // YYYY-MM-DD
  events: number;
  sessions: number;
  wallets: number; // distinct identities active that day
}

export interface Dashboard {
  wallets: number;
  installs: number;
  events: number;
  sessions: number;
  txSigned: number;
  highRiskGated: number;
  byPlatform: Record<string, number>; // identities per platform
  byEvent: Array<{ event: string; count: number; wallets: number }>;
  verdicts: Record<string, number>; // tx_scanned by risk
  daily: Daily[];
}

const truncate = (a: string): string => `${a.slice(0, 4)}…${a.slice(-4)}`;
const DAY_MS = 86_400_000;

export const identityKey = (r: Pick<Row, 'account' | 'installId'>): string =>
  r.account || r.installId;

type WalletRow = Row & { account: string };

// The rows the analytics pages are built from: only those carrying a wallet.
export const walletRows = (rows: Row[]): WalletRow[] =>
  rows.filter((r): r is WalletRow => typeof r.account === 'string' && r.account.length > 0);

export function summarizeWallets(rows: Row[]): WalletSummary[] {
  const out = new Map<
    string,
    WalletSummary & { installSet: Set<string>; platformSet: Set<string>; latest: string }
  >();
  const sorted = walletRows(rows).sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id);
  for (const r of sorted) {
    const key = r.account;
    let w = out.get(key);
    if (!w) {
      w = {
        key,
        label: truncate(r.account),
        account: r.account,
        installs: 0,
        platforms: [],
        appVersion: r.appVersion,
        network: r.network,
        firstSeen: r.ts,
        lastSeen: r.ts,
        events: 0,
        sessions: 0,
        txSigned: 0,
        txScanned: 0,
        highRiskGated: 0,
        messagesScanned: 0,
        installSet: new Set(),
        platformSet: new Set(),
        latest: r.ts,
      };
      out.set(key, w);
    }
    w.installSet.add(r.installId);
    w.platformSet.add(r.platform);
    if (r.ts >= w.latest) {
      w.latest = r.ts;
      w.appVersion = r.appVersion;
    }
    w.lastSeen = r.ts > w.lastSeen ? r.ts : w.lastSeen;
    w.events += 1;
    if (r.event === 'session_start') w.sessions += 1;
    if (r.event === 'tx_signed') w.txSigned += 1;
    if (r.event === 'tx_scanned') w.txScanned += 1;
    if (r.event === 'high_risk_gated') w.highRiskGated += 1;
    if (r.event === 'message_scanned') w.messagesScanned += 1;
  }
  return [...out.values()].map(({ installSet, platformSet, latest: _l, ...w }) => ({
    ...w,
    installs: installSet.size,
    platforms: [...platformSet].sort(),
  }));
}

export type WalletSort =
  | 'lastSeen'
  | 'firstSeen'
  | 'events'
  | 'sessions'
  | 'txSigned'
  | 'highRiskGated';
export const WALLET_SORTS: WalletSort[] = [
  'lastSeen',
  'firstSeen',
  'events',
  'sessions',
  'txSigned',
  'highRiskGated',
];

export function sortWallets(ws: WalletSummary[], by: WalletSort): WalletSummary[] {
  return [...ws].sort((a, b) => {
    const x = a[by];
    const y = b[by];
    const d =
      typeof x === 'number' && typeof y === 'number' ? y - x : String(y).localeCompare(String(x));
    return d || a.label.localeCompare(b.label, undefined, { numeric: true });
  });
}

export function dailySeries(rows: Row[], since: string, until: string): Daily[] {
  const byDay = new Map<string, { events: number; sessions: number; wallets: Set<string> }>();
  const start = Date.parse(`${since}T00:00:00Z`);
  const end = Date.parse(`${until}T00:00:00Z`);
  for (let t = start; t < end && Number.isFinite(t); t += DAY_MS) {
    byDay.set(new Date(t).toISOString().slice(0, 10), {
      events: 0,
      sessions: 0,
      wallets: new Set(),
    });
  }
  for (const r of walletRows(rows)) {
    const d = byDay.get(r.ts.slice(0, 10));
    if (!d) continue; // outside the window (rows are filtered by receivedAt; ts may straddle)
    d.events += 1;
    if (r.event === 'session_start') d.sessions += 1;
    d.wallets.add(r.account);
  }
  return [...byDay.entries()].map(([day, d]) => ({
    day,
    events: d.events,
    sessions: d.sessions,
    wallets: d.wallets.size,
  }));
}

export function buildDashboard(allRows: Row[], since: string, until: string): Dashboard {
  const rows = walletRows(allRows);
  const ws = summarizeWallets(rows);
  const byPlatform: Record<string, number> = {};
  for (const w of ws) for (const p of w.platforms) byPlatform[p] = (byPlatform[p] ?? 0) + 1;
  const ev = new Map<string, { count: number; wallets: Set<string> }>();
  const verdicts: Record<string, number> = {};
  for (const r of rows) {
    const e = ev.get(r.event) ?? { count: 0, wallets: new Set<string>() };
    e.count += 1;
    e.wallets.add(r.account);
    ev.set(r.event, e);
    if (r.event === 'tx_scanned') {
      const risk = String(r.props.risk ?? 'unknown');
      verdicts[risk] = (verdicts[risk] ?? 0) + 1;
    }
  }
  return {
    wallets: ws.length,
    installs: new Set(rows.map((r) => r.installId)).size,
    events: rows.length,
    sessions: ws.reduce((n, w) => n + w.sessions, 0),
    txSigned: ws.reduce((n, w) => n + w.txSigned, 0),
    highRiskGated: ws.reduce((n, w) => n + w.highRiskGated, 0),
    byPlatform,
    byEvent: [...ev.entries()]
      .map(([event, e]) => ({ event, count: e.count, wallets: e.wallets.size }))
      .sort((a, b) => b.count - a.count || a.event.localeCompare(b.event)),
    verdicts,
    daily: dailySeries(rows, since, until),
  };
}

// ── Downloads (#131) ─────────────────────────────────────────────────────────
//
// The download log is a server log of CLICKS on /download/<target>, not app
// telemetry: it has no consent behind it and no identity, so it is never
// joined to rows — only counted next to them. "Download intents" is the
// honest label and the only one used here.

export interface Downloads {
  total: number;
  byTarget: Record<string, number>;
  bySrc: Array<{ src: string; count: number }>;
  byUa: Record<string, number>;
  daily: Array<{ day: string; android: number; extension: number }>;
  // The funnel this exists to show: clicks → installs that reported anything
  // (opt-in) → wallets with a scan. Each step is a different population and
  // the ratios are indicative, never exact — consent sits between the first
  // two and cannot be seen.
  funnel: { intents: number; installs: number; walletsScanned: number };
}

export function buildDownloads(
  downloads: DownloadRow[],
  rows: Row[],
  since: string,
  until: string,
): Downloads {
  const byTarget: Record<string, number> = {};
  const byUa: Record<string, number> = {};
  const src = new Map<string, number>();
  const days = new Map<string, { android: number; extension: number }>();
  const start = Date.parse(`${since}T00:00:00Z`);
  const end = Date.parse(`${until}T00:00:00Z`);
  for (let t = start; t < end; t += DAY_MS)
    days.set(new Date(t).toISOString().slice(0, 10), { android: 0, extension: 0 });
  for (const d of downloads) {
    byTarget[d.target] = (byTarget[d.target] ?? 0) + 1;
    byUa[d.uaFamily] = (byUa[d.uaFamily] ?? 0) + 1;
    const label = d.src || '(none)';
    src.set(label, (src.get(label) ?? 0) + 1);
    const day = days.get(d.ts.toISOString().slice(0, 10));
    if (day) day[d.target] += 1;
  }
  const scanned = new Set<string>();
  for (const r of rows) if (r.event === 'tx_scanned' && r.account) scanned.add(r.account);
  return {
    total: downloads.length,
    byTarget,
    bySrc: [...src.entries()]
      .map(([s, count]) => ({ src: s, count }))
      .sort((a, b) => b.count - a.count || a.src.localeCompare(b.src)),
    byUa,
    daily: [...days.entries()].map(([day, v]) => ({ day, ...v })),
    funnel: {
      intents: downloads.length,
      installs: new Set(rows.map((r) => r.installId)).size,
      walletsScanned: scanned.size,
    },
  };
}

export function renderDownloadsCard(d: Downloads, qs: string): string {
  const f = d.funnel;
  const pct = (a: number, b: number) => (b > 0 ? ` (${Math.round((100 * a) / b)}%)` : '');
  const funnel = `<table><tr><th>step</th><th class="n">count</th></tr>
<tr><td>download intents (clicks)</td><td class="n">${n(f.intents)}</td></tr>
<tr><td>installs reporting (opt-in)</td><td class="n">${n(f.installs)}${esc(pct(f.installs, f.intents))}</td></tr>
<tr><td>wallets that scanned</td><td class="n">${n(f.walletsScanned)}${esc(pct(f.walletsScanned, f.intents))}</td></tr></table>
<p class="note">A click is an intent, not a completed download; consent sits between the first two steps and cannot be seen. Ratios are indicative.</p>`;
  const bySrc = d.bySrc.length
    ? `<table><tr><th>src</th><th class="n">clicks</th></tr>${d.bySrc
        .map((s) => `<tr><td><code>${esc(s.src)}</code></td><td class="n">${n(s.count)}</td></tr>`)
        .join('')}</table>`
    : '<p class="note">no download clicks in this window</p>';
  const targets = ['android', 'extension']
    .map((t) => `<span class="pill">${esc(t)}: ${n(d.byTarget[t] ?? 0)}</span>`)
    .join(' ');
  const ua = Object.entries(d.byUa)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<span class="pill">${esc(k)}: ${n(v)}</span>`)
    .join(' ');
  return `<div class="card"><h2>Download intents</h2><p class="note">${targets}${ua ? ' · ' + ua : ''}</p>
<div class="grid2"><div>${funnel}</div><div>${bySrc}</div></div>
<div class="actions"><a href="/admin/downloads.csv?${esc(qs)}">Download CSV</a></div></div>`;
}

// The rows of one identity, as the trail the report already renders.
export function walletTrail(
  rows: Row[],
  key: string,
): { summary: WalletSummary; trail: UserTrail; rows: Row[] } | null {
  const w = summarizeWallets(rows).find((x) => x.key === key);
  if (!w) return null;
  const mine = walletRows(rows)
    .filter((r) => r.account === key)
    .sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id);
  const trail: UserTrail = {
    label: w.label,
    account: w.account,
    platform: w.platforms.join(' + '),
    network: w.network,
    appVersion: w.appVersion,
    firstSeen: w.firstSeen,
    lastSeen: w.lastSeen,
    events: mine.map((r) => ({ at: r.ts, event: r.event, props: r.props })),
  };
  return { summary: w, trail, rows: mine };
}

// ── Rendering ────────────────────────────────────────────────────────────────

const UI_CSS = `
nav.tabs{display:flex;gap:6px;margin:14px 0 4px}nav.tabs a{color:var(--muted);text-decoration:none;padding:6px 12px;border-radius:8px;border:1px solid transparent}
nav.tabs a.on{color:var(--amber);border-color:var(--line);background:var(--surface)}nav.tabs a:hover{color:var(--on)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:720px){.grid2{grid-template-columns:1fr}}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin:12px 0}
.card h2{margin:0 0 8px;font-size:15px;border:0;padding:0;color:var(--amber-soft)}
svg.chart{width:100%;height:auto;display:block}
table a{color:var(--amber-soft);text-decoration:none}table a:hover{text-decoration:underline}
th a{color:inherit;text-decoration:none}th a.on{color:var(--amber)}th a.on::after{content:" ↓"}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}.actions a{background:transparent;color:var(--amber-soft);border:1px solid var(--line);border-radius:8px;padding:7px 12px;text-decoration:none;font-size:13px}
.actions a.primary{background:var(--amber);color:#1a1300;border-color:var(--amber);font-weight:600}
.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:1px 8px;font-size:12px;color:var(--muted);margin-right:4px}
code.addr{word-break:break-all}
`;

const fmtDay = (iso: string) => iso.slice(0, 10);
const fmtTs = (iso: string) => iso.replace('T', ' ').slice(0, 16) + ' UTC';
const n = (x: number) => x.toLocaleString('en-US');

export function pageShell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}${UI_CSS}</style></head><body><main>
${body}
</main></body></html>`;
}

export function tabs(active: 'dashboard' | 'wallets' | 'report', qs: string): string {
  const t = (id: string, href: string, label: string) =>
    `<a href="${esc(href)}${qs ? '?' + esc(qs) : ''}"${active === id ? ' class="on"' : ''}>${label}</a>`;
  return `<nav class="tabs">${t('dashboard', '/admin', 'Dashboard')}${t('wallets', '/admin/wallets', 'Wallets')}${t('report', '/admin/report', 'Full report')}</nav>`;
}

export function downloadLinks(qs: string, extra = ''): string {
  return `<div class="actions"><a href="/admin/export.csv?${esc(qs)}">Download CSV</a><a href="/admin/export.json?${esc(qs)}">Download JSON</a>${extra}</div>`;
}

// Bars for events/day with a session line drawn as a second, thinner bar.
export function dailyChart(d: Daily[]): string {
  if (d.length === 0) return '<p class="note">No days in this window.</p>';
  const W = 720;
  const H = 160;
  const padL = 36;
  const padB = 22;
  const max = Math.max(1, ...d.map((x) => x.events));
  const bw = (W - padL) / d.length;
  const y = (v: number) => H - padB - ((H - padB - 8) * v) / max;
  const bars = d
    .map((x, i) => {
      const x0 = padL + i * bw;
      const e = `<rect x="${(x0 + bw * 0.15).toFixed(1)}" y="${y(x.events).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${(H - padB - y(x.events)).toFixed(1)}" fill="#ffc107" opacity="0.85"><title>${esc(x.day)}: ${x.events} events, ${x.sessions} sessions, ${x.wallets} wallets</title></rect>`;
      const s = `<rect x="${(x0 + bw * 0.35).toFixed(1)}" y="${y(x.sessions).toFixed(1)}" width="${(bw * 0.3).toFixed(1)}" height="${(H - padB - y(x.sessions)).toFixed(1)}" fill="#dae2fd" opacity="0.9"/>`;
      const every = Math.max(1, Math.ceil(d.length / 10));
      const lbl =
        i % every === 0
          ? `<text x="${(x0 + bw / 2).toFixed(1)}" y="${H - 6}" font-size="10" fill="#d4c5ab" text-anchor="middle">${esc(x.day.slice(5))}</text>`
          : '';
      return e + s + lbl;
    })
    .join('');
  const axis = `<text x="${padL - 6}" y="12" font-size="10" fill="#d4c5ab" text-anchor="end">${max}</text><text x="${padL - 6}" y="${H - padB}" font-size="10" fill="#d4c5ab" text-anchor="end">0</text><line x1="${padL}" y1="${H - padB}" x2="${W}" y2="${H - padB}" stroke="#2d3449"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Events per day">${axis}${bars}</svg><p class="note"><span class="pill" style="border-color:#ffc107">events</span><span class="pill" style="border-color:#dae2fd">sessions</span> per UTC day</p>`;
}

const tiles = (pairs: Array<[string, string | number]>) =>
  `<div class="tiles">${pairs.map(([k, v]) => `<div class="tile"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>`;

export function renderDashboard(
  d: Dashboard,
  opts: { toolbar: string; qs: string; window: string; downloads?: string },
): string {
  const top = tiles([
    ['wallets', d.wallets],
    ['installs', d.installs],
    ['sessions', d.sessions],
    ['events', d.events],
    ['transactions signed', d.txSigned],
    ['high-risk gates', d.highRiskGated],
    ...Object.entries(d.byPlatform).map(
      ([k, v]) => [`wallets on ${k === 'extension' ? 'Chrome' : k}`, v] as [string, number],
    ),
  ]);
  const events = d.byEvent.length
    ? `<table><tr><th>event</th><th class="n">count</th><th class="n">wallets</th></tr>${d.byEvent
        .map(
          (e) =>
            `<tr><td><code>${esc(e.event)}</code></td><td class="n">${n(e.count)}</td><td class="n">${n(e.wallets)}</td></tr>`,
        )
        .join('')}</table>`
    : '<p class="note">none</p>';
  const verdicts = Object.keys(d.verdicts).length
    ? `<table><tr><th>risk</th><th class="n">scans</th></tr>${['high', 'medium', 'low', 'unknown']
        .filter((k) => d.verdicts[k])
        .map((k) => `<tr><td>${esc(k)}</td><td class="n">${n(d.verdicts[k]!)}</td></tr>`)
        .join('')}</table>`
    : '<p class="note">no transaction scans yet</p>';
  const body = `<h1><span>Lantern</span> analytics</h1><p class="meta">${esc(opts.window)}</p>
${tabs('dashboard', opts.qs)}
${opts.toolbar}
${d.events === 0 ? '<div class="empty">No activity in this window yet.</div>' : ''}
${top}
<div class="card"><h2>Daily activity</h2>${dailyChart(d.daily)}</div>
<div class="grid2"><div class="card"><h2>Events</h2>${events}</div><div class="card"><h2>Transaction scans by risk</h2>${verdicts}</div></div>
${opts.downloads ?? ''}
<div class="actions"><a class="primary" href="/admin/wallets${opts.qs ? '?' + esc(opts.qs) : ''}">Wallets →</a><a href="/admin/export.csv?${esc(opts.qs)}">Download CSV</a><a href="/admin/export.json?${esc(opts.qs)}">Download JSON</a></div>`;
  return pageShell('Lantern analytics', body);
}

export function renderWallets(
  ws: WalletSummary[],
  opts: { toolbar: string; qs: string; window: string; sort: WalletSort },
): string {
  const col = (id: WalletSort, label: string) => {
    const p = new URLSearchParams(opts.qs);
    p.set('sort', id);
    return `<th class="n"><a href="/admin/wallets?${esc(p.toString())}"${opts.sort === id ? ' class="on"' : ''}>${label}</a></th>`;
  };
  const rows = ws
    .map(
      (w) =>
        `<tr><td><a href="/admin/wallets/${esc(w.key)}${opts.qs ? '?' + esc(opts.qs) : ''}">${esc(w.label)}</a></td><td>${w.platforms.map((p) => `<span class="pill">${esc(p === 'extension' ? 'Chrome' : p)}</span>`).join('')}</td><td>v${esc(w.appVersion)}</td><td>${esc(fmtDay(w.firstSeen))}</td><td>${esc(fmtDay(w.lastSeen))}</td><td class="n">${n(w.sessions)}</td><td class="n">${n(w.events)}</td><td class="n">${n(w.txSigned)}</td><td class="n">${n(w.highRiskGated)}</td></tr>`,
    )
    .join('');
  const table = ws.length
    ? `<table><tr><th>wallet</th><th>platform</th><th>version</th>${col('firstSeen', 'first seen')}${col('lastSeen', 'last seen')}${col('sessions', 'sessions')}${col('events', 'events')}${col('txSigned', 'tx signed')}${col('highRiskGated', 'high-risk gates')}</tr>${rows}</table>`
    : '<div class="empty">No wallets in this window.</div>';
  const body = `<h1><span>Lantern</span> analytics</h1><p class="meta">${esc(opts.window)} · ${n(ws.length)} wallets</p>
${tabs('wallets', opts.qs)}
${opts.toolbar}
${table}
<p class="note">One row per wallet address reported by an alpha build; anonymous installs (no address) are not listed here — they remain in the downloads and the full report. Click a row for the full trail.</p>
${downloadLinks(opts.qs)}`;
  return pageShell('Lantern analytics — wallets', body);
}

export function renderWallet(
  w: { summary: WalletSummary; trail: UserTrail },
  daily: Daily[],
  opts: { qs: string; window: string },
): string {
  const s = w.summary;
  const t = w.trail;
  const wq = new URLSearchParams(opts.qs);
  wq.set('wallet', s.key);
  const body = `<h1><span>Lantern</span> analytics</h1><p class="meta">${esc(opts.window)}</p>
${tabs('wallets', opts.qs)}
<div class="card"><h2>${esc(s.label)}</h2>
<p class="meta"><code class="addr">${esc(s.account)}</code></p>
<p class="meta">${s.platforms.map((p) => `<span class="pill">${esc(p === 'extension' ? 'Chrome' : p)}</span>`).join('')} v${esc(s.appVersion)} · ${esc(s.network)} · ${n(s.installs)} install${s.installs === 1 ? '' : 's'} · first seen ${esc(fmtTs(s.firstSeen))} · last seen ${esc(fmtTs(s.lastSeen))}</p>
${tiles([
  ['sessions', s.sessions],
  ['events', s.events],
  ['tx signed', s.txSigned],
  ['tx scanned', s.txScanned],
  ['high-risk gates', s.highRiskGated],
  ['messages checked', s.messagesScanned],
])}
<div class="actions"><a href="/admin/export.csv?${esc(wq.toString())}">Download this wallet's CSV</a><a href="/admin/export.json?${esc(wq.toString())}">Download this wallet's JSON</a><a href="/admin/wallets${opts.qs ? '?' + esc(opts.qs) : ''}">← All wallets</a></div>
</div>
<div class="card"><h2>Daily activity</h2>${dailyChart(daily)}</div>
<div class="card"><h2>Trail</h2><ol>${t.events
    .map(
      (e) =>
        `<li>${esc(fmtTs(e.at))} — <code>${esc(e.event)}</code>${
          Object.keys(e.props).length
            ? ` (${Object.entries(e.props)
                .map(([k, v]) => `${esc(k)}=${esc(String(v))}`)
                .join(', ')})`
            : ''
        }</li>`,
    )
    .join('')}</ol></div>`;
  return pageShell(`Lantern analytics — ${s.label}`, body);
}

export function renderNotFound(qs: string): string {
  return pageShell(
    'Lantern analytics — not found',
    `<h1><span>Lantern</span> analytics</h1>${tabs('wallets', qs)}<div class="empty">No wallet with that key in this window. <a href="/admin/wallets${qs ? '?' + esc(qs) : ''}">All wallets</a></div>`,
  );
}
