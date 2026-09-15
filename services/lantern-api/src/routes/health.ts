import { Hono } from 'hono';

export function healthRoute(model: string, dailyCount: () => number): Hono {
  const app = new Hono();
  app.get('/healthz', (c) => c.json({ ok: true, model, today: dailyCount() }));
  return app;
}
