// Stage 4 — Screen counterparties against the D1 blacklist registry (#57).
//
// The O(1) hot read from docs/blacklist-registry.md, typed: derive the
// `DataKey::Entry(subject)` ledger key client-side, read it with
// `getLedgerEntries` — no source account, no signing, no fee — and decode the
// contract's nine-field `Entry`. scripts/hot-read-blacklist-registry.mjs is
// the same recipe as a CLI; tests/scanner-screen.test.ts pins both to the
// doc's worked example so they cannot drift.
//
// Three outcomes, never two. `flagged` is `status === Active` only; Disputed
// and Revoked entries are readable but do not warn. An archived entry, an
// RPC failure or a timeout is `unknown` — and unknown never collapses to
// clean, because a screening call that reads an asleep entry as safe is the
// one direction this must not fail in.

import { Address, xdr } from '@stellar/stellar-sdk';

export type RegistryStatus = 'Active' | 'Disputed' | 'Revoked';
export type RegistryReason = 'Scam' | 'Phishing' | 'Impersonation' | 'Other' | string;

// The contract's `Entry` struct (contracts/blacklist-registry/src/lib.rs).
export interface RegistryEntry {
  subject: string;
  reporter: string;
  reason: RegistryReason;
  status: RegistryStatus | string;
  evidence: string; // 32 bytes, hex
  reportedAt: number; // unix seconds
  updatedAt: number;
  reports: number;
  index: number;
}

export type ScreenOutcomeFor = 'flagged' | 'not_flagged' | 'unknown';

export interface ScreenAnswer {
  outcome: ScreenOutcomeFor;
  // Present whenever an entry was read, whatever its status — so a Disputed
  // report is visible to the explainer without raising a warning.
  entry?: RegistryEntry;
  // Why it is unknown: 'archived' | 'rpc_error' | 'timeout' | 'malformed' |
  // 'no_registry'. Absent otherwise.
  reason?: string;
  source: string; // 'registry' | 'demo-list' | …
}

export type ScreenLookup = (address: string) => Promise<ScreenAnswer>;

// The deployed testnet registry (README "Testnet smart contracts"). Testnet
// is periodically reset; tests/scanner-screen.test.ts pins this to the
// id docs/blacklist-registry.md publishes.
export const TESTNET_REGISTRY_ID = 'CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F';

// ── Key derivation + decode ──────────────────────────────────────────────────

// LedgerKey for `DataKey::Entry(subject)`: a one-payload enum variant encodes
// as [symbol("Entry"), address], in PERSISTENT storage. Pure arithmetic.
export function entryLedgerKey(contractId: string, subject: string): string {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Entry'), new Address(subject).toScVal()]),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  ).toXDR('base64');
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function unitVariant(v: xdr.ScVal): string {
  // A unit enum variant is a one-element vec [symbol].
  const first = v.switch().name === 'scvVec' ? v.vec()?.[0] : v;
  if (!first || first.switch().name !== 'scvSymbol') throw new Error('not a unit variant');
  return first.sym().toString();
}

function u64(v: xdr.ScVal): number {
  if (v.switch().name !== 'scvU64') throw new Error('not a u64');
  return Number(v.u64().toString());
}
function u32(v: xdr.ScVal): number {
  if (v.switch().name !== 'scvU32') throw new Error('not a u32');
  return v.u32();
}

// Decode the `Entry` ScMap. Throws on any shape that is not the contract's
// current struct — a decoder that guesses at a missing field is how a stale
// shape reads as a valid entry.
export function decodeEntry(val: xdr.ScVal): RegistryEntry {
  if (val.switch().name !== 'scvMap') throw new Error('Entry is not a map');
  const fields = new Map<string, xdr.ScVal>();
  for (const m of val.map() ?? []) fields.set(m.key().sym().toString(), m.val());
  const need = (k: string): xdr.ScVal => {
    const v = fields.get(k);
    if (!v) throw new Error(`Entry missing field ${k}`);
    return v;
  };
  return {
    subject: Address.fromScVal(need('subject')).toString(),
    reporter: Address.fromScVal(need('reporter')).toString(),
    reason: unitVariant(need('reason')),
    status: unitVariant(need('status')),
    evidence: hex(need('evidence').bytes()),
    reportedAt: u64(need('reported_at')),
    updatedAt: u64(need('updated_at')),
    reports: u32(need('reports')),
    index: u32(need('index')),
  };
}

// ── Interpreting a getLedgerEntries body ─────────────────────────────────────

export interface RawLedgerEntriesBody {
  error?: { message?: unknown };
  result?: { entries?: unknown; latestLedger?: unknown };
}

// The answer for `subject` from a raw body. Absent entry = no LIVE entry
// (almost always never-reported; see the doc on eviction). Present entry with
// liveUntilLedgerSeq behind latestLedger, or zero, = archived = unknown.
export function interpretLedgerEntries(body: RawLedgerEntriesBody, keyXdr: string): ScreenAnswer {
  if (!body || typeof body !== 'object') {
    return { outcome: 'unknown', reason: 'malformed', source: 'registry' };
  }
  if (body.error) return { outcome: 'unknown', reason: 'rpc_error', source: 'registry' };
  const result = body.result;
  if (!result || typeof result !== 'object' || !Array.isArray(result.entries)) {
    return { outcome: 'unknown', reason: 'malformed', source: 'registry' };
  }
  const latest =
    typeof result.latestLedger === 'number' && Number.isFinite(result.latestLedger)
      ? result.latestLedger
      : null;
  const found = (
    result.entries as Array<{ key?: unknown; xdr?: unknown; liveUntilLedgerSeq?: unknown }>
  ).find((e) => e && e.key === keyXdr);
  if (!found) return { outcome: 'not_flagged', source: 'registry' };
  let entry: RegistryEntry;
  try {
    if (typeof found.xdr !== 'string') throw new Error('no xdr');
    const data = xdr.LedgerEntryData.fromXDR(found.xdr, 'base64');
    entry = decodeEntry(data.contractData().val());
  } catch {
    return { outcome: 'unknown', reason: 'malformed', source: 'registry' };
  }
  const liveUntil = typeof found.liveUntilLedgerSeq === 'number' ? found.liveUntilLedgerSeq : null;
  const archived =
    liveUntil !== null && (liveUntil === 0 || (latest !== null && latest > liveUntil));
  if (archived) return { outcome: 'unknown', reason: 'archived', entry, source: 'registry' };
  return {
    outcome: entry.status === 'Active' ? 'flagged' : 'not_flagged',
    entry,
    source: 'registry',
  };
}

// ── The live screener: RPC + timeout + TTL cache ─────────────────────────────

export interface RegistryScreenerOptions {
  rpcUrl: string;
  contractId?: string; // default TESTNET_REGISTRY_ID
  fetchImpl?: typeof fetch;
  timeoutMs?: number; // default 4 s — one read on the critical path
  ttlMs?: number; // default 60 s
  now?: () => number; // injectable clock for the cache
}

export const DEFAULT_SCREEN_TIMEOUT_MS = 4_000;
export const DEFAULT_SCREEN_TTL_MS = 60_000;

// One lookup per address per TTL. Unknown answers are NOT cached: the next
// scan should retry a flaky RPC rather than inherit its failure.
export function createRegistryScreener(opts: RegistryScreenerOptions): ScreenLookup {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const contractId = opts.contractId ?? TESTNET_REGISTRY_ID;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SCREEN_TIMEOUT_MS;
  const ttlMs = opts.ttlMs ?? DEFAULT_SCREEN_TTL_MS;
  const now = opts.now ?? (() => Date.now());
  const cache = new Map<string, { answer: ScreenAnswer; expires: number }>();
  const inflight = new Map<string, Promise<ScreenAnswer>>();

  async function read(address: string): Promise<ScreenAnswer> {
    let keyXdr: string;
    try {
      keyXdr = entryLedgerKey(contractId, address);
    } catch {
      return { outcome: 'unknown', reason: 'malformed', source: 'registry' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(opts.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getLedgerEntries',
          params: { keys: [keyXdr] },
        }),
        signal: controller.signal,
      });
      if (!res.ok) return { outcome: 'unknown', reason: 'rpc_error', source: 'registry' };
      let body: RawLedgerEntriesBody;
      try {
        body = (await res.json()) as RawLedgerEntriesBody;
      } catch {
        return { outcome: 'unknown', reason: 'malformed', source: 'registry' };
      }
      return interpretLedgerEntries(body, keyXdr);
    } catch {
      return {
        outcome: 'unknown',
        reason: controller.signal.aborted ? 'timeout' : 'rpc_error',
        source: 'registry',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return async (address) => {
    const hit = cache.get(address);
    if (hit && hit.expires > now()) return hit.answer;
    let pending = inflight.get(address);
    if (!pending) {
      pending = read(address).finally(() => inflight.delete(address));
      inflight.set(address, pending);
    }
    const answer = await pending;
    if (answer.outcome !== 'unknown') cache.set(address, { answer, expires: now() + ttlMs });
    return answer;
  };
}
