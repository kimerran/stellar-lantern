import { serve } from '@hono/node-server';
import { readEnv } from './env';
import { createApp } from './app';
import { pgStore } from './telemetry/pg-store';
import { startRetention } from './telemetry/retention';

const env = readEnv();
const log = (line: Record<string, string | number>) => console.log(JSON.stringify(line));

// Telemetry storage is optional: without DATABASE_URL the telemetry routes
// answer 503 and the explainer runs as before.
const store = env.databaseUrl ? await pgStore(env.databaseUrl) : null;
if (store) startRetention({ store, retentionDays: env.retentionDays, log });
if (env.databaseUrl && !env.telemetryAdminToken) {
  throw new Error('TELEMETRY_ADMIN_TOKEN is required when DATABASE_URL is set');
}

const app = createApp({ env, store, log });
serve({ fetch: app.fetch, port: env.port }, (info) => {
  log({ event: 'listening', port: info.port, model: env.model, telemetry: store ? 'on' : 'off' });
});
