// Curated mini-app directory + URL helpers for the in-app browser (Apps tab).
//
// MOCK / demo surface: bundled mini-apps are self-contained static pages under
// public/miniapps/<id>/. There is no real wallet bridge yet — the host passes
// the wallet address in as a URL param so the sample apps can look "connected".
// Swapping in the real connection broker (spec — README "Mini-app browser")
// doesn't touch this module's shape.

export type MiniAppCategory = 'DeFi' | 'Payments' | 'NFTs' | 'Tools';

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
];

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
