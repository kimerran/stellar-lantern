// The web app's Content-Security-Policy (#238), injected into webapp/index.html
// as a <meta> tag by vite.config.web.ts and checked by build:web.
//
// A hosted wallet runs whatever the server sends that day, so the page itself
// refuses everything but its own files and the services it needs: testnet
// Horizon and RPC, Friendbot (funding a new testnet account) and the Lantern
// API. No inline script, no eval, no third-party script, style or frame.
//
// `frame-ancestors` is ignored in a <meta> CSP: the host must send it as a
// header (docs/web-app-hosting.md), and main.tsx refuses to run in a frame.

import { NETWORKS } from '../shared/constants';

const LANTERN_API = 'https://lantern-api-production-3fad.up.railway.app';
const origin = (url: string | undefined) => new URL(url!).origin;

export function webCspDirectives(): Record<string, string[]> {
  const t = NETWORKS.TESTNET;
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'"],
    'font-src': ["'self'"],
    'img-src': ["'self'", 'data:'],
    'connect-src': [
      "'self'",
      origin(t.horizonUrl),
      origin(t.sorobanRpcUrl),
      origin(t.friendbotUrl),
      LANTERN_API,
    ],
    // The bundled mini-apps, served from this origin. Remote dApps are off in
    // the web build: they would need any origin here.
    'frame-src': ["'self'"],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'"],
  };
}

export const WEB_CSP = Object.entries(webCspDirectives())
  .map(([k, v]) => `${k} ${v.join(' ')}`)
  .join('; ');
