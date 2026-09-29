// Postgres implementation of TelemetryStore (#85). The migration is one
// idempotent statement applied at boot — no framework for one table.

import pg from 'pg';
import type { ExportQuery, NewRow, TelemetryRow, TelemetryStore } from './store';
import type { DownloadRow, DownloadStore, LogTarget, UaFamily } from '../downloads/store';

export const MIGRATION = `
CREATE TABLE IF NOT EXISTS telemetry_events (
  id           BIGSERIAL PRIMARY KEY,
  install_id   UUID        NOT NULL,
  platform     TEXT        NOT NULL,
  app_version  TEXT        NOT NULL,
  network      TEXT        NOT NULL,
  event        TEXT        NOT NULL,
  props        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ts           TIMESTAMPTZ NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE telemetry_events ADD COLUMN IF NOT EXISTS account TEXT NULL;
CREATE INDEX IF NOT EXISTS telemetry_events_install_ts ON telemetry_events (install_id, ts);
CREATE INDEX IF NOT EXISTS telemetry_events_received   ON telemetry_events (received_at);
`;

// The download log (#131) is its own table, never joined to the consented
// telemetry rows: the two have different privacy bases (downloads/store.ts).
// /join clicks (#162) land here too as target 'alpha' — target is plain TEXT
// with no CHECK, so no migration was needed.
export const DOWNLOADS_MIGRATION = `
CREATE TABLE IF NOT EXISTS downloads (
  id         BIGSERIAL PRIMARY KEY,
  target     TEXT        NOT NULL,
  version    TEXT        NOT NULL,
  src        TEXT        NOT NULL DEFAULT '',
  country    TEXT        NOT NULL DEFAULT 'unknown',
  ua_family  TEXT        NOT NULL,
  ts         TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS downloads_ts ON downloads (ts);
`;

interface DownloadDbRow {
  id: string;
  target: string;
  version: string;
  src: string;
  country: string;
  ua_family: string;
  ts: Date;
}
const toDownload = (r: DownloadDbRow): DownloadRow => ({
  id: Number(r.id),
  target: r.target as LogTarget,
  version: r.version,
  src: r.src,
  country: r.country,
  uaFamily: r.ua_family as UaFamily,
  ts: r.ts,
});

interface DbRow {
  id: string;
  install_id: string;
  platform: string;
  app_version: string;
  network: string;
  event: string;
  props: Record<string, string | boolean>;
  ts: Date;
  received_at: Date;
  account: string | null;
}

const toRow = (r: DbRow): TelemetryRow => ({
  id: Number(r.id),
  installId: r.install_id,
  platform: r.platform,
  appVersion: r.app_version,
  network: r.network,
  event: r.event,
  props: r.props,
  ts: r.ts,
  receivedAt: r.received_at,
  account: r.account,
});

export async function pgStore(
  databaseUrl: string,
): Promise<TelemetryStore & { downloads: DownloadStore; close(): Promise<void> }> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  await pool.query(MIGRATION);
  await pool.query(DOWNLOADS_MIGRATION);
  const downloads: DownloadStore = {
    async insertDownload(r) {
      await pool.query(
        'INSERT INTO downloads (target, version, src, country, ua_family, ts) VALUES ($1, $2, $3, $4, $5, $6)',
        [r.target, r.version, r.src, r.country, r.uaFamily, r.ts],
      );
    },
    async listDownloads(q) {
      const where: string[] = [];
      const values: unknown[] = [];
      if (q.since) {
        values.push(q.since);
        where.push(`ts >= $${values.length}`);
      }
      if (q.until) {
        values.push(q.until);
        where.push(`ts < $${values.length}`);
      }
      values.push(q.limit);
      const res = await pool.query<DownloadDbRow>(
        `SELECT id, target, version, src, country, ua_family, ts FROM downloads${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY id ASC LIMIT $${values.length}`,
        values,
      );
      return res.rows.map(toDownload);
    },
    async purgeDownloadsBefore(cutoff) {
      const res = await pool.query('DELETE FROM downloads WHERE ts < $1', [cutoff]);
      return res.rowCount ?? 0;
    },
  };
  return {
    downloads,
    async insert(rows: NewRow[], receivedAt: Date) {
      if (rows.length === 0) return 0;
      // One multi-row INSERT per envelope.
      const values: unknown[] = [];
      const tuples = rows.map((r, i) => {
        const b = i * 9;
        values.push(
          r.installId,
          r.platform,
          r.appVersion,
          r.network,
          r.event,
          JSON.stringify(r.props),
          r.ts,
          receivedAt,
          r.account ?? null,
        );
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::jsonb, $${b + 7}, $${b + 8}, $${b + 9})`;
      });
      const res = await pool.query(
        `INSERT INTO telemetry_events (install_id, platform, app_version, network, event, props, ts, received_at, account) VALUES ${tuples.join(', ')}`,
        values,
      );
      return res.rowCount ?? 0;
    },
    async deleteInstall(installId) {
      const res = await pool.query('DELETE FROM telemetry_events WHERE install_id = $1', [
        installId,
      ]);
      return res.rowCount ?? 0;
    },
    async export(q: ExportQuery) {
      const where: string[] = [];
      const values: unknown[] = [];
      if (q.afterId !== undefined) {
        values.push(q.afterId);
        where.push(`id > $${values.length}`);
      }
      if (q.since) {
        values.push(q.since);
        where.push(`received_at >= $${values.length}`);
      }
      if (q.until) {
        values.push(q.until);
        where.push(`received_at < $${values.length}`);
      }
      values.push(q.limit);
      const res = await pool.query<DbRow>(
        `SELECT id, install_id, platform, app_version, network, event, props, ts, received_at, account FROM telemetry_events${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY id ASC LIMIT $${values.length}`,
        values,
      );
      return res.rows.map(toRow);
    },
    async purgeBefore(cutoff) {
      const res = await pool.query('DELETE FROM telemetry_events WHERE received_at < $1', [cutoff]);
      return res.rowCount ?? 0;
    },
    async ping() {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  };
}
