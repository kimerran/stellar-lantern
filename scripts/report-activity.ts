// Activity report (#81 T-5, #89): pulls raw telemetry rows from the Lantern
// API's export and writes ONE self-contained HTML file answering the four
// reporting questions, with a --format=json twin for diffing between periods.
//
//   npm run report:activity -- --since 2026-09-01 --until 2026-10-01
//   npm run report:activity -- --format=json > numbers.json
//   npm run report:activity -- --input export.jsonl   # offline, from a saved export
//   npm run report:activity -- --map reports/alpha.map.json   # label testers (#98)
//
// Env: LANTERN_API_URL (default the Railway deployment), TELEMETRY_ADMIN_TOKEN
// (required unless --input), SOROBAN_RPC_URL (default testnet), and
// BLACKLIST_REGISTRY_ID (default the deployed testnet registry).
//
// Privacy: installs are rendered as "User 1", "User 2", … in first-seen order.
// The install UUID never appears in the output — asserted by test. `--map`
// takes a local `{ "<installId>": "Alice" }` file (a tester shares their ID
// from Settings → Privacy, #98) and renders that label instead; the file stays
// on the operator's machine and is git-ignored under reports/. The HTML
// has no script, no external stylesheet, font, image or fetch: it opens from
// file:// and survives being emailed.

import { Address, xdr } from '@stellar/stellar-sdk';

import { buildReport, readLabelMap, renderHtml, type Row } from '../src/core/telemetry/report';
export { buildReport, readLabelMap, renderHtml };
export type { Row, Report, UserTrail } from '../src/core/telemetry/report';

// ── Input ────────────────────────────────────────────────────────────────────

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
  map?: string;
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
    else if (k === 'map') out.map = val();
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
  const map = args.map ? readLabelMap(readFileSync(args.map, 'utf8')) : undefined;
  const report = buildReport(rows, {
    ...(args.since ? { since: args.since } : {}),
    ...(args.until ? { until: args.until } : {}),
    ...(map ? { map } : {}),
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
