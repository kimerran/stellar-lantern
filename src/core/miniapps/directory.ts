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
  /** Path relative to the extension root, e.g. miniapps/stardust-faucet/index.html */
  path: string;
  /** Curated/verified in the demo directory (shows a badge). */
  verified: boolean;
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
];

export function findMiniApp(id: string): MiniApp | undefined {
  return MINI_APPS.find((a) => a.id === id);
}

// Build the iframe src for a bundled mini-app, passing the wallet address as a
// query param (a URL param, not a live bridge — keeps the demo "visual only").
export function miniAppSrc(app: MiniApp, address?: string): string {
  return address ? `${app.path}?addr=${encodeURIComponent(address)}` : app.path;
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
