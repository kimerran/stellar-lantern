import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath, URL } from 'node:url';
import { flagDefines } from './vite.flags';

// The D4 public playground (#183): a static SPA at golantern.xyz/demo/. Same
// stack and aliases as vite.config.mobile.ts, but emitted into the homepage's
// Railway static site as `homepage/demo/` and committed there, like /docs.
// `scripts/build-demo.mjs` drives it and, with `--check`, fails on drift.
const repo = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: repo('./src/demo'),
  base: '/demo/',
  envDir: repo('.'),
  // Flags pinned to their FLAG_DEFS defaults, never read from the local env:
  // the output is committed and drift-checked, so it must not depend on the
  // machine that built it (a local VITE_FEATURE_SCANNER_AI=true would otherwise
  // change the bundle). DEMO_AFFORDANCES is off by default and stays off: the
  // playground's seeded examples (#185) are its own.
  define: flagDefines({}),
  plugins: [
    react(),
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
  ],
  // No public/ copy: the wallet's public dir carries extension icons and
  // mini-apps. The self-hosted fonts (#128) are pulled in through the alias
  // below instead, so they ship as hashed assets under /demo/assets/.
  publicDir: false,
  css: { postcss: repo('.') },
  resolve: {
    alias: [
      { find: '@core', replacement: repo('./src/core') },
      { find: '@shared', replacement: repo('./src/shared') },
      { find: '@popup', replacement: repo('./src/popup') },
      // The scanner package (#50). Same alias in every config so the extension,
      // mobile, demo and test builds resolve it identically (no drift).
      { find: '@lantern/scanner', replacement: repo('./packages/lantern-scanner/src/index.ts') },
      // src/styles/fonts.css points at `/fonts/…` (the wallet's public dir).
      { find: /^\/fonts\//, replacement: `${repo('./public/fonts')}/` },
    ],
  },
  build: {
    outDir: repo('./homepage/demo'),
    emptyOutDir: true,
    target: 'esnext',
    // Committed output: no sourcemaps, so the bundle stays small and diffable.
    sourcemap: false,
  },
});
