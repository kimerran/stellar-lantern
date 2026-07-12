// Estimated Blend supply APY per reserve (#92). Read-only + advisory, exactly like
// the supplied-position readout (`positions.ts`): it reuses the same `get_reserve`
// simulation and never builds or signs anything. Fail-soft — any RPC/decode problem
// or a missing rate field yields `null`, so the Earn screen shows "—" rather than a
// wrong number or a blocked flow.
//
// The math mirrors Blend v2's on-chain interest-rate model (blend-contracts-v2,
// `pool/src/pool/interest.rs`):
//   • utilization U = total_liabilities / total_supply
//       total_supply       = b_supply × b_rate   (bTokens → underlying, SCALAR_12)
//       total_liabilities  = d_supply × d_rate   (dTokens → underlying, SCALAR_12)
//     (the SCALAR_12 cancels in the ratio, so U is unitless).
//   • a three-slope "kinked" borrow APR keyed off the reserve's target utilization,
//     scaled by the reserve's interest-rate modifier `ir_mod`.
//   • supply APR = borrow APR × U × (1 − backstopTakeRate)   — suppliers earn the
//     borrow interest, pro-rated by how much of the pool is actually lent out, less
//     the backstop's cut.
//   • APY = (1 + supplyApr/52)^52 − 1 (weekly compounding — the convention Blend's
//     own UI uses).
//
// The rate params (r_base/r_one/r_two/r_three, util, ir_mod, backstop take rate) are
// Blend SCALAR_7 fixed-point (1e7 = 100% / 1.0). This is an ESTIMATE labelled "est.
// APY" in the UI: it reads the reserve's *current* utilization/modifier (a live
// snapshot, not a forward guarantee), and — because reading the pool-level backstop
// take rate is a separate, more fragile view call — it defaults that cut to 0, so
// the figure is a small over-estimate unless a caller passes the real rate. Both are
// why the label is honest about being approximate.

import { readReserves, type ReserveRef, type RpcOpts } from './positions';

// Blend SCALAR_7 fixed-point unit (1e7 = 100% / 1.0) for the rate parameters.
export const SCALAR_7 = 10_000_000;

// The kink above which the steep third slope applies (95% utilization).
const FIXED_95_PERCENT = 0.95;
// Weekly compounding periods per year (matches Blend UI's APR→APY convention).
const COMPOUND_PERIODS = 52;

/**
 * The reserve fields the estimate needs. Rate params are SCALAR_7 integers; the
 * supply/rate fields are the raw i128s from `get_reserve.data`. `backstopTakeRate`
 * is optional (SCALAR_7) — omit it (or 0) to estimate the gross supply rate.
 */
export interface ReserveApyInputs {
  rBase: number; // SCALAR_7
  rOne: number; // SCALAR_7
  rTwo: number; // SCALAR_7
  rThree: number; // SCALAR_7
  targetUtil: number; // SCALAR_7 (reserve's target utilization)
  irMod: bigint | number | string; // SCALAR_7 interest-rate modifier (~1e7)
  bRate: bigint | number | string; // SCALAR_12
  dRate: bigint | number | string; // SCALAR_12
  bSupply: bigint | number | string; // total bTokens
  dSupply: bigint | number | string; // total dTokens
  backstopTakeRate?: number; // SCALAR_7, default 0
}

/**
 * Estimate a reserve's supply APY as a fraction (e.g. `0.0432` = 4.32%). Pure — the
 * unit-tested core of the "% APR" surface. Returns `null` when the inputs can't
 * produce a sane number (e.g. non-finite params) so the caller fails soft to "—".
 * A reserve with zero supply (no lending, no yield) returns `0`.
 */
export function estimateSupplyApy(i: ReserveApyInputs): number | null {
  let bSupply: bigint;
  let dSupply: bigint;
  let bRate: bigint;
  let dRate: bigint;
  try {
    bSupply = BigInt(i.bSupply);
    dSupply = BigInt(i.dSupply);
    bRate = BigInt(i.bRate);
    dRate = BigInt(i.dRate);
  } catch {
    return null;
  }

  const totalSupply = bSupply * bRate;
  if (totalSupply <= 0n) return 0; // nothing supplied → no yield
  const totalLiabilities = dSupply * dRate;

  // Utilization as a fraction (4-dp fixed → float), clamped to [0, 1].
  const util = clamp(Number((totalLiabilities * 1_000_000n) / totalSupply) / 1_000_000, 0, 1);

  const rBase = i.rBase / SCALAR_7;
  const rOne = i.rOne / SCALAR_7;
  const rTwo = i.rTwo / SCALAR_7;
  const rThree = i.rThree / SCALAR_7;
  const target = i.targetUtil / SCALAR_7;
  const irMod = Number(i.irMod) / SCALAR_7;
  const backstopTake = (i.backstopTakeRate ?? 0) / SCALAR_7;

  let borrowApr: number;
  if (util <= target) {
    const s = target > 0 ? util / target : 0;
    borrowApr = (s * rOne + rBase) * irMod;
  } else if (util <= FIXED_95_PERCENT) {
    const s = (util - target) / (FIXED_95_PERCENT - target);
    borrowApr = (s * rTwo + rOne + rBase) * irMod;
  } else {
    const s = (util - FIXED_95_PERCENT) / (1 - FIXED_95_PERCENT);
    borrowApr = s * rThree + irMod * (rTwo + rOne + rBase);
  }

  const supplyApr = borrowApr * util * (1 - backstopTake);
  const apy = (1 + supplyApr / COMPOUND_PERIODS) ** COMPOUND_PERIODS - 1;
  return Number.isFinite(apy) && apy >= 0 ? apy : null;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

// The shape of a `get_reserve` result relevant to the rate math (all other fields
// ignored). i128s decode to bigint, u32s to number via `scValToNative`.
interface RawReserve {
  config?: {
    r_base?: number;
    r_one?: number;
    r_two?: number;
    r_three?: number;
    util?: number;
  };
  data?: {
    b_rate?: bigint | string;
    d_rate?: bigint | string;
    b_supply?: bigint | string;
    d_supply?: bigint | string;
    ir_mod?: bigint | string;
  };
}

/**
 * Compute the estimated supply APY from a decoded `get_reserve` result, or `null`
 * when a required rate field is absent. Pure — separated from the RPC read so it's
 * unit-testable against fixture reserve data.
 */
export function supplyApyFromReserve(
  reserve: RawReserve | null | undefined,
  backstopTakeRate = 0,
): number | null {
  const c = reserve?.config;
  const d = reserve?.data;
  if (!c || !d) return null;
  if (
    c.r_base == null ||
    c.r_one == null ||
    c.r_two == null ||
    c.r_three == null ||
    c.util == null ||
    d.b_rate == null ||
    d.d_rate == null ||
    d.b_supply == null ||
    d.d_supply == null ||
    d.ir_mod == null
  ) {
    return null;
  }
  return estimateSupplyApy({
    rBase: c.r_base,
    rOne: c.r_one,
    rTwo: c.r_two,
    rThree: c.r_three,
    targetUtil: c.util,
    irMod: d.ir_mod,
    bRate: d.b_rate,
    dRate: d.d_rate,
    bSupply: d.b_supply,
    dSupply: d.d_supply,
    backstopTakeRate,
  });
}

/**
 * Assemble the est.-APY-per-code map from an already-decoded `readReserves` result.
 * Pure — the same shared `get_reserve` reads that drive the supplied-position
 * readout feed this too, so a reserve is fetched once per refresh, not twice.
 * Fail-soft — a reserve that can't be read (or lacks rate fields) maps to `null`;
 * if *no* reserve reads at all, returns `null` so the caller drops the readout.
 */
export function reserveApysFromReserves(
  reserves: ReserveRef[],
  decodedReserves: Array<unknown | null>,
): Record<string, number | null> | null {
  const out: Record<string, number | null> = {};
  let anyRead = false;
  reserves.forEach((r, i) => {
    const reserve = decodedReserves[i] as RawReserve | null;
    if (reserve) anyRead = true;
    out[r.code] = supplyApyFromReserve(reserve);
  });
  return anyRead ? out : null;
}

/**
 * Read the estimated supply APY for each of `reserves` in a pool, keyed by asset
 * `code`. Read-only: simulates `get_reserve` per reserve (in parallel, the same
 * call `positions` makes) and runs the pure estimate. Fail-soft — a reserve that
 * can't be read (or lacks rate fields) maps to `null`; if *no* reserve reads at
 * all, returns `null` so the caller can drop the whole readout.
 *
 * Kept for back-compat; callers that also need supplied positions should share a
 * single `readReserves` result across both readouts (see Earn.tsx) so `get_reserve`
 * is fetched once per reserve rather than twice per refresh.
 */
export async function readReserveApys(
  poolId: string,
  reserves: ReserveRef[],
  opts: RpcOpts,
): Promise<Record<string, number | null> | null> {
  const decodedReserves = await readReserves(poolId, reserves, opts);
  return reserveApysFromReserves(reserves, decodedReserves);
}
