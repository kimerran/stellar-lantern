// Runtime feature flags (#81). Reads the `VITE_FEATURE_*` env at build time and
// exposes them as a frozen typed object — the ergonomic `if (FLAGS.geovelocity)`
// behavior gate. The flag list + safe defaults live in flag-defs.ts (shared with
// the Vite `define` helper so nothing drifts).
//
// Note: FLAGS gates *behavior*. To also strip a disabled feature's imported
// module from the bundle (dead-code elimination), guard the code with the
// matching `__FEATURE_X__` literal (see vite.flags.ts / feature-flags.d.ts) —
// a runtime object lookup like this can't be tree-shaken.

import { FLAG_DEFS, parseFlag, type FlagKey } from './flag-defs';

export { parseFlag };

const env = import.meta.env as Record<string, string | undefined>;
const keys = Object.keys(FLAG_DEFS) as FlagKey[];

export const FLAGS = Object.freeze(
  Object.fromEntries(
    keys.map((k) => [k, parseFlag(env[FLAG_DEFS[k].envVar], FLAG_DEFS[k].default)]),
  ),
) as Readonly<Record<FlagKey, boolean>>;

export type FeatureFlags = typeof FLAGS;
export type FeatureFlag = FlagKey;
