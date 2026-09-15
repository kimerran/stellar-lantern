import { Hono } from 'hono';
import { validateEnvelope } from '@lantern/telemetry-validate';
import type { NewRow, TelemetryStore } from '../telemetry/store';

// Telemetry ingest (#85).
//   POST   /v1/telemetry          the client's envelope → one row per event → 204
//   DELETE /v1/telemetry/install  { installId } → that install's rows gone → 204
//   GET    /v1/telemetry/export   raw rows, JSON lines, admin token → the report's input
//
// The envelope is checked with the SAME validateEnvelope the wallet uses
// (src/core/telemetry/validate.ts, aliased): enum-only props, no free text,
// nothing StrKey-shaped anywhere. Anything else is 400 and inserts nothing.
// Logs carry status, latency and a count — never an event body.

export interface TelemetryDeps {
  store: TelemetryStore | null; // null = no DATABASE_URL → 503
  adminToken?: string;
  now?: () => Date;
  log: (line: Record<string, string | number>) => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const EXPORT_PAGE = 1000;

export function telemetryRoutes(deps: TelemetryDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date());
  const log = (
    route: string,
    status: number,
    code: string,
    started: number,
    extra: Record<string, number> = {},
  ) => deps.log({ route, status, code, ms: Date.now() - started, ...extra });

  app.post('/v1/telemetry', async (c) => {
    const started = Date.now();
    if (!deps.store) {
      log('telemetry', 503, 'no_store', started);
      return c.json({ error: 'unavailable' }, 503);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      log('telemetry', 400, 'bad_input', started);
      return c.json({ error: 'bad_input' }, 400);
    }
    if (!validateEnvelope(raw)) {
      log('telemetry', 400, 'bad_input', started);
      return c.json({ error: 'bad_input' }, 400);
    }
    const receivedAt = now();
    const rows: NewRow[] = raw.events.map((e) => ({
      installId: raw.installId,
      platform: raw.platform,
      appVersion: raw.appVersion,
      network: raw.network,
      event: e.name,
      props: e.props,
      ts: new Date(e.ts),
    }));
    try {
      const n = await deps.store.insert(rows, receivedAt);
      log('telemetry', 204, 'ok', started, { rows: n });
      return c.body(null, 204);
    } catch {
      log('telemetry', 503, 'store_error', started);
      return c.json({ error: 'unavailable' }, 503);
    }
  });

  app.delete('/v1/telemetry/install', async (c) => {
    const started = Date.now();
    if (!deps.store) {
      log('telemetry_delete', 503, 'no_store', started);
      return c.json({ error: 'unavailable' }, 503);
    }
    let body: { installId?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      log('telemetry_delete', 400, 'bad_input', started);
      return c.json({ error: 'bad_input' }, 400);
    }
    if (typeof body.installId !== 'string' || !UUID_RE.test(body.installId)) {
      log('telemetry_delete', 400, 'bad_input', started);
      return c.json({ error: 'bad_input' }, 400);
    }
    try {
      const n = await deps.store.deleteInstall(body.installId);
      log('telemetry_delete', 204, 'ok', started, { rows: n });
      return c.body(null, 204);
    } catch {
      log('telemetry_delete', 503, 'store_error', started);
      return c.json({ error: 'unavailable' }, 503);
    }
  });

  app.get('/v1/telemetry/export', async (c) => {
    const started = Date.now();
    const auth = c.req.header('authorization') ?? '';
    if (!deps.adminToken || auth !== `Bearer ${deps.adminToken}`) {
      log('telemetry_export', 401, 'unauthorized', started);
      return c.json({ error: 'unauthorized' }, 401);
    }
    if (!deps.store) {
      log('telemetry_export', 503, 'no_store', started);
      return c.json({ error: 'unavailable' }, 503);
    }
    const parseDate = (v: string | undefined): Date | undefined | null => {
      if (v === undefined) return undefined;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const since = parseDate(c.req.query('since'));
    const until = parseDate(c.req.query('until'));
    const afterRaw = c.req.query('after');
    const afterId = afterRaw === undefined ? undefined : Number(afterRaw);
    if (since === null || until === null || (afterId !== undefined && !Number.isInteger(afterId))) {
      log('telemetry_export', 400, 'bad_input', started);
      return c.json({ error: 'bad_input' }, 400);
    }
    try {
      const rows = await deps.store.export({
        ...(since ? { since } : {}),
        ...(until ? { until } : {}),
        ...(afterId !== undefined ? { afterId } : {}),
        limit: EXPORT_PAGE,
      });
      const last = rows.length > 0 ? rows[rows.length - 1]!.id : null;
      log('telemetry_export', 200, 'ok', started, { rows: rows.length });
      return c.json({ rows, next: rows.length === EXPORT_PAGE ? last : null }, 200);
    } catch {
      log('telemetry_export', 503, 'store_error', started);
      return c.json({ error: 'unavailable' }, 503);
    }
  });

  return app;
}
