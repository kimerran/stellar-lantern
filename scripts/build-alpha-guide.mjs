// Renders docs/alpha-testing-guide.md to docs/Lantern-Alpha-Tester-Guide.pdf
// (and the intermediate .html next to it) so the PDF testers receive is always
// regenerated from the Markdown, never hand-edited. Needs a Chromium binary for
// the print step; set CHROME=/path/to/chrome if it is not on the usual path.
//   npm run guide:build
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import MarkdownIt from 'markdown-it';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = resolve(ROOT, 'docs/alpha-testing-guide.md');
const HTML = resolve(ROOT, 'docs/Lantern-Alpha-Tester-Guide.html');
const PDF = resolve(ROOT, 'docs/Lantern-Alpha-Tester-Guide.pdf');

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
let src = readFileSync(SRC, 'utf8');

// Hero: the H1, the bold tag line, the italic sub, and the bold meta lines.
const hero = /^# (.+)\n\n\*\*(.+?)\*\*\n\n\*(.+?)\*\n\n([\s\S]+?)\n\n---\n/.exec(src);
if (!hero) throw new Error('guide header did not match the expected shape');
const [, title, tag, sub, metaMd] = hero;
src = src.slice(hero[0].length);
const meta = metaMd.split('\n').map((l) => md.renderInline(l)).join('<br>');

let body = md.render(src);
// Blockquote flavours, keyed on how each one opens in the Markdown.
body = body
  .replace(/<blockquote>\n<p>⚠️/g, '<blockquote class="warn">\n<p>⚠️')
  .replace(/<blockquote>\n<p>📸/g, '<blockquote class="shot">\n<p>📸')
  .replace(/<blockquote>\n<p><strong>(A note|If |Please)/g, '<blockquote class="note">\n<p><strong>$1')
  .replace(/<blockquote>\n<p>/g, '<blockquote class="note">\n<p>');
// Relative links to the assignment table point at the repo copy from the PDF.
body = body.replace(/href="alpha-tester-assignments\.md"/g,
  'href="https://github.com/kimerran/stellar-lantern/blob/develop/docs/alpha-tester-assignments.md"');

const css = `
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }
body { font-family: "DejaVu Sans", "Segoe UI", system-ui, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1a1a1a; margin: 0; }
.hero { background: #0f1729; color: #fff; padding: 22px 28px 18px; border-bottom: 4px solid #f5b400; margin-bottom: 22px; }
.hero .tag { display: inline-block; background: #f5b400; color: #0f1729; font-weight: 700; letter-spacing: .12em; font-size: 8.5pt; padding: 3px 9px; border-radius: 3px; }
.hero h1 { margin: 14px 0 6px; font-size: 24pt; line-height: 1.15; }
.hero .sub { color: #c9d1e0; margin: 0 0 14px; font-size: 11pt; }
.hero .meta { color: #c9d1e0; font-size: 9pt; border-top: 1px solid #2a3550; padding-top: 10px; }
.hero .meta strong { color: #fff; }
h2 { font-size: 15.5pt; margin: 26px 0 8px; padding-bottom: 5px; border-bottom: 2px solid #f5b400; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin: 16px 0 6px; page-break-after: avoid; }
p, li { margin: 4px 0; }
ol, ul { padding-left: 22px; }
code { font-family: "DejaVu Sans Mono", Menlo, monospace; font-size: 9.3pt; background: #f2f3f6; padding: 1px 4px; border-radius: 3px; overflow-wrap: anywhere; }
pre { background: #f6f7fa; border-left: 3px solid #b9c2d6; padding: 10px 12px; font-size: 9.3pt; white-space: pre-wrap; margin: 6px 0 12px; page-break-inside: avoid; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 14px; font-size: 9.5pt; page-break-inside: avoid; }
th, td { border: 1px solid #d8dde8; padding: 5px 8px; text-align: left; vertical-align: top; }
th { background: #f4f6fa; }
blockquote { margin: 12px 0; padding: 10px 14px; border-radius: 6px; page-break-inside: avoid; }
blockquote p { margin: 3px 0; }
blockquote.warn { background: #fff4f2; border: 1.5px solid #e2544a; }
blockquote.note { background: #fff9e8; border-left: 4px solid #f5b400; border-radius: 0 6px 6px 0; }
blockquote.shot { background: #0f1729; color: #fff; border-radius: 6px; }
blockquote.shot strong { color: #f5b400; letter-spacing: .06em; }
blockquote.shot code { background: #223; color: #fff; }
hr { border: 0; border-top: 1px solid #d8dde8; margin: 22px 0; }
a { color: #1a1a1a; }
em { color: #444; }
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>
<div class="hero"><span class="tag">${tag}</span><h1>${title.replace(' — ', '<br>')}</h1><p class="sub">${sub}</p><div class="meta"><p>${meta}</p></div></div>
${body}
</body></html>`;
writeFileSync(HTML, html);

const chrome = process.env.CHROME
  ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
if (!chrome) {
  console.error(`wrote ${HTML}; no Chromium found for the PDF step — set CHROME=`);
  process.exit(1);
}
execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
  `--print-to-pdf=${PDF}`, `file://${HTML}`,
], { stdio: 'pipe' });
console.log(`wrote ${HTML}\nwrote ${PDF}`);
