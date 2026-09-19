import { Hono } from 'hono';

// `db`: true / false when a store is configured, null when it is not.
export function healthRoute(
  model: string,
  dailyCount: () => number,
  dbPing: () => Promise<boolean | null> = async () => null,
): Hono {
  const app = new Hono();
  app.get('/healthz', async (c) =>
    c.json({ ok: true, model, today: dailyCount(), db: await dbPing() }),
  );
  return app;
}
