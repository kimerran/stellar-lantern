import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath, URL } from 'node:url';
import manifest from './manifest.config';
import { webConnectContentScripts } from './manifest.webconnect';
import { flagDefines } from './vite.flags';

// stellar-sdk / bip39 / stellar-hd-wallet expect Node globals (Buffer, process).
// node-polyfills supplies them for the browser/service-worker bundle.
export default defineConfig(({ mode }) => {
  const flags = flagDefines(loadEnv(mode, process.cwd(), 'VITE_FEATURE_'));
  // Web connect (#248): content scripts only in a build with the flag on.
  // manifest.config.ts is a plain object (defineManifest returns it as is).
  const crxManifest =
    flags.__FEATURE_WEB_CONNECT__ === 'true'
      ? { ...(manifest as object), content_scripts: webConnectContentScripts(mode) }
      : manifest;
  return {
    // Build-time feature flags (#81): inline `__FEATURE_*__` so disabled features
    // dead-code-eliminate. Same helper as vite.config.mobile.ts (no drift).
    define: {
      ...flags,
      // Not the Android build: native-only imports (the QR scanner, #226)
      // dead-code-eliminate. vite.config.mobile.ts sets it true.
      __NATIVE_BUILD__: 'false',
      // Not the web-app build (#237).
      __WEB_BUILD__: 'false',
    },
    plugins: [
      react(),
      nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
      crx({ manifest: crxManifest as typeof manifest }),
    ],
    resolve: {
      alias: {
        '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
        '@popup': fileURLToPath(new URL('./src/popup', import.meta.url)),
        // The scanner package (#50). Same alias in every config so the extension,
        // mobile and test builds resolve it identically (no drift).
        '@lantern/scanner': fileURLToPath(
          new URL('./packages/lantern-scanner/src/index.ts', import.meta.url),
        ),
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
  };
});
