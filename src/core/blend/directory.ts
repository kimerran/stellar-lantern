// Curated Blend pool directory for the "earn yield" surface (#21).
//
// A small, VETTED list — not an open free-for-all — mirroring the anchor
// directory (#24). Each entry names a Blend lending pool contract and the reserve
// assets you can supply into it. Unlike anchors (discovered from a stellar.toml),
// pools are addressed directly by contract id, so the ids are pinned here.
//
// The testnet entry was validated live against soroban-testnet.stellar.org: the
// pool `get_reserve` simulates OK for each listed asset, and a `submit` supply
// built by `buildBlendSubmitXdr` (core/blend/pool.ts) is accepted and decoded by
// the pool contract (it fails only downstream, on the caller's token balance).
// Testnet deployments are periodically reset, so re-validate before relying on it.

/** One suppliable reserve asset in a pool. */
export interface BlendReserve {
  /** Display code, e.g. 'USDC' / 'XLM'. */
  code: string;
  /** Reserve asset token (SAC) contract address (C…). */
  assetId: string;
  /** Token decimals — Stellar assets (incl. the native XLM SAC) use 7. */
  decimals: number;
}

export interface BlendPool {
  id: string; // kebab slug, stable key for lookups
  name: string;
  network: 'testnet' | 'public';
  /** Blend pool contract address (C…) that `submit` is called on. */
  poolId: string;
  /** Assets a user can supply to earn yield / withdraw. */
  reserves: BlendReserve[];
  /** Curated/verified in the demo directory (shows a badge). */
  verified: boolean;
}

// Blend v2 testnet reserve assets (blend-utils testnet.contracts.json), confirmed
// as reserves of the pool below via a live `get_reserve` simulation.
const TESTNET_USDC = 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU';
const TESTNET_XLM = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

export const BLEND_POOLS: BlendPool[] = [
  {
    id: 'blend-v2-testnet',
    name: 'Blend V2 Testnet Pool',
    network: 'testnet',
    poolId: 'CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF',
    reserves: [
      { code: 'USDC', assetId: TESTNET_USDC, decimals: 7 },
      { code: 'XLM', assetId: TESTNET_XLM, decimals: 7 },
    ],
    verified: true,
  },
];

export function findBlendPool(id: string): BlendPool | undefined {
  return BLEND_POOLS.find((p) => p.id === id);
}

export function blendPoolsForNetwork(network: BlendPool['network']): BlendPool[] {
  return BLEND_POOLS.filter((p) => p.network === network);
}

/** Look up a reserve in a pool by asset code (case-insensitive). */
export function findReserve(pool: BlendPool, code: string): BlendReserve | undefined {
  const c = code.trim().toUpperCase();
  return pool.reserves.find((r) => r.code.toUpperCase() === c);
}
