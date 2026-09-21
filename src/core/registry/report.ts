// One-click report to the on-chain blacklist registry (#120, Deliverable 3
// slice 2). The wallet has read the registry since #84 (D2 screening); this
// is its first write path — the "offers a one-click report that writes the
// counterparty to the on-chain registry" of SOW §4.1 D3, and the only thing a
// pilot user can do that moves §6.3's two registry targets.
//
// Framework-free and offline-testable like the rest of src/core/: every
// network call goes through an injectable `fetch`. Nothing here signs — the
// ready-to-sign XDR goes to the session worker via SIGN_AND_SUBMIT, so keys
// never leave the device (SOW: "advise / gate only").
//
// Contract surface (docs/blacklist-registry.md; deployed, not changed here):
//   report(reporter, subject, reason: Reason, evidence: BytesN<32>) -> u32
// `Reason` is a unit-variant #[contracttype] enum and therefore encodes as
// `scvVec([scvSymbol("Scam")])`, not a symbol and not a u32 — the `enum` arm
// of `argToScVal` exists for exactly this. A wrong encoding does not fail
// here; it fails at simulation with an opaque host error.

import { Address, xdr } from '@stellar/stellar-sdk';
import { sha256 } from '@noble/hashes/sha256';
import type { NetworkConfig } from '@shared/constants';
import { isValidContractId, isValidPublicKey } from '@core/wallet/wallet';
import { prepareInvoke } from '@core/stellar/invoke';
import { getLedgerEntries } from '@core/stellar/soroban';
import {
  contractInstanceKey,
  createRpcTokenResolver,
  entryLedgerKey,
  interpretLedgerEntries,
  TESTNET_REGISTRY_ID,
  type RawLedgerEntriesBody,
  type ScreenAnswer,
} from '@lantern/scanner';

// The contract's closed `Reason` set, in declaration order (contracts/
// blacklist-registry/src/lib.rs). Never free text: the UI picks from this.
export const REGISTRY_REASONS = ['Scam', 'Phishing', 'Drainer', 'Poisoning', 'Mixer', 'Other'] as const;
export type RegistryReason = (typeof REGISTRY_REASONS)[number];

export function isRegistryReason(v: unknown): v is RegistryReason {
  return typeof v === 'string' && (REGISTRY_REASONS as readonly string[]).includes(v);
}

// The ScVal for a `Reason` variant — pinned by a fixture test so the encoding
// cannot drift into a symbol or an integer.
export function reasonToScVal(reason: RegistryReason): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(reason)]);
}

// 32 zero bytes: the contract's "no evidence" value.
export const ZERO_EVIDENCE = '0'.repeat(64);
const HEX32_RE = /^[0-9a-f]{64}$/i;

// A commitment to an off-chain note (§3.9 "minimal on-chain data + off-chain
// evidence hash"). The note itself never leaves the device and is never
// persisted — only this hash goes on chain, and nothing stores the preimage,
// so it is a commitment for later, not a retrievable record.
export function evidenceHash(note: string): string {
  const bytes = sha256(new TextEncoder().encode(note));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Where the registry lives per network. Testnet only: `PUBLIC` has no
// `sorobanRpcUrl` and no deployed registry, so the action must not exist there
// — hidden, not disabled (#120 §5).
export function registryFor(network: NetworkConfig): { contractId: string; rpcUrl: string } | null {
  if (network.id !== 'TESTNET' || !network.sorobanRpcUrl) return null;
  return { contractId: TESTNET_REGISTRY_ID, rpcUrl: network.sorobanRpcUrl };
}

export type ReportGuard =
  | { ok: true }
  | { ok: false; code: 'self_report' | 'invalid_subject' | 'invalid_reporter' | 'no_registry'; error: string };

// Client-side guards, run before any transaction is built so no fee is spent
// to learn `SelfReport` (error 2) from the contract.
export function checkReport(params: {
  reporter: string;
  subject: string;
  network: NetworkConfig;
}): ReportGuard {
  const reporter = params.reporter.trim();
  const subject = params.subject.trim();
  if (!registryFor(params.network)) {
    return { ok: false, code: 'no_registry', error: 'The registry is only available on Testnet.' };
  }
  if (!isValidPublicKey(reporter)) {
    return { ok: false, code: 'invalid_reporter', error: 'Your wallet address is not a valid Stellar account.' };
  }
  if (!isValidPublicKey(subject) && !isValidContractId(subject)) {
    return { ok: false, code: 'invalid_subject', error: 'That is not a valid Stellar address.' };
  }
  if (reporter === subject) {
    return { ok: false, code: 'self_report', error: 'You cannot report your own address.' };
  }
  return { ok: true };
}

export interface BuildReportParams {
  reporter: string; // the session's public key
  subject: string; // the counterparty being reported (G… or C…)
  reason: RegistryReason;
  evidence?: string; // 32-byte hex; defaults to all-zero
  contractId?: string; // default: the testnet registry
  network: NetworkConfig;
  // The reporter's current sequence number. Fetched from Horizon when absent.
  sourceSequence?: string;
  fetchImpl?: typeof fetch;
}

export type BuildReportResult = { ok: true; xdr: string } | { ok: false; error: string };

// Horizon `/accounts/{id}` → the sequence the invoke is built against.
async function fetchSequence(
  network: NetworkConfig,
  account: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const res = await fetchImpl(`${network.horizonUrl.replace(/\/$/, '')}/accounts/${account}`);
  if (res.status === 404) throw new Error('Your account is not funded on this network.');
  if (!res.ok) throw new Error(`Could not load your account (${res.status}).`);
  const body = (await res.json()) as { sequence?: unknown };
  if (typeof body.sequence !== 'string' || !/^\d+$/.test(body.sequence)) {
    throw new Error('Could not read your account sequence.');
  }
  return body.sequence;
}

/**
 * Build the ready-to-sign `report()` invoke: guards → build → simulate →
 * assemble against `network.sorobanRpcUrl`. Never throws; every failure is
 * `{ ok: false, error }` so the sheet has one thing to surface.
 */
export async function buildReportTx(params: BuildReportParams): Promise<BuildReportResult> {
  const guard = checkReport(params);
  if (!guard.ok) return { ok: false, error: guard.error };
  const registry = registryFor(params.network)!;
  const evidence = (params.evidence ?? ZERO_EVIDENCE).toLowerCase();
  if (!HEX32_RE.test(evidence)) return { ok: false, error: 'Evidence must be a 32-byte hex hash.' };
  if (!isRegistryReason(params.reason)) return { ok: false, error: 'Pick a reason from the list.' };
  const fetchImpl = params.fetchImpl ?? fetch;

  let sourceSequence = params.sourceSequence;
  if (sourceSequence === undefined) {
    try {
      sourceSequence = await fetchSequence(params.network, params.reporter.trim(), fetchImpl);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Could not load your account.' };
    }
  }

  return prepareInvoke({
    sourceAccount: params.reporter.trim(),
    sourceSequence,
    contractId: params.contractId ?? registry.contractId,
    functionName: 'report',
    args: [
      { type: 'address', value: params.reporter.trim() },
      { type: 'address', value: params.subject.trim() },
      { type: 'enum', value: params.reason },
      { type: 'bytes', value: evidence },
    ],
    networkPassphrase: params.network.passphrase,
    rpcUrl: registry.rpcUrl,
    fetchImpl,
  });
}

// ── Fee: read and display before anyone signs ────────────────────────────────

export interface RegistryConfig {
  admin: string;
  treasury: string;
  feeToken: string;
  fee: string; // i128 in the token's base units, as a decimal string
}

// `DataKey::Config` lives in the contract's INSTANCE storage, so it is one
// fee-free `getLedgerEntries` of the instance key — no source account, no
// simulation. Same recipe as the scanner's token-metadata read.
export function configFromInstance(entryXdr: string): RegistryConfig | null {
  try {
    const data = xdr.LedgerEntryData.fromXDR(entryXdr, 'base64');
    const storage = data.contractData().val().instance().storage() ?? [];
    for (const item of storage) {
      const key = item.key();
      if (key.switch().name !== 'scvVec') continue;
      const head = key.vec()?.[0];
      if (!head || head.switch().name !== 'scvSymbol' || head.sym().toString() !== 'Config') continue;
      const val = item.val();
      if (val.switch().name !== 'scvMap') return null;
      const fields = new Map<string, xdr.ScVal>();
      for (const m of val.map() ?? []) fields.set(m.key().sym().toString(), m.val());
      const need = (k: string): xdr.ScVal => {
        const v = fields.get(k);
        if (!v) throw new Error(`Config missing ${k}`);
        return v;
      };
      const fee = need('fee');
      if (fee.switch().name !== 'scvI128') return null;
      const parts = fee.i128();
      const feeValue = (BigInt(parts.hi().toString()) << 64n) + BigInt(parts.lo().toString());
      return {
        admin: Address.fromScVal(need('admin')).toString(),
        treasury: Address.fromScVal(need('treasury')).toString(),
        feeToken: Address.fromScVal(need('fee_token')).toString(),
        fee: feeValue.toString(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export interface ReadFeeOptions {
  network: NetworkConfig;
  contractId?: string;
  fetchImpl?: typeof fetch;
}

export interface ReportFee {
  fee: string; // base units
  feeToken: string;
  treasury: string;
  // The token's symbol + decimals, when its instance metadata could be read.
  // Absent means "fee is N base units of <contract>" is all we can say.
  code?: string;
  decimals?: number;
}

export type ReadFeeResult = { ok: true; fee: ReportFee } | { ok: false; error: string };

/**
 * `config()` without a transaction: read `fee` + `fee_token` from the
 * registry's instance entry and resolve the token's symbol/decimals. The UI
 * shows the result BEFORE asking anyone to sign; when this fails it must say
 * the fee is unknown — never assume zero (zero is legal, so a wrong zero is
 * plausible and therefore dangerous).
 */
export async function readReportFee(opts: ReadFeeOptions): Promise<ReadFeeResult> {
  const registry = registryFor(opts.network);
  if (!registry) return { ok: false, error: 'The registry is only available on Testnet.' };
  const contractId = opts.contractId ?? registry.contractId;
  const fetchImpl = opts.fetchImpl ?? fetch;
  let config: RegistryConfig | null = null;
  try {
    const res = await getLedgerEntries([contractInstanceKey(contractId)], {
      rpcUrl: registry.rpcUrl,
      fetchImpl,
    });
    if (res.ok) {
      const hit = res.entries.find((e) => e.keyXdr === contractInstanceKey(contractId));
      if (hit) config = configFromInstance(hit.xdr);
    }
  } catch {
    config = null;
  }
  if (!config) return { ok: false, error: 'Could not read the registry fee.' };

  const meta = await createRpcTokenResolver({ rpcUrl: registry.rpcUrl, fetchImpl })(config.feeToken);
  return {
    ok: true,
    fee: {
      fee: config.fee,
      feeToken: config.feeToken,
      treasury: config.treasury,
      ...(meta ? { code: meta.code, decimals: meta.decimals } : {}),
    },
  };
}

// "10000000" @ 7 → "1"; "12345000" @ 7 → "1.2345". Exact bigint arithmetic.
export function formatUnits(raw: string, decimals: number): string {
  const n = BigInt(raw);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

// The line the confirmation sheet shows. Falls back to base units + a
// truncated contract id when the token could not be resolved.
export function describeFee(fee: ReportFee): string {
  if (fee.code !== undefined && fee.decimals !== undefined) {
    return `${formatUnits(fee.fee, fee.decimals)} ${fee.code}`;
  }
  return `${fee.fee} base units of ${fee.feeToken.slice(0, 4)}…${fee.feeToken.slice(-4)}`;
}

// ── After the transaction: the subject's new count ───────────────────────────

/**
 * The registry's answer for `subject` right now — the same hot read the
 * scanner's screener does, uncached, so the sheet can show the report count
 * the transaction produced. Horizon returns from `submitTransaction` only
 * once the ledger closed, so this read sees the write.
 */
export async function readSubject(opts: {
  network: NetworkConfig;
  subject: string;
  contractId?: string;
  fetchImpl?: typeof fetch;
}): Promise<ScreenAnswer> {
  const registry = registryFor(opts.network);
  if (!registry) return { outcome: 'unknown', reason: 'no_registry', source: 'registry' };
  const contractId = opts.contractId ?? registry.contractId;
  const fetchImpl = opts.fetchImpl ?? fetch;
  let keyXdr: string;
  try {
    keyXdr = entryLedgerKey(contractId, opts.subject.trim());
  } catch {
    return { outcome: 'unknown', reason: 'malformed', source: 'registry' };
  }
  try {
    const res = await fetchImpl(registry.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLedgerEntries',
        params: { keys: [keyXdr] },
      }),
    });
    if (!res.ok) return { outcome: 'unknown', reason: 'rpc_error', source: 'registry' };
    return interpretLedgerEntries((await res.json()) as RawLedgerEntriesBody, keyXdr);
  } catch {
    return { outcome: 'unknown', reason: 'rpc_error', source: 'registry' };
  }
}
