import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath, URL } from 'node:url';
import manifest from './manifest.config';
import { flagDefines } from './vite.flags';

// stellar-sdk / bip39 / stellar-hd-wallet expect Node globals (Buffer, process).
// node-polyfills supplies them for the browser/service-worker bundle.
export default defineConfig(({ mode }) => ({
  // Build-time feature flags (#81): inline `__FEATURE_*__` so disabled features
  // dead-code-eliminate. Same helper as vite.config.mobile.ts (no drift).
  define: flagDefines(loadEnv(mode, process.cwd(), 'VITE_FEATURE_')),
  plugins: [
    react(),
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@popup': fileURLToPath(new URL('./src/popup', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
  build: {
    target: 'esnext',
    // Sourcemaps in dev only. `vite build` defaults mode to 'production', so a
    // plain `npm run build` / `npm run package` ships NO `.map` files (smaller
    // artifact, no source exposure in the store build). Developers who want maps
    // can run `vite build --mode development`. Keep in sync with
    // vite.config.mobile.ts (no drift).
    sourcemap: mode !== 'production',
  },
}));
