// Resolves /download/<target> to the current GitHub Release asset (#131).
//
// The builds are published by release.yml (#130) as pre-releases named
// lantern-<version>-testnet.apk and lantern-extension-<version>.zip. GitHub's
// `/releases/latest` — both the API and the `releases/latest/download/…` URL —
// EXCLUDES pre-releases, so this lists releases and takes the newest one that
// carries the asset. Public repo: no token, and it must stay that way.
//
// Cached ~5 min so a tester push does not hit the API per click. On any
// failure the last good answer is served indefinitely (stale beats broken),
// then a pinned fallback URL from the environment, then the releases page —
// a human-usable page is the floor, never a 500.

import type { DownloadTarget } from './store';

export interface ReleaseAsset {
  url: string; // browser_download_url
  version: string; // from the tag: v<version>-testnet.<run>
  tag: string;
}

export interface ReleaseResolverOptions {
  repo: string; // owner/name
  fetchImpl?: typeof fetch;
  ttlMs?: number;
  now?: () => number;
  // Pinned known-good URLs, one per target (DOWNLOAD_FALLBACK_*_URL).
  fallback?: Partial<Record<DownloadTarget, string>>;
  timeoutMs?: number;
}

export interface Resolved {
  url: string;
  version: string;
  source: 'api' | 'cache' | 'stale' | 'fallback' | 'releases-page';
}

export const DEFAULT_RELEASES_TTL_MS = 5 * 60_000;
const TAG_RE = /^v(\d+\.\d+\.\d+)-testnet\.\d+$/;
const ASSET_RE: Record<DownloadTarget, RegExp> = {
  android: /^lantern-\d+\.\d+\.\d+-testnet\.apk$/,
  extension: /^lantern-extension-\d+\.\d+\.\d+\.zip$/,
};

interface ApiRelease {
  tag_name?: unknown;
  draft?: unknown;
  assets?: unknown;
}

// Pure: the newest release (as listed — GitHub orders newest first) carrying
// the target's asset, optionally pinned to a version.
export function pickAsset(
  releases: unknown,
  target: DownloadTarget,
  version?: string,
): ReleaseAsset | null {
  if (!Array.isArray(releases)) return null;
  for (const raw of releases as ApiRelease[]) {
    if (!raw || typeof raw !== 'object' || raw.draft === true) continue;
    const tag = typeof raw.tag_name === 'string' ? raw.tag_name : '';
    const m = TAG_RE.exec(tag);
    if (!m) continue;
    const v = m[1]!;
    if (version && v !== version) continue;
    if (!Array.isArray(raw.assets)) continue;
    for (const a of raw.assets as Array<{ name?: unknown; browser_download_url?: unknown }>) {
      if (
        a &&
        typeof a.name === 'string' &&
        ASSET_RE[target].test(a.name) &&
        typeof a.browser_download_url === 'string' &&
        a.browser_download_url.startsWith('https://')
      ) {
        return { url: a.browser_download_url, version: v, tag };
      }
    }
  }
  return null;
}

export interface ReleaseResolver {
  resolve(target: DownloadTarget, version?: string): Promise<Resolved>;
}

export function createReleaseResolver(opts: ReleaseResolverOptions): ReleaseResolver {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ttlMs = opts.ttlMs ?? DEFAULT_RELEASES_TTL_MS;
  const now = opts.now ?? (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? 4_000;
  const endpoint = `https://api.github.com/repos/${opts.repo}/releases?per_page=30`;
  const releasesPage = `https://github.com/${opts.repo}/releases`;

  let cached: { releases: unknown; at: number } | null = null;
  let inflight: Promise<unknown | null> | null = null;

  async function fetchReleases(): Promise<unknown | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(endpoint, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'lantern-api' },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      return Array.isArray(body) ? body : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function releases(): Promise<{ releases: unknown; source: Resolved['source'] } | null> {
    const t = now();
    if (cached && t - cached.at < ttlMs) return { releases: cached.releases, source: 'cache' };
    if (!inflight) inflight = fetchReleases().finally(() => (inflight = null));
    const fresh = await inflight;
    if (fresh) {
      cached = { releases: fresh, at: t };
      return { releases: fresh, source: 'api' };
    }
    if (cached) return { releases: cached.releases, source: 'stale' };
    return null;
  }

  return {
    async resolve(target, version) {
      const got = await releases();
      const hit = got ? pickAsset(got.releases, target, version) : null;
      if (hit) return { url: hit.url, version: hit.version, source: got!.source };
      const pinned = opts.fallback?.[target];
      if (pinned) return { url: pinned, version: version ?? 'unknown', source: 'fallback' };
      return { url: releasesPage, version: version ?? 'unknown', source: 'releases-page' };
    },
  };
}
