import { describe, expect, it } from 'vitest';

// The node-polyfills plugin shims `node:fs` in test files, and `?raw` on a .css
// import comes back empty under vitest, so read through the real Node module.
const fs = (globalThis as unknown as { process: { getBuiltinModule(m: 'fs'): typeof import('fs') } }).process.getBuiltinModule('fs');
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const inPublicFonts = (f: string) => fs.existsSync(new URL(`../public/fonts/${f}`, import.meta.url));
const indexHtml = read('index.html');
const fontsCss = read('src/styles/fonts.css');
const tailwindCss = read('src/styles/tailwind.css');

// The wallet ships its own fonts (#128). Loading them from Google Fonts pinged
// Google on every popup open and, offline, rendered every icon as its ligature
// name ("lock_open"). These guard against a remote font creeping back in.

const REMOTE_FONT_HOSTS = /fonts\.(googleapis|gstatic)\.com/;

describe('self-hosted fonts', () => {
  it('index.html loads no remote stylesheet or font', () => {
    expect(indexHtml).not.toMatch(REMOTE_FONT_HOSTS);
    expect(indexHtml).not.toMatch(/<link[^>]+rel="(stylesheet|preconnect)"/);
  });

  it('the stylesheets reference no remote font', () => {
    expect(fontsCss).not.toMatch(REMOTE_FONT_HOSTS);
    expect(tailwindCss).not.toMatch(REMOTE_FONT_HOSTS);
    expect(tailwindCss).toMatch(/@import '\.\/fonts\.css';/);
  });

  it('declares every family the UI renders with', () => {
    for (const family of ['Inter', 'Roboto Mono', 'Material Symbols Outlined']) {
      expect(fontsCss).toContain(`font-family: '${family}';`);
    }
    // The icon class sits beside its @font-face (so the wallet and the /demo
    // playground both get it from this one file) and uses exactly that name.
    expect(fontsCss).toMatch(/\.material-symbols-outlined \{\s*font-family: 'Material Symbols Outlined';/);
  });

  it('every font file it points at is in public/fonts, with its licence', () => {
    const files = [...fontsCss.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map((m) => m[1] ?? '');
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const f of files) expect(inPublicFonts(f), f).toBe(true);
    for (const l of ['LICENSE-Inter.txt', 'LICENSE-RobotoMono.txt', 'LICENSE-MaterialSymbols.txt']) {
      expect(inPublicFonts(l), l).toBe(true);
    }
  });

  it('icons never flash their ligature name while the font loads', () => {
    const icon = fontsCss.slice(fontsCss.indexOf("font-family: 'Material Symbols Outlined'"));
    expect(icon).toMatch(/font-display: block;/);
  });
});
