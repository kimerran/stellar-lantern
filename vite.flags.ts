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
  return out;
}

/** Every flag ON — used by the test runner so all gated paths are exercised. */
export function allFlagDefinesOn(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) out[FLAG_DEFS[key].literal] = 'true';
  return out;
}
