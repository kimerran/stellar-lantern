import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Standalone Vite build for the docs/ui screenshot harness. It renders the real
// popup screen components against the app's compiled Tailwind CSS + fonts, with
// the data-layer modules aliased to fixture stubs (the app can't reach Horizon /
// Soroban RPC in a plain browser). See ./README.md.
export default defineConfig({
  root: r('.'),
  base: './',
  plugins: [react(), nodePolyfills({ globals: { Buffer: true, global: true, process: true } })],
  resolve: {
    alias: [
      // Stubs must precede the general @core alias (first match wins).
      { find: '@core/stellar/client', replacement: r('./stubs/client.ts') },
      { find: '@core/history/history', replacement: r('./stubs/history.ts') },
      { find: '@core/blend/apr', replacement: r('./stubs/apr.ts') },
      { find: '@core/blend/positions', replacement: r('./stubs/positions.ts') },
      { find: '@core', replacement: r('../../src/core') },
      { find: '@shared', replacement: r('../../src/shared') },
      { find: '@popup', replacement: r('../../src/popup') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  build: { outDir: r('./dist'), emptyOutDir: true, chunkSizeWarningLimit: 3000 },
});
