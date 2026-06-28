import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath, URL } from 'node:url';

// Mobile build: a plain SPA (no MV3 manifest, no crx service worker) consumed by
// Capacitor and packaged into the Android app. The extension build stays in
// vite.config.ts. Output → dist-mobile (Capacitor `webDir`).
export default defineConfig({
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
    target: 'esnext',
    outDir: 'dist-mobile',
    emptyOutDir: true,
    sourcemap: false, // smaller APK (issue #4 — size)
    rollupOptions: {
      input: fileURLToPath(new URL('./index.mobile.html', import.meta.url)),
      output: {
        // Split the heavy Stellar SDK into its own chunk for cacheable, leaner loads.
        manualChunks: {
          stellar: ['@stellar/stellar-sdk'],
        },
      },
    },
  },
});
