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
| `GET /healthz` | `{ ok, model, today }` — no auth, no limits (Railway's health check) |
| `POST /v1/explain` | body: the scanner's `ExplainInput` (`{ verdict, effects }`); returns **exactly** `{ explanation: string }` |

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

## Threat model: open, but bounded

An extension cannot hold a client secret, so the proxy is public and bounded
instead:

- **Origin allowlist** — a speed bump, not a lock (headers are forgeable
  outside a browser). Stops other sites' pages spending the budget.
- **Per-IP rate limit** (`RATE_LIMIT_PER_MIN`, default 10, sliding window,
  keyed by the first `X-Forwarded-For` hop).
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
   table. Railway sets `PORT`.
5. Deploy; `GET https://<service>.up.railway.app/healthz` must answer
   `{ "ok": true, … }`. Give the public URL + `/v1/explain` to the wallet
   (`hostedExplainer({ endpoint })`) and the demo site.

No CI-driven deploy: Railway's GitHub integration redeploys on pushes to
`main`. `.github/workflows/services.yml` runs typecheck, the offline suite, the
bundle build and a boot smoke on PRs.

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
test/app.test.ts          offline suite
Dockerfile, railway.toml  deploy
```

Versioned `/v1/` from day one so a future route (`/v1/swap/quote` when D3
touches the swap screen; #12's reputation endpoints once re-scoped) drops in
without a rewrite. Nothing else is built for them.
