import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { originAllowlist } from './middleware/origin';
import { createRateLimiter } from './middleware/rate-limit';
import { bodyLimit } from './middleware/body-limit';
import { explainRoute } from './routes/explain';
import { healthRoute } from './routes/health';

export interface AppOptions {
  env: Env;
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
  const app = new Hono();
  app.route('/', healthRoute(env.model, limiter.dailyCount));
  // A browser page (the D4 playground) preflights with OPTIONS; the MV3
  // service worker with a host_permissions entry does not. Same allowlist
  // as originAllowlist, mounted before it; an unlisted origin gets no
  // Access-Control-Allow-Origin, so the browser refuses the response.
  app.use(
    '/v1/*',
    cors({
      origin: env.allowedOrigins.length > 0 ? env.allowedOrigins : '*',
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: 600,
    }),
  );
  app.use('/v1/*', originAllowlist(env.allowedOrigins));
  app.use('/v1/*', limiter.middleware);
  app.use('/v1/*', bodyLimit());
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
