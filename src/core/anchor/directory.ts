// Curated anchor directory for the Cash in / Cash out surface (#24).
//
// A small, VETTED list — not an open free-for-all. Each entry names an anchor's
// SEP-1 home domain; the actual capabilities (SEP-10/24 endpoints, currencies)
// are discovered live from `https://<homeDomain>/.well-known/stellar.toml` via
// `discoverAnchor` (see toml.ts). The `assets` here are just the codes we expect
// the anchor to support, used to filter/label the picker before discovery runs.

export interface AnchorEntry {
  id: string; // kebab slug, stable key for lookups
  name: string;
  /** SEP-1 home domain, e.g. testanchor.stellar.org — used for stellar.toml discovery. */
  homeDomain: string;
  network: 'testnet' | 'public';
  /** Asset codes the anchor supports, e.g. ['XLM','USDC'] or ['SRT','USDC']. */
  assets: string[];
  /** Curated/verified in the demo directory (shows a badge). */
  verified: boolean;
}

export const ANCHORS: AnchorEntry[] = [
  {
    id: 'sdf-testanchor',
    name: 'SDF Reference Anchor',
    homeDomain: 'testanchor.stellar.org',
    network: 'testnet',
    assets: ['SRT', 'USDC'],
    verified: true,
  },
];

export function findAnchor(id: string): AnchorEntry | undefined {
  return ANCHORS.find((a) => a.id === id);
}

export function anchorsForNetwork(network: AnchorEntry['network']): AnchorEntry[] {
  return ANCHORS.filter((a) => a.network === network);
}

// Light sanity guard for a SEP-1 home domain: a bare host (no scheme, no path),
// at least one dot. Not a full validator — just enough to catch a malformed
// curated entry before we try to build a stellar.toml URL from it.
export function isValidHomeDomain(domain: string): boolean {
  const d = domain.trim();
  if (!d || /\s/.test(d)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(d)) return false; // no scheme
  if (d.includes('/')) return false; // no path
  return d.includes('.');
}
