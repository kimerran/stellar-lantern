// Activity report (#81 T-5, #89): pulls raw telemetry rows from the Lantern
// API's export and writes ONE self-contained HTML file answering the four
// reporting questions, with a --format=json twin for diffing between periods.
//
//   npm run report:activity -- --since 2026-09-01 --until 2026-10-01
//   npm run report:activity -- --format=json > numbers.json
//   npm run report:activity -- --input export.jsonl   # offline, from a saved export
//
// Env: LANTERN_API_URL (default the Railway deployment), TELEMETRY_ADMIN_TOKEN
// (required unless --input), SOROBAN_RPC_URL (default testnet), and
// BLACKLIST_REGISTRY_ID (default the deployed testnet registry).
//
// Privacy: installs are rendered as "User 1", "User 2", … in first-seen order.
// The install UUID never appears in the output — asserted by test. The HTML
// has no script, no external stylesheet, font, image or fetch: it opens from
// file:// and survives being emailed.

import { Address, xdr } from '@stellar/stellar-sdk';

// ── Input ────────────────────────────────────────────────────────────────────

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
}

export interface ExportPage {
  rows: Row[];
  next: number | null;
}

export async function fetchAllRows(
  apiUrl: string,
  token: string,
  window: { since?: string; until?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<Row[]> {
  const out: Row[] = [];
  let after: number | null = null;
  for (;;) {
    const qs = new URLSearchParams();
    if (window.since) qs.set('since', window.since);
    if (window.until) qs.set('until', window.until);
    if (after !== null) qs.set('after', String(after));
    const res = await fetchImpl(`${apiUrl.replace(/\/$/, '')}/v1/telemetry/export?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`export responded ${res.status}`);
    const page = (await res.json()) as ExportPage;
    out.push(...page.rows);
    if (page.next === null) return out;
    after = page.next;
  }
}

// ── The on-chain cross-check ─────────────────────────────────────────────────
// The registry keeps `Count` (distinct reported subjects) in its instance
// storage; one fee-free getLedgerEntries read, no source account.

export function registryInstanceKey(contractId: string): string {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  ).toXDR('base64');
}

export function registryCountFromEntry(entryXdr: string): number | null {
  try {
    const data = xdr.LedgerEntryData.fromXDR(entryXdr, 'base64');
    for (const e of data.contractData().val().instance().storage() ?? []) {
      const k = e.key();
      const name =
        k.switch().name === 'scvVec'
          ? k.vec()?.[0]?.sym().toString()
          : k.switch().name === 'scvSymbol'
            ? k.sym().toString()
            : undefined;
      if (name === 'Count') return e.val().u32();
    }
  } catch {
    // fall through
  }
  return null;
}

export async function fetchRegistryCount(
  rpcUrl: string,
  contractId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const key = registryInstanceKey(contractId);
    const res = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLedgerEntries',
        params: { keys: [key] },
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      result?: { entries?: Array<{ key: string; xdr: string }> };
    };
    const hit = body.result?.entries?.find((e) => e.key === key);
    return hit ? registryCountFromEntry(hit.xdr) : null;
  } catch {
    return null;
  }
}

// ── The model (pure) ─────────────────────────────────────────────────────────

export interface UserTrail {
  label: string; // "User 3"
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
  },
): Report {
  const now = opts.now ?? (() => new Date());
  const sorted = [...rows].sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id);

  // First-seen order decides "User N"; the UUID goes no further than this map.
  const label = new Map<string, string>();
  for (const r of sorted)
    if (!label.has(r.installId)) label.set(r.installId, `User ${label.size + 1}`);

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

const esc = (s: unknown): string =>
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
const CSS = `
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
`;

export function renderHtml(r: Report): string {
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
    : `<h2>Q3 — Per-user activity</h2><p class="note">Installs are anonymous: "User N" is assigned in first-seen order and maps to nobody.</p>${r.q3
        .map(
          (t) =>
            `<div class="trail"><h3>${esc(t.label)}</h3><div class="meta">${esc(t.platform)} · ${esc(t.network)} · v${esc(t.appVersion)} · first seen ${fmtDate(t.firstSeen)} · last seen ${fmtDate(t.lastSeen)} · ${t.events.length} events</div><ol>${t.events
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

// ── CLI ──────────────────────────────────────────────────────────────────────

const DEFAULT_API = 'https://lantern-api-production-3fad.up.railway.app';
const DEFAULT_RPC = 'https://soroban-testnet.stellar.org';
const DEFAULT_REGISTRY = 'CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F';

export function parseArgs(argv: string[]): {
  format: 'html' | 'json';
  since?: string;
  until?: string;
  input?: string;
  out?: string;
} {
  const out: ReturnType<typeof parseArgs> = { format: 'html' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    const [k, inline] = a.startsWith('--') ? a.slice(2).split('=', 2) : [undefined, undefined];
    const val = () => inline ?? argv[++i];
    if (k === 'format') out.format = val() === 'json' ? 'json' : 'html';
    else if (k === 'since') out.since = val();
    else if (k === 'until') out.until = val();
    else if (k === 'input') out.input = val();
    else if (k === 'out') out.out = val();
  }
  return out;
}

async function main(): Promise<void> {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
  const args = parseArgs(process.argv.slice(2));
  const registryId = process.env.BLACKLIST_REGISTRY_ID ?? DEFAULT_REGISTRY;
  let rows: Row[];
  if (args.input) {
    rows = readFileSync(args.input, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Row);
  } else {
    const token = process.env.TELEMETRY_ADMIN_TOKEN;
    if (!token)
      throw new Error('TELEMETRY_ADMIN_TOKEN is required (or pass --input <export.jsonl>)');
    const windowArgs = {
      ...(args.since ? { since: args.since } : {}),
      ...(args.until ? { until: args.until } : {}),
    };
    rows = await fetchAllRows(process.env.LANTERN_API_URL ?? DEFAULT_API, token, windowArgs);
  }
  const registryCount = await fetchRegistryCount(
    process.env.SOROBAN_RPC_URL ?? DEFAULT_RPC,
    registryId,
  );
  const report = buildReport(rows, {
    ...(args.since ? { since: args.since } : {}),
    ...(args.until ? { until: args.until } : {}),
    registryCount,
    registryId,
  });
  if (args.format === 'json') {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  const out = args.out ?? 'dist-report/index.html';
  mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(out, renderHtml(report));
  process.stderr.write(
    `wrote ${out} — ${report.summary.installs} installs, ${report.summary.events} events\n`,
  );
}

// Only run as a CLI, never on import (tests import the functions).
const invokedDirectly = (() => {
  try {
    return process.argv[1] !== undefined && /report-activity|report\.mjs$/.test(process.argv[1]);
  } catch {
    return false;
  }
})();
if (invokedDirectly)
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
