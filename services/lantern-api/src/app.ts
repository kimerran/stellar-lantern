import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { originAllowlist } from './middleware/origin';
import { createRateLimiter } from './middleware/rate-limit';
import { bodyLimit } from './middleware/body-limit';
import { explainRoute } from './routes/explain';
import { healthRoute } from './routes/health';
import { telemetryRoutes } from './routes/telemetry';
import type { TelemetryStore } from './telemetry/store';

export interface AppOptions {
  env: Env;
  // Telemetry store (#85); null when no DATABASE_URL is configured.
  store?: TelemetryStore | null;
  nowDate?: () => Date;
  fetchImpl?: typeof fetch; // upstream, injectable for tests
  upstreamEndpoint?: string;
  now?: () => number;
  log?: (line: Record<string, string | number>) => void;
}

// Builds the app without opening a socket, so tests call `app.request()`.
export function createApp(opts: AppOptions): Hono {
  const { env } = opts;
  const log = opts.log ?? ((line) => console.log(JSON.stringify(line)));
  const limiter = createRateLimiter({
    perMinute: env.rateLimitPerMin,
    dailyCap: env.dailyCap,
    ...(opts.now ? { now: opts.now } : {}),
  });
  const store = opts.store ?? null;
  const telemetryLimiter = createRateLimiter({
    perMinute: env.rateLimitPerMin,
    dailyCap: env.telemetryDailyCap,
    ...(opts.now ? { now: opts.now } : {}),
  });
  const app = new Hono();
  app.route(
    '/',
    healthRoute(env.model, limiter.dailyCount, () =>
      store ? store.ping() : Promise.resolve(null),
    ),
  );
  // A browser page (the D4 playground) preflights with OPTIONS; the MV3
  // service worker with a host_permissions entry does not. Same allowlist
  // as originAllowlist, mounted before it; an unlisted origin gets no
  // Access-Control-Allow-Origin, so the browser refuses the response.
  app.use(
    '/v1/*',
    cors({
      origin: env.allowedOrigins.length > 0 ? env.allowedOrigins : '*',
      allowMethods: ['POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: 600,
    }),
  );
  app.use('/v1/*', originAllowlist(env.allowedOrigins));
  // Telemetry has its own daily cap so it can never starve the explainer;
  // the export is admin-only and skips the per-IP window.
  app.use('/v1/telemetry', telemetryLimiter.middleware);
  app.use('/v1/telemetry/install', telemetryLimiter.middleware);
  app.use('/v1/explain', limiter.middleware);
  app.use('/v1/*', bodyLimit());
  app.route(
    '/',
    telemetryRoutes({
      store,
      ...(env.telemetryAdminToken ? { adminToken: env.telemetryAdminToken } : {}),
      ...(opts.nowDate ? { now: opts.nowDate } : {}),
      log,
    }),
  );
  app.route(
    '/',
    explainRoute({
      upstream: {
        apiKey: env.anthropicApiKey,
        model: env.model,
        timeoutMs: env.upstreamTimeoutMs,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        ...(opts.upstreamEndpoint ? { endpoint: opts.upstreamEndpoint } : {}),
      },
      log,
    }),
  );
  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  return app;
}
