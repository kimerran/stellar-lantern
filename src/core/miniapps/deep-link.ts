// "Open in Lantern" deep links (#263, epic #258).
//
// A website in Chrome on Android links to
//   intent://open?url=<encoded https URL>#Intent;scheme=lantern;package=com.lantern.wallet;…;end
// which Android delivers to MainActivity as `lantern://open?url=<encoded URL>`.
// Lantern opens that URL in its Apps tab ONLY when its origin is a directory
// app's origin. Anything else opens nothing: without this rule any website
// could load any page inside the wallet's own screen, which makes phishing easy.
//
// The same rule decides which sites the Android app declares in its
// `asset_statements` resource, which is what lets a site's
// `navigator.getInstalledRelatedApps()` see Lantern. Both come from
// `deepLinkOrigins()`, so the set Chrome is told about and the set the deep link
// accepts can't drift. scripts/gen-asset-statements.mjs writes the resource.
//
// Qualification rule: every directory entry with a remote `url` (an https dApp)
// qualifies. Bundled apps have no web origin, and Lantern's own origins never
// qualify. Adding a remote dApp to MINI_APPS is all it takes; then run
// `npm run android:assets` and commit the regenerated XML.

import { isLanternOrigin } from '@shared/origin';
import { MINI_APPS, type MiniApp } from './directory';

/** Generous cap on a deep-linked URL; real dApp entry URLs are far shorter. */
const MAX_URL_LENGTH = 2048;

/** The https origin a directory app qualifies with, or null if it doesn't. */
function appOrigin(app: MiniApp): string | null {
  if (!app.url) return null;
  let url: URL;
  try {
    url = new URL(app.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  // `'null'` as self: compare against Lantern's fixed origins only.
  if (isLanternOrigin(url.origin, 'null')) return null;
  return url.origin;
}

/**
 * The origins "Open in Lantern" may open, and that the Android app declares in
 * `asset_statements`: each qualifying directory app's https origin, deduplicated,
 * in directory order.
 */
export function deepLinkOrigins(apps: readonly MiniApp[] = MINI_APPS): string[] {
  const out: string[] = [];
  for (const app of apps) {
    const origin = appOrigin(app);
    if (origin && !out.includes(origin)) out.push(origin);
  }
  return out;
}

export type DeepLink =
  /** Open `url` in the Apps tab; its origin is `app`'s. */
  | { kind: 'open'; url: string; app: MiniApp }
  /**
   * A `lantern://open` link Lantern won't follow: a site outside the directory,
   * a non-https or malformed `url`, or none at all. Show the Apps tab with a
   * note and open nothing. `origin` is shown to the user when known.
   */
  | { kind: 'refused'; origin?: string };

/**
 * Parse a URL Android handed the app (`App.getLaunchUrl()` /
 * `appUrlOpen`). Returns null for anything that isn't a `lantern://open` link
 * at all (so the caller ignores it), otherwise what to do with it.
 */
export function parseDeepLink(raw: string, apps: readonly MiniApp[] = MINI_APPS): DeepLink | null {
  if (typeof raw !== 'string') return null;
  let link: URL;
  try {
    link = new URL(raw.trim());
  } catch {
    return null;
  }
  if (link.protocol !== 'lantern:') return null;
  // `lantern` isn't a special scheme, so the host keeps its case.
  if (link.hostname.toLowerCase() !== 'open') return null;
  if (link.pathname !== '' && link.pathname !== '/') return { kind: 'refused' };

  // Exactly one `url`: two would leave which one we checked ambiguous.
  const values = link.searchParams.getAll('url');
  if (values.length !== 1) return { kind: 'refused' };
  const target = values[0];
  if (!target || target.length > MAX_URL_LENGTH) return { kind: 'refused' };

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { kind: 'refused' };
  }
  if (url.protocol !== 'https:') return { kind: 'refused' };
  // Credentials in the URL are a phishing tell (`https://centient.work@evil.com`
  // is evil.com) and no dApp entry link needs them.
  if (url.username || url.password) return { kind: 'refused', origin: url.host };

  const app = apps.find((a) => appOrigin(a) === url.origin);
  if (!app) return { kind: 'refused', origin: url.host };
  return { kind: 'open', url: url.href, app };
}

/** The `asset_statements` JSON for `origins` (Digital Asset Links, web targets). */
export function assetStatements(origins: readonly string[]): string {
  return JSON.stringify(
    origins.map((site) => ({
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'web', site },
    })),
  );
}
