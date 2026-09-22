// @lantern/scanner reads this build-time literal (the wallet's Vite define).
// The proxy defines it false (vitest.config.ts / the esbuild build): the demo
// deny-list has no business in a backend.
declare const __FEATURE_DEMO_AFFORDANCES__: boolean;

// Vite's `?raw` import (used by the download-route privacy test to assert the
// files that write rows never read the request's address).
declare module '*?raw' {
  const src: string;
  export default src;
}
