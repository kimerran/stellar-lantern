// The web app's analytics switch (#239). vite.config.web.ts pins the
// `telemetry` flag of the web build to this constant, instead of the
// FLAG_DEFS default, and fixes the ingest URL like the playground does, so
// the committed, drift-checked bundle doesn't depend on the machine that
// built it.
//
// OFF until the lantern-api release that accepts `platform: 'web'` and
// `web_attributed` is live (the #182 lesson: a client must never send what
// the server rejects). While it's off, the web build carries no telemetry
// code at all and sends nothing. To turn it on: make sure that release is
// deployed and that https://app.golantern.xyz is in lantern-api's
// ALLOWED_ORIGINS (if set), flip this to true, then `npm run build:web` and
// commit webapp/.
//
// Even when on, nothing is sent without the user's opt-in (Settings →
// Privacy), the same consent model as the extension and Android.
export const WEB_TELEMETRY_ENABLED = false;

// The Lantern API's ingest, already in the web app's CSP connect-src.
export const WEB_INGEST_URL = 'https://lantern-api-production-3fad.up.railway.app/v1/telemetry';
