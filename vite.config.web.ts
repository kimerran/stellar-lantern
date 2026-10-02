import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { flagDefines } from './vite.flags';

// The installable web app (#237): the wallet in a plain browser, for iPhone
// users and anyone without the extension or the APK. Same stack and aliases as
// vite.config.mobile.ts. The wallet runs in the page (`__WEB_BUILD__`) on
// IndexedDB. Emitted into webapp/ and committed, like homepage/demo/;
// scripts/build-web.mjs drives it and, with `--check`, fails on drift.
const repo = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const PUBLIC = repo('./public');
const STATIC = repo('./src/web/static');

function walk(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    })
    .sort();
}
const urlPath = (root: string, file: string) => '/' + relative(root, file).split(sep).join('/');

// Emits the web-only static files (manifest, icons) and the service worker.
// The worker's precache list is every built file plus the copied public/ dir,
// and its cache name is a hash of their contents, so any change installs a new
// worker and drops the old cache. Deterministic: the committed output doesn't
// depend on when or where it was built.
function webShell(): Plugin {
  return {
    name: 'lantern-web-shell',
    apply: 'build',
    // After Vite's own plugins, so the emitted index.html is in the bundle
    // and gets precached: it's the offline shell.
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const file of walk(STATIC)) {
        this.emitFile({
          type: 'asset',
          fileName: relative(STATIC, file).split(sep).join('/'),
          source: readFileSync(file),
        });
      }
      const entries = new Map<string, Buffer | string>();
      for (const [name, out] of Object.entries(bundle)) {
        entries.set('/' + name, out.type === 'chunk' ? out.code : out.source);
      }
      for (const file of walk(PUBLIC)) entries.set(urlPath(PUBLIC, file), readFileSync(file));

      const paths = [...entries.keys()].filter((p) => !p.endsWith('.map')).sort();
      const hash = createHash('sha256');
      for (const p of paths) hash.update(p).update('\0').update(entries.get(p)!).update('\0');
      const sw = readFileSync(repo('./src/web/sw.template.js'), 'utf8')
        .replace('__CACHE_NAME__', `lantern-shell-${hash.digest('hex').slice(0, 16)}`)
        .replace('__PRECACHE__', JSON.stringify(['/', ...paths], null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
    },
  };
}

export default defineConfig({
  root: repo('./src/web'),
  base: '/',
  envDir: repo('.'),
  // Flags pinned to their FLAG_DEFS defaults, never read from the local env,
  // as in the playground: the output is committed and drift-checked.
  define: {
    ...flagDefines({}),
    // Not Android: no ML Kit QR plugin, no Capacitor plugins.
    __NATIVE_BUILD__: 'false',
    __WEB_BUILD__: 'true',
  },
  plugins: [
    react(),
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
    webShell(),
  ],
  // The wallet's public/ dir: the self-hosted fonts, icons and bundled mini-apps.
  publicDir: PUBLIC,
  css: { postcss: repo('.') },
  resolve: {
    alias: {
      '@core': repo('./src/core'),
      '@shared': repo('./src/shared'),
      '@popup': repo('./src/popup'),
      // The scanner package (#50). Same alias in every config so the extension,
      // mobile, demo, web and test builds resolve it identically (no drift).
      '@lantern/scanner': repo('./packages/lantern-scanner/src/index.ts'),
    },
  },
  build: {
    outDir: repo('./webapp'),
    emptyOutDir: true,
    target: 'esnext',
    // Committed output: no sourcemaps, so the bundle stays small and diffable.
    sourcemap: false,
  },
});
