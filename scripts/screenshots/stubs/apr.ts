// Stub for @core/blend/apr — returns fixture APYs keyed by the pool's slug.
import type { ReserveRef } from '@core/blend/positions';
import { BLEND_POOLS } from '@core/blend/directory';
import { APYS_BY_SLUG } from '../fixtures';

export async function readReserveApys(
  poolId: string,
  reserves: ReserveRef[],
): Promise<Record<string, number | null> | null> {
  const pool = BLEND_POOLS.find((p) => p.poolId === poolId);
  const rates = (pool && APYS_BY_SLUG[pool.id]) || {};
  const out: Record<string, number | null> = {};
  for (const r of reserves) out[r.code] = rates[r.code] ?? null;
  return out;
}
