# Lantern API

The backend that holds keys so clients never do. One route today: the
transaction scanner's AI explainer proxy. Design:
`docs/superpowers/specs/2026-09-15-lantern-api-llm-proxy-design.md` (#80).

## Why it exists

A browser extension cannot keep a secret — anything in the bundle, including a
`VITE_*` env value, is readable by whoever unzips it — and an LLM key has
billing attached. So the wallet ships **no** model key (`scannerAi` OFF), and
this service is the only thing that talks to the model. The verdict never
depends on it: the scanner's deterministic core decides risk, and if this
service is down the wallet shows its rules-based sentence instead.

## Routes

| route | what |
|---|---|
| `GET /healthz` | `{ ok, model, today, db }` — no auth, no limits (Railway's health check); `db` is `true`/`false` with a store, `null` without |
| `POST /v1/explain` | body: the scanner's `ExplainInput` (`{ verdict, effects }`); returns **exactly** `{ explanation: string }` |
| `POST /v1/telemetry` | body: the wallet's telemetry envelope; one row per event; `204` (#85) |
| `DELETE /v1/telemetry/install` | body `{ installId }`; that install's rows gone; `204` either way |
| `GET /v1/telemetry/export` | `Authorization: Bearer $TELEMETRY_ADMIN_TOKEN`; `?since=&until=&after=`; `{ rows, next }`, 1000 rows a page — the report's only input |

`/v1/explain` runs the scanner package's own code, imported: `buildPrompt`
(structured facts only — no XDR, no memo, symbol / function-name guards) →
the Anthropic Messages API (`max_tokens` 200, deadline) → `sanitise` →
`contradictsVerdict`. The proxy **never invents a sentence**: every failure is
an error status and the client falls back to the rules-based sentence.

| status | `error` | when |
|---|---|---|
| 400 | `bad_input` | not the scanner's shape (unknown field, wrong type, oversize) |
| 403 | `origin` | Origin not in `ALLOWED_ORIGINS` |
| 413 | `too_large` | body over 32 KB |
| 429 | `rate_limited` / `daily_cap` | per-IP window or service-wide cap; upstream 429 too |
| 502 | `upstream` / `empty` / `contradiction` | upstream failure, no text, or output that contradicts a non-low verdict |
| 504 | `timeout` | upstream deadline |

The response body can never carry `risk`, `action` or `reasons` — asserted by
test. The proxy cannot become a second verdict source.

## Telemetry ingest (#85)

The envelope is validated with the **same** `validateEnvelope` the wallet
uses (`src/core/telemetry/validate.ts`, aliased in): enum-only props, no
free text, nothing StrKey-shaped anywhere. Anything else is `400` and inserts
nothing. Rows are exactly `install_id, platform, app_version, network, event,
props, ts, received_at` in Postgres (`telemetry_events`; the migration is one
idempotent statement applied at boot). Telemetry has its **own** daily cap
(`TELEMETRY_DAILY_CAP`) so it can never starve the explainer, shares the
origin allowlist and body limit, and logs a row count — never an event body.

**Retention:** rows older than `TELEMETRY_RETENTION_DAYS` (default 90) are
purged at boot and every 24 h in-process. "Delete my data" is
`DELETE /v1/telemetry/install`, which the wallet's `revokeConsentAndDelete()`
already calls.

Without `DATABASE_URL` the telemetry routes answer `503` and the explainer is
unaffected. With it, `TELEMETRY_ADMIN_TOKEN` is required (boot fails
otherwise). Postgres is private-network only on Railway, so the `pgStore`
integration test (`test/pg-store.test.ts`) runs only when you point
`DATABASE_URL` at a database of your own; CI uses the in-memory store.

## The analytics page: `/admin` (#104)

The activity report, served. `GET /admin` shows a one-field login (the
`TELEMETRY_ADMIN_TOKEN`); a right token sets a session cookie
(`lantern_admin`: HttpOnly, Secure, SameSite=Strict, 12 h, `Path=/admin`)
whose value is `<expiry>.<HMAC(nonce, token.expiry)>` with the nonce minted at
boot — the cookie never carries the token, the expiry is enforced server-side
(a copied header dies after 12 h regardless of the browser), a restart
invalidates every session, and a leaked cookie cannot be replayed against
`/v1/telemetry/export`. With a session
(#106): `/admin` is the **dashboard** (tiles, events-per-day chart as inline
SVG, event and verdict tables), `/admin/wallets` lists one row per identity
(address for alpha installs, "User N" for anonymous ones; `?sort=lastSeen|
firstSeen|events|sessions|txSigned|highRiskGated`), `/admin/wallets/<key>`
is the drill-down for one identity (`key` = the `G…` address, or the install
id of an anonymous install) with its counts, daily chart and full trail, and
`/admin/report` is the emailed-style report — the same code as `npm run
report:activity` (both import `src/core/telemetry/report.ts`, aliased here as
`@lantern/telemetry-report`). Every page takes
`?since=YYYY-MM-DD&until=YYYY-MM-DD&platform=extension|android` (default
window: the last 30 days). Raw data: `/admin/export.csv` and
`/admin/export.json` for the same filters, plus `&wallet=<key>` for one
identity — the drill-down links both. No page carries a `<script>`. Login attempts share
the telemetry per-IP window; every `/admin*` response is `Cache-Control:
no-store` + `X-Robots-Tag: noindex`. No `TELEMETRY_ADMIN_TOKEN` → `/admin` is
404, exactly like the export; no `DATABASE_URL` → 503. The page's Q4 registry
tile is "n/a" here (the offline report cross-checks Soroban RPC; the server
does not make that call).

## Threat model: open, but bounded

An extension cannot hold a client secret, so the proxy is public and bounded
instead:

- **Origin allowlist** — a speed bump, not a lock (headers are forgeable
  outside a browser). Stops other sites' pages spending the budget. The same
  list drives CORS, so a browser page (the D4 playground) can call `/v1/*`
  from a listed origin; the extension's service worker needs no CORS.
- **Per-IP rate limit** (`RATE_LIMIT_PER_MIN`, default 10, sliding window,
  keyed by the **last** `X-Forwarded-For` hop — the one the trusted edge
  appends; earlier hops are client-controlled).
- **Service-wide daily cap** (`DAILY_CAP`, default 2000 / UTC day) — a hard
  stop independent of the provider's cap.
- **Input bounds** — 32 KB, strict schema, unknown fields rejected,
  `max_tokens` fixed.
- **No payload logging** — one JSON line per request: route, status, code,
  latency. Never the input, the prompt or the key.
- Counters are **in-memory**: correct for one instance (this deployment). A
  shared store is the first change if the service ever scales out.
- The **provider-side spend cap and billing alert** are yours to set (below).

The upgrade path once there are real users is per-install client identity
(a keypair minted on first run, signed requests, per-key limits) — not built.

## Environment

| var | required | default |
|---|---|---|
| `ANTHROPIC_API_KEY` | **yes** | — (boot fails without it) |
| `LANTERN_AI_MODEL` | no | `claude-haiku-4-5-20251001` |
| `ALLOWED_ORIGINS` | no | empty = allow all — **dev only; set it in every deployment** |
| `RATE_LIMIT_PER_MIN` | no | `10` |
| `DAILY_CAP` | no | `2000` |
| `UPSTREAM_TIMEOUT_MS` | no | `4000` |
| `PORT` | no | `8080` (Railway injects it) |
| `DATABASE_URL` | no | — ; set by reference to the Postgres service (`${{Postgres.DATABASE_URL}}`); enables telemetry |
| `TELEMETRY_ADMIN_TOKEN` | with `DATABASE_URL` | — ; bearer for `/v1/telemetry/export` |
| `TELEMETRY_DAILY_CAP` | no | `50000` |
| `TELEMETRY_RETENTION_DAYS` | no | `90` |

The extension's origin is `chrome-extension://<extension id>`; add the demo
site's origin alongside it.

## Run locally

```bash
npm ci                                   # repo root, once
cd services/lantern-api && npm ci
npm test                                 # offline; upstream is stubbed
ANTHROPIC_API_KEY=sk-… npm run dev       # builds dist/index.js and listens on :8080
curl localhost:8080/healthz
```

Point the wallet at it with `hostedExplainer({ endpoint: 'http://localhost:8080/v1/explain' })`
(`src/core/scan/ai.ts`) in a build with `VITE_FEATURE_SCANNER_AI=true`.

## Deploy to Railway

**Short version:** `scripts/deploy-lantern-api.sh` from the repo root. The
Railway CLI's uploader fails on this tree (`prefix not found`) and would ship
the whole repo as build context, so the script stages exactly what the
Dockerfile copies into a scratch directory, links it to the pinned project
(an unlinked directory makes `railway up` create a *new* project), uploads
with `--path-as-root`, and waits for `/healthz`. First-time setup:

1. **Anthropic account (human step):** create a key scoped to this project;
   set a hard monthly spend cap and a billing alert. Record the model in
   `LANTERN_AI_MODEL` if it differs from the default — the SOW commits to a
   single named hosted model.
2. Railway → New Project → Deploy from GitHub → this repo, branch `main`
   (the release branch — matches the extension/APK release path).
3. Service settings: **Root Directory `/`** (the Dockerfile builds from the
   repo root so `@lantern/scanner` resolves), Config-as-code path
   `services/lantern-api/railway.toml` — it sets the Dockerfile, the
   `/healthz` health check and the restart policy.
4. Variables: `ANTHROPIC_API_KEY`, `ALLOWED_ORIGINS`, and any override from the
   table. Railway sets `PORT`. For telemetry: `railway add --database postgres`,
   then on this service `DATABASE_URL=${{Postgres.DATABASE_URL}}` and a
   `TELEMETRY_ADMIN_TOKEN` (`openssl rand -hex 24`).
5. Deploy; `GET https://<service>.up.railway.app/healthz` must answer
   `{ "ok": true, … }`. Give the public URL + `/v1/explain` to the wallet
   (`hostedExplainer({ endpoint })`) and the demo site.

**Deploy from CI (#104):** `release.yml` has a `deploy-api` job after the
release build on every push to `main`. It runs the same script with
`RAILWAY_TOKEN` (a Railway *project token* for the `lantern` project —
Project → Settings → Tokens; add it as a repository secret named
`RAILWAY_TOKEN`) and fails the run if `/healthz` does not come back. Without
the secret the job prints a notice and skips, so a fork or a checkout without
Railway access still builds. Before this, the API was deployed by hand and
lagged the clients (#100). `.github/workflows/services.yml` still runs
typecheck, the offline suite, the bundle build and a boot smoke on PRs.

## Layout

```
src/index.ts              boot: read + validate env, listen
src/app.ts                the Hono app (no socket) — what tests exercise
src/env.ts                typed env with defaults
src/validate.ts           strict ExplainInput validation
src/routes/explain.ts     POST /v1/explain
src/routes/health.ts      GET /healthz
src/middleware/origin.ts  Origin allowlist
src/middleware/rate-limit.ts  per-IP window + daily cap (injectable clock)
src/middleware/body-limit.ts  32 KB
src/upstream/anthropic.ts the one outbound call (injectable fetch)
src/routes/telemetry.ts   POST /v1/telemetry, DELETE …/install, GET …/export (#85)
src/telemetry/store.ts    TelemetryStore interface + in-memory implementation
src/telemetry/pg-store.ts Postgres implementation + the migration
src/telemetry/retention.ts the 90-day purge
test/app.test.ts          offline suite (explainer)
test/telemetry.test.ts    offline suite (ingest, export, delete, retention)
test/pg-store.test.ts     Postgres integration, DATABASE_URL-gated
Dockerfile, railway.toml  deploy
```

Versioned `/v1/` from day one so a future route (`/v1/swap/quote` when D3
touches the swap screen; #12's reputation endpoints once re-scoped) drops in
without a rewrite. Nothing else is built for them.
