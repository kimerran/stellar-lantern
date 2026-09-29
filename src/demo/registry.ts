// The playground's registry panel reader (#186). Reads the whole D1 registry
// the account-free way: ledger entries, not a simulated `count()` / `list()`,
// because a visitor has no source account. Batched: the instance (for
// `Count`), then every `Index(i)`, then every `Entry(subject)`, at most
// 200 keys per getLedgerEntries call (the RPC's limit), so a registry of up to
// 200 subjects is three round-trips in all, not one per entry. The whole set
// is needed anyway, since "reports filed" sums every entry's `reports`.

import {
  countLedgerKey,
  decodeCount,
  decodeEntry,
  decodeIndex,
  entryLedgerKey,
  indexLedgerKey,
  TESTNET_REGISTRY_ID,
  type RegistryEntry,
} from '@lantern/scanner';
import { xdr } from '@stellar/stellar-sdk';
import { DEMO_NETWORK } from './scan';

// The contract's own page size (docs/blacklist-registry.md, MAX_PAGE).
export const PAGE_SIZE = 50;
// getLedgerEntries accepts at most 200 keys per request.
const KEYS_PER_CALL = 200;
const TIMEOUT_MS = 8_000;

// Published in docs/blacklist-registry.md (deployment table) and the README;
// tests/demo-registry.test.ts pins this to the doc.
export const REGISTRY_WASM_HASH =
  '40fd37718c3fbc7f849c4d414364cdd86c01b4db9ab86be9099007ba5be23783';

export type Row =
  | { index: number; subject: string; state: 'live' | 'archived'; entry: RegistryEntry }
  // The index slot or its entry couldn't be read or decoded. Shown, never dropped.
  | { index: number; subject: string | null; state: 'unreadable' };

export type RegistryRead =
  | {
      ok: true;
      count: number;
      // Summed over the entries that could be read. `reportsComplete` is false
      // when some couldn't, and the number is then a lower bound.
      reportsFiled: number;
      reportsComplete: boolean;
      rows: Row[]; // newest first
      calls: number;
    }
  | { ok: false };

interface RawEntry {
  key?: unknown;
  xdr?: unknown;
  liveUntilLedgerSeq?: unknown;
}

interface Batch {
  byKey: Map<string, RawEntry>;
  latestLedger: number | null;
}

async function getEntries(
  keys: string[],
  fetchImpl: typeof fetch,
  rpcUrl: string,
): Promise<Batch[]> {
  const batches: Batch[] = [];
  for (let i = 0; i < keys.length; i += KEYS_PER_CALL) {
    const res = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLedgerEntries',
        params: { keys: keys.slice(i, i + KEYS_PER_CALL) },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`RPC ${res.status}`);
    const body = (await res.json()) as {
      error?: unknown;
      result?: { entries?: unknown; latestLedger?: unknown };
    };
    if (body.error || !body.result || !Array.isArray(body.result.entries))
      throw new Error('RPC error body');
    const byKey = new Map<string, RawEntry>();
    for (const e of body.result.entries as RawEntry[])
      if (typeof e?.key === 'string') byKey.set(e.key, e);
    const latest = body.result.latestLedger;
    batches.push({ byKey, latestLedger: typeof latest === 'number' ? latest : null });
  }
  return batches;
}

function merge(batches: Batch[]): Batch {
  const byKey = new Map<string, RawEntry>();
  let latestLedger: number | null = null;
  for (const b of batches) {
    for (const [k, v] of b.byKey) byKey.set(k, v);
    if (b.latestLedger !== null) latestLedger = Math.max(latestLedger ?? 0, b.latestLedger);
  }
  return { byKey, latestLedger };
}

function archived(e: RawEntry, latest: number | null): boolean {
  const until = typeof e.liveUntilLedgerSeq === 'number' ? e.liveUntilLedgerSeq : null;
  return until !== null && (until === 0 || (latest !== null && latest > until));
}

export async function readRegistry(
  opts: { fetchImpl?: typeof fetch; rpcUrl?: string; contractId?: string } = {},
): Promise<RegistryRead> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const rpcUrl = opts.rpcUrl ?? (DEMO_NETWORK.sorobanRpcUrl as string);
  const contractId = opts.contractId ?? TESTNET_REGISTRY_ID;
  let calls = 0;
  try {
    const instanceKey = countLedgerKey(contractId);
    const [instance] = await getEntries([instanceKey], fetchImpl, rpcUrl);
    calls += 1;
    const instanceXdr = instance?.byKey.get(instanceKey)?.xdr;
    if (typeof instanceXdr !== 'string') return { ok: false };
    const count = decodeCount(instanceXdr);

    const indexKeys = Array.from({ length: count }, (_, i) => indexLedgerKey(contractId, i));
    const indexBatches = await getEntries(indexKeys, fetchImpl, rpcUrl);
    calls += indexBatches.length;
    const index = merge(indexBatches);
    const subjects = indexKeys.map((k) => {
      const raw = index.byKey.get(k)?.xdr;
      try {
        return typeof raw === 'string' ? decodeIndex(raw) : null;
      } catch {
        return null;
      }
    });

    const known = subjects.filter((s): s is string => s !== null);
    const entryKeys = known.map((s) => entryLedgerKey(contractId, s));
    const entryBatches = await getEntries(entryKeys, fetchImpl, rpcUrl);
    calls += entryBatches.length;
    const entries = merge(entryBatches);

    const rows: Row[] = subjects.map((subject, i) => {
      if (subject === null) return { index: i, subject: null, state: 'unreadable' };
      const raw = entries.byKey.get(entryLedgerKey(contractId, subject));
      if (!raw || typeof raw.xdr !== 'string') return { index: i, subject, state: 'unreadable' };
      try {
        const entry = decodeEntry(
          xdr.LedgerEntryData.fromXDR(raw.xdr, 'base64').contractData().val(),
        );
        return {
          index: i,
          subject,
          entry,
          state: archived(raw, entries.latestLedger) ? 'archived' : 'live',
        };
      } catch {
        return { index: i, subject, state: 'unreadable' };
      }
    });
    rows.reverse();

    let reportsFiled = 0;
    for (const r of rows) if (r.state !== 'unreadable') reportsFiled += r.entry.reports;
    return {
      ok: true,
      count,
      reportsFiled,
      reportsComplete: rows.every((r) => r.state !== 'unreadable'),
      rows,
      calls,
    };
  } catch {
    // Unreachable, rate-limited or answering garbage: say so. An empty table
    // would read as "nobody has reported anything", which is false.
    return { ok: false };
  }
}
