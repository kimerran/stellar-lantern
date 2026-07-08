import { defineConfig } from 'vitest/config';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath, URL } from 'node:url';
import { allFlagDefinesOn } from './vite.flags';

// Separate from vite.config.ts so the CRX/MV3 plugin never runs under tests.
export default defineConfig({
  // Feature-flag literals (#81): all ON under test so every gated code path is
  // exercised (the build defaults decide what actually ships).
  define: allFlagDefinesOn(),
  plugins: [nodePolyfills({ globals: { Buffer: true, global: true, process: true } })],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@popup': fileURLToPath(new URL('./src/popup', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
