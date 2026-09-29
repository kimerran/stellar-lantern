// /join (#162): the alpha testers' group invite, behind an attributed redirect.
//
//   GET /join?src=<slug>  → 302 → the WhatsApp group invite (ALPHA_JOIN_URL)
//
// A WhatsApp invite link cannot carry ?src=, so the homepage's "Join the
// alpha" button points here instead, and the click is counted on the way
// through — the same signal #131 gives /download, for the step before it.
//
// 302 + Cache-Control: no-store, never 301: a browser caches a 301 and sends
// every later click straight to WhatsApp, where it is never counted.
//
// Privacy and storage: exactly /download's (routes/download.ts). One row in
// the download log with target 'alpha' and an empty version; the src slug,
// the edge's coarse country if any, a three-bucket user-agent family. The
// request's IP is never read here and the user-agent string is never stored.
// A join is NOT a download intent; /admin counts it on its own card.

import { Hono } from 'hono';
import { JOIN_TARGET, countryOf, srcOf, uaFamilyOf, type DownloadStore } from '../downloads/store';

export interface JoinDeps {
  url: string; // the invite, validated at boot (env.ts)
  store: DownloadStore | null; // null = redirect only (no DATABASE_URL)
  now?: () => Date;
  log: (line: Record<string, string | number>) => void;
}

export function joinRoutes(deps: JoinDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date());

  app.get('/join', async (c) => {
    const src = srcOf(c.req.query('src'));
    // One row per click; a HEAD (link previews, uptime probes) is answered
    // but is not a click — same rule as /download.
    if (deps.store && c.req.method === 'GET') {
      try {
        await deps.store.insertDownload({
          target: JOIN_TARGET,
          version: '',
          src,
          country: countryOf((h) => c.req.header(h)),
          uaFamily: uaFamilyOf(c.req.header('user-agent')),
          ts: now(),
        });
      } catch {
        // A logging failure must never cost someone the invite.
        deps.log({ route: 'join', status: 302, code: 'store_error' });
      }
    }
    deps.log({ route: 'join', status: 302, src: src || '-' });
    c.header('Cache-Control', 'no-store');
    return c.redirect(deps.url, 302);
  });

  return app;
}
