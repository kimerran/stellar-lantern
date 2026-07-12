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
 * Read a user's `get_positions` and return the reserve-index → bToken supply map,
 * or `null` if positions can't be read at all (so the caller drops the readout).
 * The supply map alone is cheap to share between the position + APY read paths.
 */
export async function readSupplyMap(
  poolId: string,
  user: string,
  opts: RpcOpts,
): Promise<Record<number, bigint> | null> {
  const positions = await simulateView(poolId, 'get_positions', new Address(user).toScVal(), opts);
  if (positions == null) return null;
  return supplyMap(positions);
}

/**
 * Fetch each reserve's `get_reserve` view ONCE, in parallel, returning the decoded
 * results aligned to `reserves` order (each entry `null` on any RPC/decode error).
 * This is the single shared read that both the supplied-position and the est.-APY
 * readouts consume — fetch a reserve here once, then feed it to both pure helpers
 * (`suppliedPositionFromReserve` here, `supplyApyFromReserve` in `apr.ts`) instead
 * of hitting `get_reserve` twice per refresh.
 */
export async function readReserves(
  poolId: string,
  reserves: ReserveRef[],
  opts: RpcOpts,
): Promise<Array<unknown | null>> {
  return Promise.all(
    reserves.map((r) =>
      simulateView(poolId, 'get_reserve', new Address(r.assetId).toScVal(), opts),
    ),
  );
}

// The `get_reserve` fields the supplied-position conversion needs.
type PositionReserve =
  | { config?: { index?: number; decimals?: number }; data?: { b_rate?: bigint | string } }
  | null
  | undefined;

/**
 * Compute one supplied position from an already-decoded `get_reserve` result and
 * the user's supply map. Pure — separated from the RPC read so the same decoded
 * reserve can drive both this and the APY estimate. Fail-soft: an unreadable
 * reserve (missing index / `b_rate`) yields a zero position rather than dropping
 * the row, exactly as before.
 */
export function suppliedPositionFromReserve(
  ref: ReserveRef,
  reserve: unknown,
  supply: Record<number, bigint>,
): SuppliedPosition {
  const rv = reserve as PositionReserve;
  const index = rv?.config?.index;
  const decimals = rv?.config?.decimals ?? 7;
  const bRate = rv?.data?.b_rate;
  if (index == null || bRate == null) {
    return { code: ref.code, suppliedBase: '0', decimals };
  }
  const bTokens = supply[index] ?? 0n;
  return { code: ref.code, suppliedBase: bTokensToUnderlying(bTokens, bRate), decimals };
}

/**
 * Assemble the per-reserve supplied positions from a shared `readReserves` result
 * plus the user's supply map. Pure. Returns `null` when the supply map is `null`
 * (positions unreadable), so the caller omits the readout entirely.
 */
export function suppliedPositionsFromReserves(
  reserves: ReserveRef[],
  decodedReserves: Array<unknown | null>,
  supply: Record<number, bigint> | null,
): SuppliedPosition[] | null {
  if (supply == null) return null;
  return reserves.map((r, i) => suppliedPositionFromReserve(r, decodedReserves[i], supply));
}

/**
 * Read the user's supplied balance for each of `reserves` in a pool. Returns one
 * entry per reserve (0 when nothing is supplied), or `null` if positions can't be
 * read at all. Each reserve's index + decimals + `b_rate` come from `get_reserve`;
 * the supplied bTokens come from `get_positions`, converted to the underlying.
 *
 * The `get_positions` read and the per-reserve `get_reserve` reads run in parallel.
 * Kept for back-compat; callers that also need APYs should instead share a single
 * `readReserves` result across both readouts (see `readReserves` / Earn.tsx) so
 * `get_reserve` is fetched once per reserve rather than twice per refresh.
 */
export async function readSuppliedPositions(
  poolId: string,
  user: string,
  reserves: ReserveRef[],
  opts: RpcOpts,
): Promise<SuppliedPosition[] | null> {
  const [supply, decodedReserves] = await Promise.all([
    readSupplyMap(poolId, user, opts),
    readReserves(poolId, reserves, opts),
  ]);
  return suppliedPositionsFromReserves(reserves, decodedReserves, supply);
}
