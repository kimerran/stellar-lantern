#!/usr/bin/env node
// Builds the Instawards evidence site (#113): docs/site/** (markdown) →
// homepage/docs/** (static HTML + a .md twin per page + llms.txt).
//
//   npm run docs:build            # render
//   npm run docs:build -- --check # render to a temp dir and fail on any
//                                 # difference from homepage/docs (CI)
//
// The homepage is a Railway static site served from homepage/, so /docs is
// just this folder — no service, no framework, no client-side JS. Every page
// is `noindex, nofollow` and nothing on the landing page links here: the
// site is unlisted, not secret. A static host cannot send X-Robots-Tag, so
// the meta tag is the whole mechanism — deliberately NOT a robots.txt
// Disallow, which would stop crawlers fetching the pages and so never
// seeing the noindex (a bare URL linked from elsewhere could still be
// indexed).
//
// The page tree is docs/site/site.json — order and titles come from there,
// never from the filesystem, so a stray file cannot appear in the nav. Every
// internal link is checked against that tree; a dangling one fails the build.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MarkdownIt = require('markdown-it');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'docs', 'site');
const OUT_REAL = join(ROOT, 'homepage', 'docs');
const BASE = '/docs';
const SITE_URL = 'https://lantern.artisam.xyz';

const check = process.argv.includes('--check');
const OUT = check ? join(ROOT, 'dist-report', '.docs-check') : OUT_REAL;

// ── Tree ─────────────────────────────────────────────────────────────────────

const site = JSON.parse(readFileSync(join(SRC, 'site.json'), 'utf8'));

// Flatten groups into pages, keeping the group for the nav.
const pages = [];
for (const entry of site.pages) {
  if (entry.group) {
    for (const p of entry.pages) pages.push({ ...p, group: entry.group });
  } else {
    pages.push({ ...entry, group: null });
  }
}
const byPath = new Map(pages.map((p) => [p.path, p]));

const hrefOf = (p) => (p.path === '' ? `${BASE}/` : `${BASE}/${p.path}/`);
const mdHrefOf = (p) => (p.path === '' ? `${BASE}/index.md` : `${BASE}/${p.path}.md`);

// ── Markdown ─────────────────────────────────────────────────────────────────

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

// External links open in a new tab; every <table> gets a scroll wrapper.
const defaultLink = md.renderer.rules.link_open || ((t, i, o, e, s) => s.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
  const href = tokens[idx].attrGet('href') || '';
  if (/^https?:\/\//.test(href)) {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener');
  }
  return defaultLink(tokens, idx, opts, env, self);
};
md.renderer.rules.table_open = () => '<div class="table"><table>';
md.renderer.rules.table_close = () => '</table></div>';

function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

// ── Shell ────────────────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function nav(current) {
  const items = [];
  let openGroup = null;
  for (const p of pages) {
    if (p.group !== openGroup) {
      if (openGroup !== null) items.push('</ul></li>');
      if (p.group !== null) items.push(`<li class="group"><span>${esc(p.group)}</span><ul>`);
      openGroup = p.group;
    }
    const on = p.path === current.path ? ' class="on"' : '';
    items.push(`<li${on}><a href="${hrefOf(p)}">${esc(p.nav || p.title)}</a></li>`);
  }
  if (openGroup !== null) items.push('</ul></li>');
  return `<nav class="side" aria-label="Pages"><ul>${items.join('')}</ul></nav>`;
}

function shell(page, bodyHtml) {
  const title = page.path === '' ? site.name : `${page.title} — ${site.name}`;
  const depth = page.path === '' ? 0 : page.path.split('/').length;
  const crumbs = [`<a href="${BASE}/">${esc(site.name)}</a>`];
  if (page.group) crumbs.push(`<span>${esc(page.group)}</span>`);
  if (page.path !== '') crumbs.push(`<span>${esc(page.title)}</span>`);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(page.description || site.description)}" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/styles.css" />
    <link rel="stylesheet" href="${BASE}/docs.css" />
  </head>
  <body class="docs">
    <header class="docs-top">
      <div class="docs-top-inner">
        <a class="brand" href="${BASE}/"><img src="/logo.jpg" alt="Lantern logo" /><span>Lantern</span><em>Instawards evidence</em></a>
        <a class="md-link" href="${mdHrefOf(page)}" title="This page as markdown">view as markdown</a>
      </div>
    </header>
    <div class="docs-layout">
      ${nav(page)}
      <main class="docs-main">
        <p class="crumbs">${crumbs.join(' <span class="sep">/</span> ')}</p>
        <article class="prose">
${bodyHtml}
        </article>
        <footer class="docs-foot">
          <p>Unlisted evidence site for the Stellar Development Foundation Instawards programme. Not indexed; no links from the landing page. Machine-readable index: <a href="${BASE}/llms.txt">llms.txt</a>.</p>
        </footer>
      </main>
    </div>
  </body>
</html>
`;
}

// ── Build ────────────────────────────────────────────────────────────────────

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const problems = [];
// Assets the shell hard-codes; the link guard never sees them.
for (const asset of ['/favicon.png', '/styles.css', '/logo.jpg']) {
  if (!existsSync(join(ROOT, 'homepage', asset))) problems.push(`shell: missing homepage asset ${asset}`);
}
const knownTargets = new Set();
for (const p of pages) {
  knownTargets.add(hrefOf(p));
  knownTargets.add(hrefOf(p).replace(/\/$/, ''));
  knownTargets.add(mdHrefOf(p));
}
knownTargets.add(`${BASE}/llms.txt`);
knownTargets.add(`${BASE}/docs.css`);

const rendered = new Map();
for (const p of pages) {
  const file = join(SRC, p.file);
  if (!existsSync(file)) {
    problems.push(`${p.path || '/'}: source file missing: docs/site/${p.file}`);
    continue;
  }
  const { meta, body } = frontMatter(readFileSync(file, 'utf8'));
  const page = { ...p, ...meta };
  const html = md.render(body);

  // Internal links: anything starting with /docs must resolve to a page.
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const href = m[1].split('#')[0];
    if (!href || /^(https?:|mailto:)/.test(href)) continue;
    if (href.startsWith('/docs')) {
      if (!knownTargets.has(href)) problems.push(`${p.path || '/'}: dangling link ${href}`);
    } else if (href.startsWith('/')) {
      // A homepage asset (styles, logo…) — must exist on disk.
      if (!existsSync(join(ROOT, 'homepage', href))) problems.push(`${p.path || '/'}: missing homepage asset ${href}`);
    } else {
      problems.push(`${p.path || '/'}: relative link "${href}" — use an absolute /docs/… path`);
    }
  }
  // Internal issue numbers must not appear on the public site (#113).
  for (const m of body.matchAll(/(^|[^\w/])#(\d{1,4})\b/g)) {
    problems.push(`${p.path || '/'}: internal issue reference "#${m[2]}" — not allowed on the public site`);
  }
  rendered.set(p.path, { page, html, body });
}

if (problems.length) {
  console.error('docs:build failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}

for (const [path, { page, html, body }] of rendered) {
  const dir = path === '' ? OUT : join(OUT, path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), shell(page, html));
  const twin = path === '' ? join(OUT, 'index.md') : join(OUT, `${path}.md`);
  mkdirSync(dirname(twin), { recursive: true });
  // The body carries its own H1; the twin only prepends a provenance line.
  writeFileSync(twin, `> Markdown twin of ${SITE_URL}${hrefOf(page)} — index of every page: ${SITE_URL}${BASE}/llms.txt\n\n${body}`);
}

// llms.txt — the whole tree with .md URLs, for agents.
const lines = [`# ${site.name}`, '', `> ${site.description}`, ''];
let group = null;
for (const p of pages) {
  if (p.group !== group) {
    group = p.group;
    if (group) lines.push('', `## ${group}`, '');
  }
  lines.push(`- [${p.title}](${SITE_URL}${mdHrefOf(p)})`);
}
writeFileSync(join(OUT, 'llms.txt'), lines.join('\n') + '\n');
writeFileSync(join(OUT, 'docs.css'), readFileSync(join(SRC, 'docs.css'), 'utf8'));

// ── --check: byte-compare with the committed output ──────────────────────────

function walk(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

if (check) {
  const a = new Map(walk(OUT).map((f) => [relative(OUT, f), readFileSync(f)]));
  const b = existsSync(OUT_REAL) ? new Map(walk(OUT_REAL).map((f) => [relative(OUT_REAL, f), readFileSync(f)])) : new Map();
  const diffs = [];
  for (const [k, v] of a) if (!b.has(k) || !b.get(k).equals(v)) diffs.push(`changed or missing: homepage/docs/${k}`);
  for (const k of b.keys()) if (!a.has(k)) diffs.push(`stale (not generated): homepage/docs/${k}`);
  rmSync(OUT, { recursive: true, force: true });
  if (diffs.length) {
    console.error('homepage/docs is out of date — run `npm run docs:build` and commit:\n  ' + diffs.join('\n  '));
    process.exit(1);
  }
  console.log(`docs:build --check: ${a.size} files match`);
} else {
  console.log(`docs:build: ${rendered.size} pages → homepage/docs/`);
}
