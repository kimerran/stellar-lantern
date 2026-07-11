// Build-time feature-flag literals (#81). Vite `define` (see vite.flags.ts)
// replaces each with a boolean at build time, so `if (__FEATURE_X__) { … }`
// dead-code-eliminates when the flag is off. Declared here so guarded code
// typechecks. Keep in sync with FLAG_DEFS in src/shared/flag-defs.ts.
declare const __FEATURE_SWAP__: boolean;
declare const __FEATURE_SWAP_AGGREGATOR__: boolean;
declare const __FEATURE_EARN_BLEND__: boolean;
declare const __FEATURE_ANCHORS__: boolean;
declare const __FEATURE_BIOMETRIC_UNLOCK__: boolean;
declare const __FEATURE_GEOVELOCITY__: boolean;
declare const __FEATURE_MINIAPPS__: boolean;
declare const __FEATURE_DEMO_AFFORDANCES__: boolean;
declare const __FEATURE_PASSKEY__: boolean;
