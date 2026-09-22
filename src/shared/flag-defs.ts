// Single source of truth for build-time feature flags (#81): each flag's env
// var, its dead-code-elimination `define` literal, and its safe default. Pure —
// NO env reads here — so both the runtime flags (shared/flags.ts) and the Vite
// `define` helper (vite.flags.ts) build from this one list and can't drift.

export interface FlagDef {
  /** `VITE_FEATURE_*` — the build-time source of truth (Vite exposes `VITE_`). */
  envVar: string;
  /** `__FEATURE_*__` — the Vite `define` literal used at guard sites so disabled
   *  branches (and their imports) dead-code-eliminate, not just skip at runtime. */
  literal: string;
  /** Safe default: shipped-core → ON; external / unfinished / demo → OFF. */
  default: boolean;
}

export const FLAG_DEFS = {
  swap: { envVar: 'VITE_FEATURE_SWAP', literal: '__FEATURE_SWAP__', default: true },
  swapAggregator: { envVar: 'VITE_FEATURE_SWAP_AGGREGATOR', literal: '__FEATURE_SWAP_AGGREGATOR__', default: true },
  earnBlend: { envVar: 'VITE_FEATURE_EARN_BLEND', literal: '__FEATURE_EARN_BLEND__', default: true },
  anchors: { envVar: 'VITE_FEATURE_ANCHORS', literal: '__FEATURE_ANCHORS__', default: true },
  biometricUnlock: { envVar: 'VITE_FEATURE_BIOMETRIC_UNLOCK', literal: '__FEATURE_BIOMETRIC_UNLOCK__', default: true },
  geovelocity: { envVar: 'VITE_FEATURE_GEOVELOCITY', literal: '__FEATURE_GEOVELOCITY__', default: false },
  miniapps: { envVar: 'VITE_FEATURE_MINIAPPS', literal: '__FEATURE_MINIAPPS__', default: true },
  demoAffordances: { envVar: 'VITE_FEATURE_DEMO_AFFORDANCES', literal: '__FEATURE_DEMO_AFFORDANCES__', default: false },
  passkey: { envVar: 'VITE_FEATURE_PASSKEY', literal: '__FEATURE_PASSKEY__', default: false },
  // The scanner's hosted-LLM explainer (#59). OFF by default: a build without
  // a model key dead-code-eliminates the whole path, and the verdict never
  // depended on it. Enable for local dev / demos with LANTERN_AI_API_KEY.
  scannerAi: { envVar: 'VITE_FEATURE_SCANNER_AI', literal: '__FEATURE_SCANNER_AI__', default: false },
  // Opt-in usage analytics (#81). OFF by default so a build with the flag
  // off carries no telemetry code and no ingest origin at all.
  telemetry: { envVar: 'VITE_FEATURE_TELEMETRY', literal: '__FEATURE_TELEMETRY__', default: false },
  // ALPHA ONLY (#100): attach the wallet's public address to telemetry so the
  // activity report is per tester. Reverses the "never collect addresses"
  // promise for the builds it is on in — OFF by default, and must be off in
  // any store submission.
  telemetryIdentity: { envVar: 'VITE_FEATURE_TELEMETRY_IDENTITY', literal: '__FEATURE_TELEMETRY_IDENTITY__', default: false },
} as const satisfies Record<string, FlagDef>;

export type FlagKey = keyof typeof FLAG_DEFS;

/**
 * Resolve one flag: unset / empty → the default; `"true"` / `"1"` → ON; anything
 * else → OFF. Pure — the unit-tested core shared by the runtime + build sides.
 */
export function parseFlag(value: string | undefined, defaultOn: boolean): boolean {
  if (value === undefined || value === '') return defaultOn;
  return value === 'true' || value === '1';
}
