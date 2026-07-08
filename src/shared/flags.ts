// Build-time feature flags (#81). Single source of truth for gating optional /
// external / in-flight surfaces ON or OFF *per build*, so a disabled feature can
// dead-code-eliminate out of the bundle rather than shipping always-on.
//
// Booleans only — never secrets. Each flag reads a `VITE_FEATURE_*` env var
// (Vite exposes `VITE_`-prefixed env at build time) and falls back to a **safe
// default**: shipped-core → ON; anything external, unfinished, or demo-only → OFF.
//
// Read at call sites as `if (FLAGS.geovelocity) { … }`. For flags that must fully
// tree-shake an external SDK/import, pair this with a Vite `define` of a literal
// (a follow-up slice) so the minifier drops the dead branch — a plain env read
// gates *behavior* but a bundler may still include an imported module.

/**
 * Resolve one flag: an unset / empty env var takes the default; otherwise
 * `"true"` / `"1"` are ON and everything else is OFF. Pure — the unit-tested core.
 */
export function parseFlag(value: string | undefined, defaultOn: boolean): boolean {
  if (value === undefined || value === '') return defaultOn;
  return value === 'true' || value === '1';
}

const env = import.meta.env as Record<string, string | undefined>;

export const FLAGS = Object.freeze({
  /** Swap screen + `core/stellar/{swap,paths}` — shipped (#71 native engine). */
  swap: parseFlag(env.VITE_FEATURE_SWAP, true),
  /** Soroswap aggregator engine — external API, not built yet (#71). Reserved. */
  swapAggregator: parseFlag(env.VITE_FEATURE_SWAP_AGGREGATOR, false),
  /** Earn screen + `core/blend` — shipped (#21), pending Testnet demo. */
  earnBlend: parseFlag(env.VITE_FEATURE_EARN_BLEND, true),
  /** Cash in/out + `core/anchor` — shipped (#24), pending Testnet demo. */
  anchors: parseFlag(env.VITE_FEATURE_ANCHORS, true),
  /** Biometric unlock (#23 M2a) — native adapter device-unverified; keep out of store builds. */
  biometricUnlock: parseFlag(env.VITE_FEATURE_BIOMETRIC_UNLOCK, false),
  /** Impossible-travel risk signal (#70) — needs an external Cloudflare Worker. */
  geovelocity: parseFlag(env.VITE_FEATURE_GEOVELOCITY, false),
  /** dApp mini-apps + `core/miniapps` — shipped. */
  miniapps: parseFlag(env.VITE_FEATURE_MINIAPPS, true),
  /** Demo-only affordances (`ScanContext.forceScenario`, demo deny-list) — off in prod. */
  demoAffordances: parseFlag(env.VITE_FEATURE_DEMO_AFFORDANCES, false),
});

export type FeatureFlags = typeof FLAGS;
export type FeatureFlag = keyof FeatureFlags;
