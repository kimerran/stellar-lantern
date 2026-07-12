import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath, URL } from 'node:url';
import { flagDefines } from './vite.flags';

// Plain-web build for Capacitor. Mirrors vite.config.ts but drops the CRX/MV3
// plugin and manifest — the Android shell wraps the bundle from `dist-mobile/`.
// Kept separate from the extension's `dist/` so the two builds never clobber
// each other (e.g. a loaded unpacked extension stays intact across build:mobile).
export default defineConfig(({ mode }) => ({
  // Same feature-flag defines as vite.config.ts, via the shared helper (no drift).
  define: flagDefines(loadEnv(mode, process.cwd(), 'VITE_FEATURE_')),
  plugins: [
    react(),
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
  ],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@popup': fileURLToPath(new URL('./src/popup', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist-mobile',
    target: 'esnext',
    // Sourcemaps in dev only. `vite build` defaults mode to 'production', so a
    // plain `npm run build:mobile` ships NO `.map` files. Developers who want
    // maps can run `vite build --config vite.config.mobile.ts --mode development`.
    // Keep in sync with vite.config.ts (no drift).
    sourcemap: mode !== 'production',
  },
}));
