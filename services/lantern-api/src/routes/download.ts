// /download/<target> (#131): short, stable links to the current builds, and
// the top of the funnel we could not see.
//
//   GET /download/android    → 302 → lantern-<version>-testnet.apk
//   GET /download/extension  → 302 → lantern-extension-<version>.zip
//   ?v=<version>  pins a release; default is the newest
//   ?src=<slug>   attribution (guide, twitter, chapter, …), shown in /admin
//   GET /download/checksums → the release's SHA256SUMS.txt, as text (#153)
//
// 302-and-log, never proxy-stream: GitHub's CDN serves the bytes, Railway
// pays no egress, and the asset's own name means the APK still lands as an
// .apk. The honest consequence: a row here is a DOWNLOAD INTENT (a click),
// not a completed download — the dashboard labels it that way, and must.
//
// Privacy: this is a server log, not app telemetry (see downloads/store.ts).
// The row carries the target, the version it was sent to, the src slug, the
// edge's coarse country if any, and a three-bucket user-agent family. The
// request's IP is never read here and the user-agent string is never stored.
//
// Private repo (#153): the 302 goes to a signed, short-lived GitHub storage
// URL instead, and when no build can be resolved the answer is a small 503
// page rather than the releases page, which visitors cannot open.

import { Hono } from 'hono';
import type { ReleaseResolver } from '../downloads/releases';
import {
  countryOf,
  srcOf,
  uaFamilyOf,
  type DownloadStore,
  type DownloadTarget,
} from '../downloads/store';

export interface DownloadDeps {
  resolver: ReleaseResolver;
  store: DownloadStore | null; // null = redirect only (no DATABASE_URL)
  now?: () => Date;
  log: (line: Record<string, string | number>) => void;
}

// Static on purpose: nothing from the request or the resolver is echoed.
const UNAVAILABLE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Lantern download</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1326;color:#dae2fd;font:16px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}main{max-width:28rem}h1{font-size:1.25rem;margin:0 0 .5rem}a{color:#ffc15c}</style>
</head><body><main><h1>Downloads are temporarily unavailable</h1>
<p>We couldn't reach the build right now. Please try again in a minute.</p>
<p>Still stuck? <a href="mailto:hello@artisam.xyz">hello@artisam.xyz</a></p></main></body></html>`;

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const TARGETS: DownloadTarget[] = ['android', 'extension'];

export function downloadRoutes(deps: DownloadDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date());

  // Registered before /download/:target, which would otherwise take it.
  app.get('/download/checksums', async (c) => {
    const vq = c.req.query('v');
    const version = vq && VERSION_RE.test(vq) ? vq : undefined;
    const sums = await deps.resolver.checksums(version);
    c.header('Cache-Control', 'no-store');
    if (!sums) {
      deps.log({ route: 'download', status: 503, target: 'checksums' });
      return c.text('Checksums are temporarily unavailable. Try again in a minute.\n', 503);
    }
    deps.log({ route: 'download', status: 200, target: 'checksums', version: sums.version });
    c.header('Content-Disposition', 'inline; filename="SHA256SUMS.txt"');
    c.header('X-Lantern-Release', sums.tag);
    return c.text(sums.text, 200);
  });

  app.get('/download/:target', async (c) => {
    const started = Date.now();
    const target = c.req.param('target') as DownloadTarget;
    if (!TARGETS.includes(target)) return c.json({ error: 'not_found' }, 404);
    const vq = c.req.query('v');
    const version = vq && VERSION_RE.test(vq) ? vq : undefined;
    const src = srcOf(c.req.query('src'));

    const resolved = await deps.resolver.resolve(target, version);

    // One row per click. The 302 sends the browser to GitHub, not back here,
    // so following the redirect cannot count twice. A HEAD (link previews,
    // uptime probes) is answered but is not a click.
    if (deps.store && c.req.method === 'GET') {
      try {
        await deps.store.insertDownload({
          target,
          version: resolved.version,
          src,
          country: countryOf((h) => c.req.header(h)),
          uaFamily: uaFamilyOf(c.req.header('user-agent')),
          ts: now(),
        });
      } catch {
        // A logging failure must never cost someone the download.
        deps.log({ route: 'download', status: 302, code: 'store_error', target });
      }
    }
    const unavailable = resolved.source === 'unavailable';
    deps.log({
      route: 'download',
      status: unavailable ? 503 : 302,
      target,
      version: resolved.version,
      src: src || '-',
      source: resolved.source,
      ms: Date.now() - started,
    });
    c.header('Cache-Control', 'no-store');
    if (unavailable) {
      c.header('Retry-After', '60');
      return c.html(UNAVAILABLE_PAGE, 503);
    }
    return c.redirect(resolved.url, 302);
  });

  return app;
}
