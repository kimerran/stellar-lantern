// The download log (#131): one row per click on /download/<target>. A server
// log, deliberately NOT app telemetry — in-app events rest on explicit opt-in
// consent, and a download cannot (there is no app yet to consent in), so the
// two never share a table, a validator or a report. Same retention window,
// same sweep.
//
// What a row may hold is exactly the columns below. No raw IP: the edge's
// coarse country header is kept when present and the address is never read
// for storage. No user-agent string: a coarse family only. The route
// (routes/download.ts) is the only writer and a test asserts the row shape.

export type DownloadTarget = 'android' | 'extension';
export type UaFamily = 'android' | 'chrome-desktop' | 'other';

export interface DownloadRow {
  id: number;
  target: DownloadTarget;
  version: string; // the release version the click was sent to
  src: string; // ?src=<campaign>, sanitised; '' when absent
  country: string; // ISO-3166 alpha-2 from the edge, or 'unknown'
  uaFamily: UaFamily;
  ts: Date;
}

export type NewDownload = Omit<DownloadRow, 'id'>;

export const DOWNLOAD_COLUMNS = [
  'id',
  'target',
  'version',
  'src',
  'country',
  'uaFamily',
  'ts',
] as const;

export interface DownloadQuery {
  since?: Date;
  until?: Date;
  limit: number;
}

export interface DownloadStore {
  insertDownload(row: NewDownload): Promise<void>;
  listDownloads(q: DownloadQuery): Promise<DownloadRow[]>;
  purgeDownloadsBefore(cutoff: Date): Promise<number>;
}

export function memoryDownloads(): DownloadStore & { rows: DownloadRow[] } {
  const rows: DownloadRow[] = [];
  let nextId = 1;
  return {
    rows,
    async insertDownload(row) {
      rows.push({ ...row, id: nextId++ });
    },
    async listDownloads(q) {
      return rows
        .filter(
          (r) =>
            (q.since === undefined || r.ts >= q.since) && (q.until === undefined || r.ts < q.until),
        )
        .sort((a, b) => a.id - b.id)
        .slice(0, q.limit);
    },
    async purgeDownloadsBefore(cutoff) {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i]!.ts < cutoff) rows.splice(i, 1);
      return before - rows.length;
    },
  };
}

// Coarse user-agent family. The full string fingerprints; three buckets do not.
export function uaFamilyOf(ua: string | undefined | null): UaFamily {
  const s = ua ?? '';
  if (/Android/i.test(s)) return 'android';
  if (/(Chrome|Chromium|Edg|Brave)\//.test(s) && !/Mobile/i.test(s)) return 'chrome-desktop';
  return 'other';
}

// The edge's country header, when there is one. Never derived from the IP
// here — that would mean reading the address, and this file must not.
const COUNTRY_RE = /^[A-Z]{2}$/;
export function countryOf(get: (name: string) => string | undefined | null): string {
  for (const h of [
    'cf-ipcountry',
    'x-vercel-ip-country',
    'x-country',
    'cloudfront-viewer-country',
  ]) {
    const v = (get(h) ?? '').trim().toUpperCase();
    if (COUNTRY_RE.test(v)) return v;
  }
  return 'unknown';
}

// `?src=` is an attribution label we print on a dashboard, so it is a short
// slug or nothing — never free text, never a URL.
const SRC_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
export function srcOf(v: string | undefined | null): string {
  const s = (v ?? '').trim().toLowerCase();
  return SRC_RE.test(s) ? s : '';
}
