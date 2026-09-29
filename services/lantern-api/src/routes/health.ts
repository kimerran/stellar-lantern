import { Hono } from 'hono';

// `db`: true / false when a store is configured, null when it is not.
export function healthRoute(
  model: string,
  dailyCount: () => number,
  dbPing: () => Promise<boolean | null> = async () => null,
  // The playground's explain calls today (#184), counted apart from `today`.
  demoCount: () => number = () => 0,
): Hono {
  const app = new Hono();
  app.get('/healthz', async (c) =>
    c.json({ ok: true, model, today: dailyCount(), demoToday: demoCount(), db: await dbPing() }),
  );
  return app;
}
