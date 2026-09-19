// The activity report model + renderer (#81 T-5, #89; shared since #104).
// Pure: no Node, no DOM, no fetch — the CLI (scripts/report-activity.ts) and
// the Lantern API's /admin page both import it, so the offline file and the
// served page are the same report.
//
// Privacy: installs are rendered as "User 1", "User 2", … in first-seen order
// unless a --map label or (alpha builds, #100) a wallet address names them.
// The install UUID never appears in the output — asserted by test. The HTML
// has no script, no external stylesheet, font, image or fetch: it opens from
// file:// and survives being emailed.

export interface Row {
  id: number;
  installId: string;
  platform: string;
  appVersion: string;
  network: string;
  event: string;
  props: Record<string, string | boolean>;
  ts: string; // ISO
  receivedAt: string; // ISO
  // Alpha builds (#100) attach the wallet's public address; absent otherwise.
  account?: string | null;
}

// ── The model (pure) ─────────────────────────────────────────────────────────

// GBK4…X9V2 — the wallet's own middle-truncation (shared/format.ts), redone
// here because the report bundle stays free of app imports.
const truncate = (a: string): string => `${a.slice(0, 4)}…${a.slice(-4)}`;

export interface UserTrail {
  label: string; // "User 3", a --map name, or the truncated address
  account: string | null; // the full address, alpha builds only (#100)
  platform: string;
  network: string;
  appVersion: string;
  firstSeen: string;
  lastSeen: string;
  events: Array<{ at: string; event: string; props: Record<string, string | boolean> }>;
}

export interface Report {
  window: { since: string | null; until: string | null; generatedAt: string };
  summary: {
    installs: number;
    byPlatform: Record<string, number>;
    byNetwork: Record<string, number>;
    events: number;
  };
  q1: { onboarded: number; byMode: Record<string, number> };
  q2: Array<{ event: string; count: number; installs: number }>;
  q3: UserTrail[];
  q4: {
    byPlatform: Record<
      string,
      {
        txSigned: number;
        txSignedOk: number;
        txScanned: number;
        highRiskGated: number;
        messagesScanned: number;
      }
    >;
    registry: { distinctReportedSubjects: number | null; contractId: string };
  };
}

const ONBOARDING_EVENT = 'wallet_created';

export function buildReport(
  rows: Row[],
  opts: {
    since?: string;
    until?: string;
    registryCount: number | null;
    registryId: string;
    now?: () => Date;
    /** installId → tester label (#98); unmapped installs stay "User N". */
    map?: Record<string, string>;
  },
): Report {
  const now = opts.now ?? (() => new Date());
  const sorted = [...rows].sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id);

  // First-seen order decides "User N"; the UUID goes no further than this map.
  // A mapped install takes its tester label and does not consume a number;
  // failing that, an alpha install that sent its address (#100) is labelled
  // by the truncated address — the first row carrying one wins.
  const account = new Map<string, string>();
  for (const r of sorted)
    if (r.account && !account.has(r.installId)) account.set(r.installId, r.account);
  const label = new Map<string, string>();
  let anon = 0;
  for (const r of sorted) {
    if (label.has(r.installId)) continue;
    const mapped = opts.map?.[r.installId];
    const acct = account.get(r.installId);
    label.set(r.installId, mapped ? mapped : acct ? truncate(acct) : `User ${++anon}`);
  }

  const count = (f: (r: Row) => string | undefined): Record<string, number> => {
    const out: Record<string, number> = {};
    const seen = new Set<string>();
    for (const r of sorted) {
      const k = f(r);
      if (k === undefined) continue;
      const key = `${r.installId}|${k}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };

  const byEvent = new Map<string, { count: number; installs: Set<string> }>();
  for (const r of sorted) {
    const e = byEvent.get(r.event) ?? { count: 0, installs: new Set<string>() };
    e.count += 1;
    e.installs.add(r.installId);
    byEvent.set(r.event, e);
  }

  const trails = new Map<string, UserTrail>();
  for (const r of sorted) {
    let t = trails.get(r.installId);
    if (!t) {
      t = {
        label: label.get(r.installId)!,
        account: account.get(r.installId) ?? null,
        platform: r.platform,
        network: r.network,
        appVersion: r.appVersion,
        firstSeen: r.ts,
        lastSeen: r.ts,
        events: [],
      };
      trails.set(r.installId, t);
    }
    t.lastSeen = r.ts;
    t.events.push({ at: r.ts, event: r.event, props: r.props });
  }

  const q4: Report['q4']['byPlatform'] = {};
  for (const r of sorted) {
    const p = (q4[r.platform] ??= {
      txSigned: 0,
      txSignedOk: 0,
      txScanned: 0,
      highRiskGated: 0,
      messagesScanned: 0,
    });
    if (r.event === 'tx_signed') {
      p.txSigned += 1;
      if (r.props.ok === true) p.txSignedOk += 1;
    } else if (r.event === 'tx_scanned') p.txScanned += 1;
    else if (r.event === 'high_risk_gated') p.highRiskGated += 1;
    else if (r.event === 'message_scanned') p.messagesScanned += 1;
  }

  return {
    window: {
      since: opts.since ?? null,
      until: opts.until ?? null,
      generatedAt: now().toISOString(),
    },
    summary: {
      installs: label.size,
      byPlatform: count((r) => r.platform),
      byNetwork: count((r) => r.network),
      events: sorted.length,
    },
    q1: {
      onboarded: new Set(sorted.filter((r) => r.event === ONBOARDING_EVENT).map((r) => r.installId))
        .size,
      byMode: count((r) => (r.event === ONBOARDING_EVENT ? String(r.props.mode) : undefined)),
    },
    q2: [...byEvent.entries()]
      .map(([event, e]) => ({ event, count: e.count, installs: e.installs.size }))
      .sort((a, b) => b.count - a.count || a.event.localeCompare(b.event)),
    q3: [...trails.values()].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true }),
    ),
    q4: {
      byPlatform: q4,
      registry: { distinctReportedSubjects: opts.registryCount, contractId: opts.registryId },
    },
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

export const esc = (s: unknown): string =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const fmtDate = (iso: string): string =>
  iso
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC')
    .replace(/Z$/, ' UTC');
const propsText = (p: Record<string, string | boolean>): string =>
  Object.entries(p)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ');

// Lantern palette, hand-written from tailwind.config.ts (the file must stand
// alone, so no Tailwind build).
export const CSS = `
:root{--bg:#0b1326;--surface:#171f33;--surface-hi:#222a3d;--on:#dae2fd;--muted:#d4c5ab;--amber:#ffc107;--amber-soft:#ffe4af;--line:#2d3449}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--on);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:26px;margin:0 0 4px}h1 span{color:var(--amber)}h2{font-size:18px;margin:36px 0 10px;padding-bottom:6px;border-bottom:2px solid var(--amber)}
h3{font-size:15px;margin:18px 0 6px;color:var(--amber-soft)}
.meta{color:var(--muted);font-size:13px}.tiles{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 18px;min-width:150px}
.tile b{display:block;font-size:26px;color:var(--amber)}.tile span{color:var(--muted);font-size:12px}
table{border-collapse:collapse;width:100%;background:var(--surface);border-radius:12px;overflow:hidden}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}th{background:var(--surface-hi);color:var(--amber-soft);font-weight:600}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.trail{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin:12px 0}
.trail h3{margin:0 0 4px}.trail ol{margin:8px 0 0;padding-left:20px;color:var(--on)}.trail li{margin:2px 0}.trail code{color:var(--amber-soft);background:transparent}
.empty{background:var(--surface);border:1px dashed var(--line);border-radius:14px;padding:28px;text-align:center;color:var(--muted)}
.note{color:var(--muted);font-size:12px;margin-top:8px}
form.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:end;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px 16px;margin:16px 0}
form.bar label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted)}
form.bar input,form.bar select{background:var(--bg);color:var(--on);border:1px solid var(--line);border-radius:8px;padding:6px 8px;font:inherit;min-width:140px}
form.bar button,form.bar a.btn{background:var(--amber);color:#1a1300;border:0;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
form.bar a.btn.ghost,form.bar button.ghost{background:transparent;color:var(--amber-soft);border:1px solid var(--line)}
.login{max-width:380px;margin:12vh auto 0;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:24px}
.login input{width:100%;background:var(--bg);color:var(--on);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit;margin:8px 0 14px}
.login button{background:var(--amber);color:#1a1300;border:0;border-radius:8px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer}
.err{color:#ffb4ab;font-size:13px;margin:0 0 10px}
`;

// `toolbar` is raw HTML the caller has already escaped (the /admin page's
// filter form, #104); the offline report passes nothing.
export function renderHtml(r: Report, toolbar = ''): string {
  const tiles = (pairs: Array<[string, string | number]>) =>
    `<div class="tiles">${pairs.map(([k, v]) => `<div class="tile"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>`;
  const kv = (o: Record<string, number>) =>
    Object.keys(o).length
      ? `<table><tr><th>value</th><th class="n">installs</th></tr>${Object.entries(o)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${v}</td></tr>`)
          .join('')}</table>`
      : `<p class="note">none</p>`;
  const win = `${r.window.since ? fmtDate(r.window.since) : 'beginning'} → ${r.window.until ? fmtDate(r.window.until) : 'now'}`;
  const empty = r.summary.events === 0;

  const q1 = empty
    ? ''
    : `<h2>Q1 — Users onboarded</h2>${tiles([['installs that completed onboarding', r.q1.onboarded]])}${kv(r.q1.byMode)}`;
  const q2 = empty
    ? ''
    : `<h2>Q2 — How they used it</h2><table><tr><th>event</th><th class="n">count</th><th class="n">distinct installs</th></tr>${r.q2
        .map(
          (e) =>
            `<tr><td><code>${esc(e.event)}</code></td><td class="n">${e.count}</td><td class="n">${e.installs}</td></tr>`,
        )
        .join('')}</table>`;
  const q3 = empty
    ? ''
    : `<h2>Q3 — Per-user activity</h2><p class="note">${
        r.q3.some((t) => t.account)
          ? 'Alpha builds report the wallet\'s public address, shown per trail; other installs are anonymous — "User N" is assigned in first-seen order and maps to nobody.'
          : 'Installs are anonymous: "User N" is assigned in first-seen order and maps to nobody.'
      }</p>${r.q3
        .map(
          (t) =>
            `<div class="trail"><h3>${esc(t.label)}</h3><div class="meta">${t.account ? `<code>${esc(t.account)}</code> · ` : ''}${esc(t.platform)} · ${esc(t.network)} · v${esc(t.appVersion)} · first seen ${fmtDate(t.firstSeen)} · last seen ${fmtDate(t.lastSeen)} · ${t.events.length} events</div><ol>${t.events
              .map(
                (e) =>
                  `<li>${fmtDate(e.at)} — <code>${esc(e.event)}</code>${Object.keys(e.props).length ? ` (${esc(propsText(e.props))})` : ''}</li>`,
              )
              .join('')}</ol></div>`,
        )
        .join('')}`;
  const q4rows = Object.entries(r.q4.byPlatform)
    .map(
      ([p, c]) =>
        `<tr><td>${esc(p)}</td><td class="n">${c.txScanned}</td><td class="n">${c.highRiskGated}</td><td class="n">${c.txSigned}</td><td class="n">${c.txSignedOk}</td><td class="n">${c.messagesScanned}</td></tr>`,
    )
    .join('');
  const q4 = `<h2>Q4 — Transactions and scans</h2>${
    empty
      ? ''
      : `<table><tr><th>platform</th><th class="n">tx scanned</th><th class="n">high-risk gated</th><th class="n">tx signed</th><th class="n">of which ok</th><th class="n">messages checked</th></tr>${q4rows}</table>`
  }<h3>On-chain cross-check</h3>${tiles([
    [
      'distinct addresses reported in the registry',
      r.q4.registry.distinctReportedSubjects === null
        ? 'unavailable'
        : r.q4.registry.distinctReportedSubjects,
    ],
  ])}<p class="note">Read fee-free from the blacklist registry's instance storage (<code>Count</code>) on contract ${esc(r.q4.registry.contractId)}. Registry writes are observable on-chain; scans and onboarding are not — those numbers come only from the client-side events above.</p>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lantern activity report</title><style>${CSS}</style></head><body><main>
<h1><span>Lantern</span> activity report</h1><p class="meta">${esc(win)} · generated ${fmtDate(r.window.generatedAt)}</p>
${toolbar}
${tiles([
  ['distinct installs', r.summary.installs],
  ['events', r.summary.events],
  ...Object.entries(r.summary.byPlatform).map(
    ([k, v]) => [`installs on ${k}`, v] as [string, number],
  ),
  ...Object.entries(r.summary.byNetwork).map(
    ([k, v]) => [`installs on ${k}`, v] as [string, number],
  ),
])}
${empty ? '<div class="empty">No activity in this window yet. Everything below fills in once opted-in installs send events.</div>' : ''}
${q1}${q2}${q3}${q4}
</main></body></html>`;
}

// `--map` file: a flat { "<installId>": "Alice" } object. Labels are trimmed
// and must be non-empty; anything else is a usage error, not a silent skip.
// A UUID-shaped label is refused too: a label is copied into the output
// verbatim, and the report's contract is that no install UUID ever prints.
const UUID_LABEL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function readLabelMap(text: string): Record<string, string> {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('--map: expected a JSON object of { "<installId>": "label" }');
  const out: Record<string, string> = {};
  for (const [id, label] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof label !== 'string' || !label.trim())
      throw new Error(`--map: label for ${id} must be a non-empty string`);
    if (UUID_LABEL_RE.test(label.trim()))
      throw new Error(`--map: label for ${id} looks like an install id — use a name`);
    out[id] = label.trim();
  }
  return out;
}
