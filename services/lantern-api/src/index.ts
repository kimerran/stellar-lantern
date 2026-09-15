import { serve } from '@hono/node-server';
import { readEnv } from './env';
import { createApp } from './app';

const env = readEnv();
const app = createApp({ env });
serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(JSON.stringify({ event: 'listening', port: info.port, model: env.model }));
});
