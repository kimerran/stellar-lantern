// Read a user's supplied Blend positions (#21, acceptance criterion 2 — "see it
// reflected as a yield-bearing position"). Read-only: it simulates the pool's
// `get_positions` + `get_reserve` view functions against a Soroban RPC and never
// builds or signs anything. Fail-soft — any RPC/decoding problem yields `null` so
// the Earn screen simply omits the readout rather than blocking.
//
// Blend stores a user's supply as **bTokens** (interest-bearing shares) keyed by
// the reserve's numeric index, not by asset address. To show the underlying asset
// amount we resolve each reserve's index + decimals + current `b_rate` from
// `get_reserve`, then convert: underlying = bTokens × b_rate / SCALAR_12. The
// shapes here were validated live against soroban-testnet.

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

// Blend v2 fixed-point rates (b_rate / d_rate) are scaled by 1e12.
export const SCALAR_12 = 10n ** 12n;

/**
 * Convert a bToken balance to the underlying asset amount (both in base units),
 * using the reserve's `b_rate`. Floor division, matching the contract's
 * `fixed_mul_floor`. Pure — the one bit of yield math worth unit-testing.
 */
export function bTokensToUnderlying(bTokens: string | bigint, bRate: string | bigint): string {
  const bt = BigInt(bTokens);
  const rate = BigInt(bRate);
  if (bt <= 0n || rate <= 0n) return '0';
  return ((bt * rate) / SCALAR_12).toString();
}

export interface SuppliedPosition {
  code: string;
  /** Underlying asset amount currently supplied, in base units (i128 string). */
  suppliedBase: string;
  decimals: number;
}

export interface ReserveRef {
  code: string;
  assetId: string;
}

export interface RpcOpts {
  rpcUrl: string;
  fetchImpl?: typeof fetch;
}

// A throwaway source account for read-only simulation (sequence is irrelevant).
const SIM_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

// Simulate a single read-only view call and return the decoded native return
// value, or null on any RPC error / contract error / undecodable body. Exported so
// the sibling APY reader (`apr.ts`) reuses the exact same read-only simulate path.
export async function simulateView(
  poolId: string,
  fn: string,
  arg: xdr.ScVal,
  opts: RpcOpts,
): Promise<unknown | null> {
  const tx = new TransactionBuilder(new Account(SIM_SOURCE, '0'), {
    fee: BASE_FEE,
    networkPassphrase: 'Test SDF Network ; September 2015',
  })
    .addOperation(new Contract(poolId).call(fn, arg))
    .setTimeout(60)
    .build()
    .toXDR();

  const fetchImpl = opts.fetchImpl ?? fetch;
  let body: { result?: { error?: unknown; results?: Array<{ xdr?: unknown }> } };
  try {
    const res = await fetchImpl(opts.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'simulateTransaction',
        params: { transaction: tx },
      }),
    });
    if (!res.ok) return null;
    body = (await res.json()) as typeof body;
  } catch {
    return null;
  }

  const result = body?.result;
  if (!result || result.error) return null;
  const retXdr = result.results?.[0]?.xdr;
  if (typeof retXdr !== 'string') return null;
  try {
    return scValToNative(xdr.ScVal.fromXDR(retXdr, 'base64'));
  } catch {
    return null;
  }
}

// The `supply` map of a Positions struct: reserve index → bToken balance.
function supplyMap(positions: unknown): Record<number, bigint> {
  const supply = (positions as { supply?: unknown } | null)?.supply;
  if (!supply || typeof supply !== 'object') return {};
  return supply as Record<number, bigint>;
}

/**
 * Read the user's supplied balance for each of `reserves` in a pool. Returns one
 * entry per reserve (0 when nothing is supplied), or `null` if positions can't be
 * read at all. Each reserve's index + decimals + `b_rate` come from `get_reserve`;
 * the supplied bTokens come from `get_positions`, converted to the underlying.
 */
export async function readSuppliedPositions(
  poolId: string,
  user: string,
  reserves: ReserveRef[],
  opts: RpcOpts,
): Promise<SuppliedPosition[] | null> {
  const positions = await simulateView(poolId, 'get_positions', new Address(user).toScVal(), opts);
  if (positions == null) return null;
  const supply = supplyMap(positions);

  const out: SuppliedPosition[] = [];
  for (const r of reserves) {
    const reserve = (await simulateView(
      poolId,
      'get_reserve',
      new Address(r.assetId).toScVal(),
      opts,
    )) as { config?: { index?: number; decimals?: number }; data?: { b_rate?: bigint | string } } | null;

    const index = reserve?.config?.index;
    const decimals = reserve?.config?.decimals ?? 7;
    const bRate = reserve?.data?.b_rate;
    if (index == null || bRate == null) {
      // Reserve unreadable — report a zero position rather than dropping the row.
      out.push({ code: r.code, suppliedBase: '0', decimals });
      continue;
    }
    const bTokens = supply[index] ?? 0n;
    out.push({ code: r.code, suppliedBase: bTokensToUnderlying(bTokens, bRate), decimals });
  }
  return out;
}
