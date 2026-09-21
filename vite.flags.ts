// Vite `define` helper for build-time feature flags (#81). Turns the flag list +
// env into `{ __FEATURE_X__: 'true'|'false' }` so BOTH vite.config.ts and
// vite.config.mobile.ts inline the same literals — a disabled flag's guarded code
// (`if (__FEATURE_X__) {...}`) then dead-code-eliminates. Single-sourced from
// FLAG_DEFS, so the two configs can't drift.

import { FLAG_DEFS, parseFlag, type FlagKey } from './src/shared/flag-defs';

const keys = Object.keys(FLAG_DEFS) as FlagKey[];

/** The `define` map for a real build, resolving each flag from `env`. */
export function flagDefines(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const def = FLAG_DEFS[key];
    out[def.literal] = JSON.stringify(parseFlag(env[def.envVar], def.default));
  }
  // Vite inlines the whole `import.meta.env` object wherever code reads it as a
  // bare object (flags.ts, Swap.tsx), so a VITE_TELEMETRY_INGEST_URL in the CI
  // env would land in every bundle even with telemetry stripped. Pin it to ''
  // when the flag is off — `define` for an `import.meta.env.*` key overrides
  // the value in that object — so a telemetry-off build carries no endpoint.
  if (out[FLAG_DEFS.telemetry.literal] === 'false') {
    out['import.meta.env.VITE_TELEMETRY_INGEST_URL'] = '""';
  }
  // Same for the Lantern API base the scanner's explainer proxy hangs off
  // (#84): a SCANNER_AI-off build carries no reference to the endpoint.
  if (out[FLAG_DEFS.scannerAi.literal] === 'false') {
    out['import.meta.env.VITE_LANTERN_API_URL'] = '""';
  }
  return out;
}

/** Every flag ON — used by the test runner so all gated paths are exercised. */
export function allFlagDefinesOn(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) out[FLAG_DEFS[key].literal] = 'true';
  return out;
}
