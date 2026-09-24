// Resolves /download/<target> to the current GitHub Release asset (#131).
//
// The builds are published by release.yml (#130) as pre-releases named
// lantern-<version>-testnet.apk and lantern-extension-<version>.zip. GitHub's
// `/releases/latest` — both the API and the `releases/latest/download/…` URL —
// EXCLUDES pre-releases, so this lists releases and takes the newest one that
// carries the asset.
//
// Two modes (#153):
//
//   - No token (the default): a public repo. The list is read signed out and
//     the browser is sent to the asset's `browser_download_url`.
//   - With a token (DOWNLOADS_GITHUB_TOKEN): a PRIVATE repo — the builds live
//     in internal-lantern, where release.yml already publishes them. A private
//     asset's browser_download_url is a 404 to a signed-out visitor, so for
//     each click the resolver asks the asset API (token, octet-stream,
//     redirect: manual) and forwards the signed, short-lived storage URL from
//     GitHub's Location header. Still a redirect, never a proxy: the bytes go
//     GitHub → browser. The signed URL expires within minutes, so it is never
//     cached; the release list is. The token only ever goes to api.github.com,
//     and never into a Resolved, a log line or a response. Read access to that
//     repo is read access to its whole source — treat the token accordingly.
//
// Cached ~5 min so a tester push does not hit the API per click. On any
// failure the last good answer is served indefinitely (stale beats broken),
// then a pinned fallback URL from the environment, then — public mode — the
// releases page, or — private mode, where that page is a 404 to visitors —
// `unavailable`, which the route answers with a small try-again page. Never
// a 500.

import type { DownloadTarget } from './store';

export interface ReleaseAsset {
  url: string; // browser_download_url
  apiUrl?: string; // the asset API URL (`url`), for the authenticated download
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
  // A GitHub token with read access to `repo`'s contents: private mode (#153).
  token?: string;
}

export interface Resolved {
  url: string; // '' when source is 'unavailable'
  version: string;
  source: 'api' | 'cache' | 'stale' | 'fallback' | 'releases-page' | 'unavailable';
}

export interface Checksums {
  text: string; // the release's SHA256SUMS.txt
  version: string;
  tag: string;
}

export const DEFAULT_RELEASES_TTL_MS = 5 * 60_000;
// After a failed refresh the stale answer is served for this long before the
// next attempt, so an outage costs one 4 s fetch per 30 s, not one per click.
export const STALE_RETRY_MS = 30_000;
const TAG_RE = /^v(\d+\.\d+\.\d+)-testnet\.\d+$/;
const ASSET_RE: Record<DownloadTarget, RegExp> = {
  android: /^lantern-\d+\.\d+\.\d+-testnet\.apk$/,
  extension: /^lantern-extension-\d+\.\d+\.\d+\.zip$/,
};
const SUMS_RE = /^SHA256SUMS\.txt$/;
// SHA256SUMS.txt is a few short lines; anything much bigger is not it.
const MAX_SUMS_BYTES = 16 * 1024;
const SUMS_LINE_RE = /^[0-9a-f]{64} [ *]?\S+$/;

interface ApiRelease {
  tag_name?: unknown;
  draft?: unknown;
  assets?: unknown;
}

// Pure: the newest release (as listed — GitHub orders newest first) carrying
// an asset whose name matches, optionally pinned to a version.
function findAsset(releases: unknown, name: RegExp, version?: string): ReleaseAsset | null {
  if (!Array.isArray(releases)) return null;
  for (const raw of releases as ApiRelease[]) {
    if (!raw || typeof raw !== 'object' || raw.draft === true) continue;
    const tag = typeof raw.tag_name === 'string' ? raw.tag_name : '';
    const m = TAG_RE.exec(tag);
    if (!m) continue;
    const v = m[1]!;
    if (version && v !== version) continue;
    if (!Array.isArray(raw.assets)) continue;
    for (const a of raw.assets as Array<{
      name?: unknown;
      browser_download_url?: unknown;
      url?: unknown;
    }>) {
      if (
        a &&
        typeof a.name === 'string' &&
        name.test(a.name) &&
        typeof a.browser_download_url === 'string' &&
        a.browser_download_url.startsWith('https://')
      ) {
        return {
          url: a.browser_download_url,
          ...(typeof a.url === 'string' ? { apiUrl: a.url } : {}),
          version: v,
          tag,
        };
      }
    }
  }
  return null;
}

export function pickAsset(
  releases: unknown,
  target: DownloadTarget,
  version?: string,
): ReleaseAsset | null {
  return findAsset(releases, ASSET_RE[target], version);
}

// The SHA256SUMS.txt release.yml publishes next to the builds (#153).
export function pickChecksums(releases: unknown, version?: string): ReleaseAsset | null {
  return findAsset(releases, SUMS_RE, version);
}

export interface ReleaseResolver {
  resolve(target: DownloadTarget, version?: string): Promise<Resolved>;
  checksums(version?: string): Promise<Checksums | null>;
}

export function createReleaseResolver(opts: ReleaseResolverOptions): ReleaseResolver {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ttlMs = opts.ttlMs ?? DEFAULT_RELEASES_TTL_MS;
  const now = opts.now ?? (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? 4_000;
  const endpoint = `https://api.github.com/repos/${opts.repo}/releases?per_page=30`;
  const releasesPage = `https://github.com/${opts.repo}/releases`;
  const token = opts.token || undefined;
  // The only asset URLs the token is ever sent to.
  const assetApiPrefix = `https://api.github.com/repos/${opts.repo}/releases/assets/`;
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  let cached: { releases: unknown; at: number } | null = null;
  let inflight: Promise<unknown | null> | null = null;

  async function fetchReleases(): Promise<unknown | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(endpoint, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'lantern-api', ...auth },
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
    if (cached) {
      cached.at = t - ttlMs + Math.min(STALE_RETRY_MS, ttlMs);
      return { releases: cached.releases, source: 'stale' };
    }
    return null;
  }

  // Private mode: the signed storage URL for one asset, fetched per click.
  // null on anything but a 3xx to an https Location — a 200 included, since
  // this service redirects and never streams the bytes itself.
  async function signedUrl(hit: ReleaseAsset): Promise<string | null> {
    if (!hit.apiUrl || !hit.apiUrl.startsWith(assetApiPrefix)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(hit.apiUrl, {
        headers: { Accept: 'application/octet-stream', 'User-Agent': 'lantern-api', ...auth },
        redirect: 'manual',
        signal: controller.signal,
      });
      if (res.status < 300 || res.status > 399) return null;
      const location = res.headers.get('location');
      return location && location.startsWith('https://') ? location : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Where a signed-out client can fetch the asset.
  function downloadUrl(hit: ReleaseAsset): Promise<string | null> | string {
    return token ? signedUrl(hit) : hit.url;
  }

  function floor(target: DownloadTarget, version?: string): Resolved {
    const pinned = opts.fallback?.[target];
    if (pinned) return { url: pinned, version: version ?? 'unknown', source: 'fallback' };
    if (token) return { url: '', version: version ?? 'unknown', source: 'unavailable' };
    return { url: releasesPage, version: version ?? 'unknown', source: 'releases-page' };
  }

  // Release assets are immutable per tag, so a tag's checksums are kept for
  // the life of the process.
  const sumsByTag = new Map<string, string>();

  async function fetchSums(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // A signed URL or a public browser_download_url: never the token.
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': 'lantern-api' },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const text = await res.text();
      if (text.length > MAX_SUMS_BYTES) return null;
      const lines = text.trim().split('\n').map((l) => l.trim());
      if (!lines.every((l) => SUMS_LINE_RE.test(l))) return null;
      return `${lines.join('\n')}\n`;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async resolve(target, version) {
      const got = await releases();
      const hit = got ? pickAsset(got.releases, target, version) : null;
      if (!hit) return floor(target, version);
      const url = await downloadUrl(hit);
      if (!url) return floor(target, hit.version);
      return { url, version: hit.version, source: got!.source };
    },
    async checksums(version) {
      const got = await releases();
      const hit = got ? pickChecksums(got.releases, version) : null;
      if (!hit) return null;
      const known = sumsByTag.get(hit.tag);
      if (known) return { text: known, version: hit.version, tag: hit.tag };
      const url = await downloadUrl(hit);
      const text = url ? await fetchSums(url) : null;
      if (!text) return null;
      sumsByTag.set(hit.tag, text);
      return { text, version: hit.version, tag: hit.tag };
    },
  };
}
