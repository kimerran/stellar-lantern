// Stage 3b — SEP-41 / Stellar Asset Contract token-interface calls (#55).
//
// Recognises the five value-moving token functions — transfer, approve,
// burn, mint, clawback — by function name AND argument shape, at every depth
// of the flattened auth tree, and turns them into AssetDeltas / Approvals.
// Anything that does not match the exact signature is left alone for 3c: a
// `transfer` with the wrong arity is not "probably a transfer".
//
// Amounts are i128 and stay bigint-exact end to end; scaling by the token's
// decimals happens only when rendering, and only when the decimals are
// known — an unresolvable token yields the raw integer plus an explicit
// "decimals unknown" marker, never a guessed 7.

import { Address, Asset, xdr } from '@stellar/stellar-sdk';
import type { Approval, AssetDelta, AssetRef, AuthCall } from './types';
import type { DecodedScVal } from './scval';

// ── Metadata ─────────────────────────────────────────────────────────────────

export interface TokenMetadata {
  code: string; // symbol ("USDC"; "XLM" for the native SAC)
  name?: string;
  decimals: number;
  issuer?: string; // classic issuer for a SAC; absent for native / non-SAC
}

// Answers null when the token cannot be resolved (unknown contract, RPC
// down, not a SAC / no METADATA in instance storage). Never throws — a
// resolver failure must degrade to "decimals unknown", not abort the scan.
export type TokenMetadataResolver = (contractId: string) => Promise<TokenMetadata | null>;

// Per-contract-id cache around a resolver; in-flight lookups are shared.
export function createTokenMetadataCache(resolver: TokenMetadataResolver): TokenMetadataResolver {
  const cache = new Map<string, Promise<TokenMetadata | null>>();
  return (contractId) => {
    let hit = cache.get(contractId);
    if (!hit) {
      hit = resolver(contractId).catch(() => null);
      cache.set(contractId, hit);
    }
    return hit;
  };
}

// Raw getLedgerEntries body, as the RPC returns it (or as recorded).
export interface RawLedgerEntries {
  error?: { message?: unknown };
  result?: { entries?: unknown };
}

// The ledger key for a contract's instance entry, where a SAC keeps its
// METADATA {decimal, name, symbol} and AssetInfo.
export function contractInstanceKey(contractId: string): string {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  ).toXDR('base64');
}

// Parse METADATA / AssetInfo out of a base64 LedgerEntryData for a contract
// instance. Returns null when the instance has no readable METADATA — i.e.
// the contract is not a SAC and does not follow the SAC's storage layout.
export function metadataFromInstance(entryXdr: string): TokenMetadata | null {
  try {
    const data = xdr.LedgerEntryData.fromXDR(entryXdr, 'base64');
    const storage = data.contractData().val().instance().storage() ?? [];
    let decimals: number | undefined;
    let symbol: string | undefined;
    let name: string | undefined;
    let native = false;
    let issuer: string | undefined;
    for (const entry of storage) {
      const key = entry.key();
      if (key.switch().name === 'scvSymbol' && key.sym().toString() === 'METADATA') {
        for (const m of entry.val().map() ?? []) {
          const k = m.key().sym().toString();
          const v = m.val();
          if (k === 'decimal') decimals = v.u32();
          else if (k === 'symbol') symbol = v.str().toString();
          else if (k === 'name') name = v.str().toString();
        }
      } else if (key.switch().name === 'scvVec') {
        // AssetInfo is keyed by the enum vec ["AssetInfo"]; its value is
        // ["Native"] or ["AlphaNum4"|"AlphaNum12", { asset_code, issuer }].
        const tag = key.vec()?.[0];
        if (tag?.switch().name === 'scvSymbol' && tag.sym().toString() === 'AssetInfo') {
          const val = entry.val().vec() ?? [];
          const kind = val[0]?.sym().toString();
          if (kind === 'Native') native = true;
          else if (val[1]) {
            for (const m of val[1].map() ?? []) {
              if (m.key().sym().toString() === 'issuer') {
                issuer = Address.account(m.val().bytes()).toString();
              }
            }
          }
        }
      }
    }
    if (decimals === undefined || symbol === undefined) return null;
    return {
      code: native ? 'XLM' : symbol,
      ...(name !== undefined ? { name } : {}),
      decimals,
      ...(issuer ? { issuer } : {}),
    };
  } catch {
    return null;
  }
}

export interface RpcTokenResolverOptions {
  rpcUrl: string;
  fetchImpl?: typeof fetch;
}

// A resolver over Soroban RPC getLedgerEntries: one fee-free read of the
// contract instance, no source account, no signature. Wrap it in
// createTokenMetadataCache.
export function createRpcTokenResolver(opts: RpcTokenResolverOptions): TokenMetadataResolver {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async (contractId) => {
    try {
      const res = await fetchImpl(opts.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getLedgerEntries',
          params: { keys: [contractInstanceKey(contractId)] },
        }),
      });
      if (!res.ok) return null;
      return metadataFromLedgerEntries((await res.json()) as RawLedgerEntries, contractId);
    } catch {
      return null;
    }
  };
}

// Pull the entry for `contractId` out of a getLedgerEntries body.
export function metadataFromLedgerEntries(
  body: RawLedgerEntries,
  contractId: string,
): TokenMetadata | null {
  if (!body || typeof body !== 'object' || body.error) return null;
  const entries = body.result?.entries;
  if (!Array.isArray(entries)) return null;
  const want = contractInstanceKey(contractId);
  for (const e of entries) {
    const entry = e as { key?: unknown; xdr?: unknown };
    if (entry.key === want && typeof entry.xdr === 'string') return metadataFromInstance(entry.xdr);
  }
  return null;
}

// ── Recognition ──────────────────────────────────────────────────────────────

export type TokenFunction = 'transfer' | 'approve' | 'burn' | 'mint' | 'clawback';

export interface TokenCall {
  fn: TokenFunction;
  contractId: string;
  call: AuthCall;
  from?: string;
  to?: string;
  spender?: string;
  amount: bigint;
  expirationLedger?: number;
}

const SHAPES: Record<TokenFunction, DecodedScVal['type'][]> = {
  transfer: ['address', 'address', 'i128'],
  approve: ['address', 'address', 'i128', 'u32'],
  burn: ['address', 'i128'],
  mint: ['address', 'i128'],
  clawback: ['address', 'i128'],
};

function isTokenFunction(name: string | undefined): name is TokenFunction {
  return name !== undefined && Object.prototype.hasOwnProperty.call(SHAPES, name);
}

// Exact name + exact argument shape, or nothing. `transfer_from`,
// `transferAll` and a 2-arg `transfer` are all "not the token interface".
export function recogniseTokenCall(call: AuthCall): TokenCall | null {
  if (call.kind !== 'contract' || !call.contractId) return null;
  if (!isTokenFunction(call.functionName)) return null;
  const shape = SHAPES[call.functionName];
  if (call.args.length !== shape.length) return null;
  if (!call.args.every((a, i) => a.type === shape[i])) return null;
  const str = (i: number): string => {
    const a = call.args[i]!;
    return 'value' in a && typeof a.value === 'string' ? a.value : '';
  };
  const big = (i: number): bigint => BigInt(str(i));
  const base = { fn: call.functionName, contractId: call.contractId, call };
  switch (call.functionName) {
    case 'transfer':
      return { ...base, from: str(0), to: str(1), amount: big(2) };
    case 'approve':
      return {
        ...base,
        from: str(0),
        spender: str(1),
        amount: big(2),
        expirationLedger: Number(str(3)),
      };
    case 'burn':
      return { ...base, from: str(0), amount: big(1) };
    case 'mint':
      return { ...base, to: str(0), amount: big(1) };
    case 'clawback':
      return { ...base, from: str(0), amount: big(1) };
  }
}

// ── Effects ──────────────────────────────────────────────────────────────────

// An allowance at or above this is treated as unlimited: 2^100 base units is
// more than any token's supply at any sane decimals (1e30 at 18 decimals is
// a trillion trillion). i128::MAX is the usual "unlimited" literal; this
// catches the "effectively unlimited" variants too.
export const UNLIMITED_ALLOWANCE_THRESHOLD = 2n ** 100n;
// ≈ one year of ledgers at 5 s. An allowance living longer than this is
// long-lived; combined with unlimited it is the scam the scanner exists for.
export const LONG_LIVED_ALLOWANCE_LEDGERS = 6_307_200;

export interface TokenEffects {
  deltas: AssetDelta[];
  approvals: Approval[];
  // Effect rows for the coarse list: which opIndex each recognised call
  // belongs to is the root op (single-op Soroban tx → 0).
  recognised: TokenCall[];
}

export function assetForToken(
  contractId: string,
  meta: TokenMetadata | null,
  networkPassphrase: string,
): AssetRef {
  const native = contractId === Asset.native().contractId(networkPassphrase);
  if (native) return { code: 'XLM', contractId, decimals: 7 };
  if (!meta) return { code: contractId.slice(0, 4) + '…', contractId, decimals: null };
  return {
    code: meta.code,
    contractId,
    decimals: meta.decimals,
    ...(meta.issuer ? { issuer: meta.issuer } : {}),
  };
}

// Scale a raw integer by `decimals` into an exact decimal string; null when
// the decimals are unknown (the caller carries `raw` alongside).
export function scaleAmount(raw: bigint, decimals: number | null): string | null {
  if (decimals === null) return null;
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  if (decimals === 0) return `${neg ? '-' : ''}${abs}`;
  const unit = 10n ** BigInt(decimals);
  const whole = abs / unit;
  const frac = (abs % unit).toString().padStart(decimals, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

export function tokenEffects(
  calls: AuthCall[],
  metadata: Map<string, TokenMetadata | null>,
  networkPassphrase: string,
  opIndex: number,
): TokenEffects {
  const deltas: AssetDelta[] = [];
  const approvals: Approval[] = [];
  const recognised: TokenCall[] = [];
  for (const call of calls) {
    const t = recogniseTokenCall(call);
    if (!t) continue;
    recognised.push(t);
    const asset = assetForToken(
      t.contractId,
      metadata.get(t.contractId) ?? null,
      networkPassphrase,
    );
    const raw = t.amount.toString();
    const amount = scaleAmount(t.amount, asset.decimals ?? null);
    const mk = (address: string, direction: 'in' | 'out'): AssetDelta => ({
      address,
      direction,
      asset,
      amount,
      raw,
      bound: 'exact',
      opIndex,
      depth: call.depth,
      source: 'token',
    });
    switch (t.fn) {
      case 'transfer':
        deltas.push(mk(t.from!, 'out'), mk(t.to!, 'in'));
        break;
      case 'burn':
      case 'clawback':
        deltas.push(mk(t.from!, 'out'));
        break;
      case 'mint':
        deltas.push(mk(t.to!, 'in'));
        break;
      case 'approve':
        approvals.push({
          owner: t.from!,
          spender: t.spender!,
          asset,
          amount: raw,
          amountScaled: amount,
          expirationLedger: t.expirationLedger!,
          unlimited: t.amount >= UNLIMITED_ALLOWANCE_THRESHOLD,
          opIndex,
          depth: call.depth,
        });
        break;
    }
  }
  return { deltas, approvals, recognised };
}
