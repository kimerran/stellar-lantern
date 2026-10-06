// Curated mini-app directory + URL helpers for the in-app browser (Apps tab).
//
// MOCK / demo surface: bundled mini-apps are self-contained static pages under
// public/miniapps/<id>/. There is no real wallet bridge yet — the host passes
// the wallet address in as a URL param so the sample apps can look "connected".
// Swapping in the real connection broker (spec — README "Mini-app browser")
// doesn't touch this module's shape.

import type { NetworkId } from '@shared/constants';
import { isLanternOrigin } from '@shared/origin';

export type MiniAppCategory = 'DeFi' | 'Payments' | 'NFTs' | 'Tools' | 'Earn';

export interface MiniApp {
  id: string;
  name: string;
  tagline: string;
  category: MiniAppCategory;
  icon: string; // Material Symbols name
  /**
   * Bundled apps: path relative to the extension root, e.g.
   * miniapps/stardust-faucet/index.html. Exactly one of `path` / `url` is set.
   */
  path?: string;
  /**
   * Remote apps: an absolute https URL. Launched in the opaque-origin sandboxed
   * frame (same as the URL bar) and reached through the postMessage bridge —
   * connect + scan-gated sign — never as a first-party page. Must pass the same
   * `https` scheme check the URL bar enforces (see normalizeUrl).
   */
  url?: string;
  /** Curated/verified in the demo directory (shows a badge). */
  verified: boolean;
  /** Marks a showcase/demo entry (shows a "Demo" chip). */
  demo?: boolean;
  /**
   * Remote apps only (#260): frame it with `allow-same-origin`, so it runs at
   * its real origin and can keep a login (a partitioned cookie) and call its
   * own API. It still reaches the wallet only through the bridge. Set it only
   * for a curated app that needs a session; the URL bar never gets it, and
   * Lantern's own origin never does (see remoteFrameSandbox in frame.ts).
   * `url`'s origin, or one listed in `origins`, must be where the app ends up:
   * replies are posted only to an origin in appOrigins(app).
   */
  session?: boolean;
  /**
   * Remote apps only (#279): extra https origins that count as the same app,
   * e.g. the apex while `url` is on a `beta.` host serving the same build. They
   * join `url`'s origin everywhere an app's origin matters: "Open in Lantern"
   * links and the Android asset statements (deep-link.ts), and the bridge's
   * `event.origin` check and reply target (frame.ts). Origins only: no path,
   * no credentials, no wildcards. See appOrigins.
   */
  origins?: readonly string[];
  /**
   * The Stellar networks the app runs on. Omitted = any network (it follows
   * whatever network the wallet shares). When set and Lantern's active network
   * isn't in it, the row stays listed but shows a chip naming where the app
   * does run (see networkChip) — e.g. a testnet-only dApp on mainnet.
   */
  networks?: readonly NetworkId[];
}

export const MINI_APPS: MiniApp[] = [
  {
    id: 'stardust-faucet',
    name: 'Stardust Faucet',
    tagline: 'Claim testnet XLM and watch the safety check in action.',
    category: 'Tools',
    icon: 'water_drop',
    path: 'miniapps/stardust-faucet/index.html',
    verified: true,
  },
  {
    id: 'lumen-notes',
    name: 'Lumen Notes',
    tagline: 'A tiny on-chain-style notepad. Demo stub.',
    category: 'Tools',
    icon: 'sticky_note_2',
    path: 'miniapps/lumen-notes/index.html',
    verified: false,
  },
  // Remote Lantern demo dApp (#93). NOT gated behind DEMO_AFFORDANCES: that flag
  // hides things that would be unsafe/misleading in production (faked scan
  // verdicts, a hardcoded flagged-address deny-list) — a real sandboxed https
  // app is neither, and it exists precisely to be shown in public demo builds
  // where demoAffordances is off. It launches like any remote URL (opaque-origin
  // sandbox + the connect/scan-gated bridge), so "favoriting" grants it nothing.
  {
    id: 'lantern-demo',
    name: 'Lantern Demo App',
    tagline: 'Live demo dApp — connect and try a scan-gated send.',
    category: 'Tools',
    icon: 'rocket_launch',
    url: 'https://lanternmock.up.railway.app/',
    verified: false,
    demo: true,
  },
  // Centient (epic #258): earn USDC by ranking AI answers. Remote, with a
  // session so its login survives (#260). Testnet-only for now, so on mainnet
  // it shows a "Testnet" chip rather than disappearing. `verified` flips to
  // true once the device QA in slice 8 (#266) passes.
  {
    id: 'centient',
    name: 'Centient',
    tagline: 'Earn USDC by ranking AI answers.',
    category: 'Earn',
    icon: 'payments',
    // beta.centient.work is where contributors go for the testnet launch (#279);
    // the apex serves the same build and stays listed, so links to either
    // work and moving back needs no release.
    url: 'https://beta.centient.work/',
    origins: ['https://centient.work'],
    verified: false,
    session: true,
    networks: ['TESTNET'],
  },
];

const NETWORK_LABEL: Record<NetworkId, string> = { TESTNET: 'Testnet', PUBLIC: 'Mainnet' };

/**
 * The network chip a directory row shows, or null for none. An app that runs
 * on the active network (or didn't say — `networks` omitted) gets no chip; one
 * that doesn't shows where it does run, e.g. "Testnet" for a testnet-only app
 * while Lantern is on mainnet. Listing it with a chip beats hiding it.
 */
export function networkChip(app: MiniApp, active: NetworkId): string | null {
  if (!app.networks || app.networks.length === 0 || app.networks.includes(active)) return null;
  return app.networks.map((n) => NETWORK_LABEL[n]).join(' / ');
}

/** `value`'s origin if it's a plain https origin or URL (no credentials), else null. */
function httpsOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return url.origin;
}

/**
 * Every web origin a remote directory app counts as (#279): `url`'s origin,
 * then each of `origins`, deduplicated, in that order. Only https origins
 * without credentials, and never Lantern's own (isLanternOrigin, compared
 * against Lantern's fixed origins: `self` defaults to 'null' so the answer
 * doesn't depend on where it runs; the Android asset statements are generated
 * from it in Node). Bundled apps have none, and so does an app whose own `url`
 * doesn't qualify (its extras too). An `origins` entry with a path is reduced
 * to its origin; anything unparseable is dropped.
 */
export function appOrigins(app: MiniApp, self = 'null'): string[] {
  if (!app.url) return [];
  const primary = httpsOrigin(app.url);
  // An app whose own url doesn't qualify gets nothing, extras included.
  if (!primary || isLanternOrigin(primary, self)) return [];
  const out = [primary];
  for (const value of app.origins ?? []) {
    if (typeof value !== 'string') continue;
    const origin = httpsOrigin(value);
    if (!origin || isLanternOrigin(origin, self) || out.includes(origin)) continue;
    out.push(origin);
  }
  return out;
}

export function findMiniApp(id: string): MiniApp | undefined {
  return MINI_APPS.find((a) => a.id === id);
}

// A remote mini-app loads from an absolute URL (sandboxed frame) rather than a
// bundled first-party page.
export function isRemoteMiniApp(app: MiniApp): boolean {
  return typeof app.url === 'string' && app.url.length > 0;
}

// Build the iframe src for a bundled mini-app, passing the wallet address as a
// query param (a URL param, not a live bridge — keeps the demo "visual only").
// Remote apps use their `url` directly and reach the wallet via the bridge, so
// this returns the raw url for them (no addr param — the bridge provides it).
export function miniAppSrc(app: MiniApp, address?: string): string {
  if (isRemoteMiniApp(app)) return app.url!;
  return address ? `${app.path}?addr=${encodeURIComponent(address)}` : app.path!;
}

// Normalize whatever the user typed into the URL bar into a safe, frameable
// https(s) URL — or null if it isn't a usable web URL. Rejects non-web schemes
// (javascript:, chrome:, file:, …) so the URL bar can't be used to escape the
// browser surface.
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname.includes('.')) return null; // needs a real-ish host

  return url.href;
}

// Short, human display of a URL's origin for the browser chrome bar.
export function displayOrigin(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
