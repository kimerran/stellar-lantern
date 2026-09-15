# Lantern API — LLM proxy for the scanner's explainer

**Date:** 2026-09-15 · **Status:** approved design, not yet built · **Owner slice:** the GitHub issue that links here

## Why

The scanner's stage-6 explainer (#59) calls one hosted LLM. A browser extension
cannot keep a secret: anything in the bundle — including a `VITE_*` env value —
is readable by whoever unzips it, and an LLM key has billing attached. So today
no key ships (D2 epic #62, option 2): the `scannerAi` flag is OFF and the
rules-based sentence renders. That is fine for D2's evidence recording (run
locally with a key) and useless for D3's pre-sign screen and D4's public
playground, where strangers use the product.

This spec stands up the smallest Lantern backend that fixes that: a proxy that
holds the key server-side and exposes one route the scanner client already
knows how to call. Option 1 in #62.

## Scope

**In:** one Node service, one route (`POST /v1/explain`), a health check,
origin allowlist, per-IP rate limit, a service-wide daily cap, input validation,
a Railway deploy, offline tests, a CI test lane, a client `mode: 'proxy'`.

**Out — deliberately:** moving the Soroswap quote key behind the proxy (a
D3-era add-on; the layout leaves room for `/v1/swap/quote`), #12's reputation
API (needs re-scoping against D1's on-chain registry first), per-install client
identity (the upgrade path once there are real users), request logging of
payload contents, multi-instance rate limiting.

## Placement and layout

`services/lantern-api/` — a sibling of `packages/`, its own `package.json`,
TypeScript, **Hono** on Node's `http` module, vitest. It imports
`@lantern/scanner` (a workspace path, not npm) so the prompt-safety code is one
implementation.

```
services/lantern-api/
  package.json, tsconfig.json, Dockerfile, railway.toml, README.md
  src/index.ts                 boot: read + validate env, listen
  src/app.ts                   build the Hono app (middleware + routes); no socket → testable
  src/env.ts                   typed env with defaults
  src/routes/health.ts         GET /healthz
  src/routes/explain.ts        POST /v1/explain
  src/middleware/origin.ts     Origin allowlist
  src/middleware/rate-limit.ts per-IP sliding window + service-wide daily cap
  src/middleware/body-limit.ts 32 KB
  src/upstream/anthropic.ts    the one outbound call; injectable fetch
  test/*.test.ts               offline; stubbed upstream, fake clock
```

Versioned `/v1/` from day one. Nothing else is built for future routes.

## API

### `GET /healthz`
`200 { ok: true, model: string }`. No auth, no rate limit (Railway's health
check hits it).

### `POST /v1/explain`

Request body: the scanner's `ExplainInput` — `{ verdict, effects }` exactly as
the client-side `buildPrompt` consumes it. Schema-validated (unknown fields
rejected; strings length-capped; arrays count-capped) so the proxy never
forwards a payload shape the scanner did not produce.

Response: `200 { explanation: string }`. **Nothing else** — the body has no
`risk`, `action` or `reasons` field, and a test asserts the response shape is
exactly `{ explanation }`. The proxy cannot become a second verdict source.

Server-side pipeline, reusing `@lantern/scanner` verbatim:
`buildPrompt(input)` → Anthropic Messages API (`max_tokens` 200, deadline) →
`sanitise(text, 400)` → `contradictsVerdict(text, verdict.risk)` → `200`, or an
error. The symbol / function-name guards, the memo exclusion and the
contradiction guard therefore hold whether the model is called from the client
or through the proxy, from one implementation.

Errors — all with `{ error: code }`, no upstream text echoed:

| status | when |
|---|---|
| 400 `bad_input` | schema failure |
| 403 `origin` | Origin not allowlisted |
| 413 `too_large` | body over 32 KB |
| 429 `rate_limited` / `daily_cap` | per-IP window or service-wide cap exceeded; upstream 429 also maps here |
| 502 `upstream` / `empty` / `contradiction` | upstream non-2xx, no text, or output contradicting a non-low verdict — **never a fabricated sentence** |
| 504 `timeout` | upstream deadline |

The client already treats any non-2xx or non-string as "use the rules-based
sentence", so every row above degrades to the deterministic fallback.

## Safety and limits (option A: open, but bounded)

An extension cannot hold a client secret, so the proxy is public and bounded
instead:

- **Origin allowlist** — `ALLOWED_ORIGINS`: the extension's
  `chrome-extension://<id>` origin plus the demo site. A speed bump, not a lock
  (headers are forgeable); documented as such.
- **Per-IP rate limit** — `RATE_LIMIT_PER_MIN` (default 10), sliding window,
  keyed by `X-Forwarded-For`'s first hop (Railway sets it) else the socket.
- **Service-wide daily cap** — `DAILY_CAP` (default 2000 requests/UTC day): a
  hard stop that does not depend on the provider's own cap.
- **Input bounds** — 32 KB body, schema, `max_tokens` fixed at 200.
- **No payload logging** — logs carry method, path, status, latency and the
  error code only. The prompt already contains no XDR, memo or keys (#59), and
  the proxy does not widen that.
- **Provider-side spend cap + billing alert** — a human checklist item in the
  README (#62's setup list), not something code can do.
- Counters are in-memory: correct for one Railway instance, documented as the
  limit; a shared store is the first change if the service ever scales out.

## Environment

| var | required | default |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | — |
| `LANTERN_AI_MODEL` | no | `claude-haiku-4-5-20251001` |
| `ALLOWED_ORIGINS` | no | empty = allow all (dev only; README says to set it) |
| `RATE_LIMIT_PER_MIN` | no | `10` |
| `DAILY_CAP` | no | `2000` |
| `UPSTREAM_TIMEOUT_MS` | no | `4000` |
| `PORT` | no | `8080` (Railway injects it) |

Boot fails loudly on a missing key.

## Client change (`packages/lantern-scanner`)

`createHostedExplainer` gains `mode?: 'anthropic' | 'proxy'` (default
`'anthropic'`, preserving today's behaviour). In `proxy` mode it POSTs
`ExplainInput` as JSON to `endpoint` with no key header and reads
`{ explanation }`; the same `ExplainError` kinds map from the status table
above, so `runPipeline`'s fallback is unchanged. `hostedExplainer()` in
`src/core/scan/ai.ts` selects `proxy` mode when given an `endpoint` and no
`apiKey`. The `scannerAi` flag semantics do not change.

## Ops

- `Dockerfile`: `node:22-slim`, `npm ci --omit=dev` at the repo root with the
  workspace, build, `node services/lantern-api/dist/index.js`.
- `railway.toml`: health check `/healthz`, restart policy.
- Deploy: Railway's GitHub integration from `main` (matches the existing release
  path); the README lists the exact steps and the env table. No CI-driven deploy
  in this slice.
- CI: `.github/workflows/services.yml` runs the service's typecheck + tests on
  PRs touching `services/**` or `packages/lantern-scanner/**`.

## Testing (offline, vitest)

- origin allowed / denied / unset-allows-all
- rate limit: N ok, N+1 → 429, window resets on a fake clock
- daily cap: cap → 429 `daily_cap`; resets at UTC midnight on a fake clock
- body limit → 413; schema: unknown field, oversize string, wrong type → 400
- upstream: timeout → 504; 429 → 429; 500 → 502; empty → 502; contradiction for
  a `high` verdict → 502; happy path → sanitised text
- **response shape is exactly `{ explanation }`** — no verdict field can be
  returned
- no request log line contains the prompt or the input
- client: `mode: 'proxy'` posts `ExplainInput`, reads `{ explanation }`, maps
  each status to the right `ExplainError`, and `runPipeline` falls back on every
  error

## Acceptance criteria

- [ ] `services/lantern-api` builds, tests offline, and boots with only
      `ANTHROPIC_API_KEY` set.
- [ ] `POST /v1/explain` returns a sanitised sentence for a real `ExplainInput`
      and only `{ explanation }`; every error row above is asserted.
- [ ] Origin allowlist, per-IP limit and daily cap each asserted with a fake
      clock.
- [ ] No secret, XDR or payload content appears in logs — asserted.
- [ ] `createHostedExplainer({ mode: 'proxy', endpoint })` works end to end
      against a stubbed proxy and falls back on every error.
- [ ] Deployed to Railway; `/healthz` green; README documents env, deploy, the
      provider spend-cap checklist and the "open but bounded" threat model.
- [ ] Repo-wide: no key committed (grep); the extension bundle still contains no
      model key or endpoint by default (`scannerAi` OFF).

## Upgrade path (not in scope)

Per-install client identity (a keypair minted on first run, requests signed,
per-key limits and revocation) when there are real users; `/v1/swap/quote` when
D3 touches the swap screen; #12's reputation endpoints once #12 is re-scoped
against the D1 registry.
