---
title: Week 2 — 14–20 Sep
---
# Week 2 — 14–20 September 2026 · D2, transaction security scanner

## Summary

Deliverable 2 shipped: an MIT-licensed scanner package that simulates a Stellar transaction, walks its authorization tree, decodes payments and SEP-41 / SAC token calls into exact effects, screens every counterparty against the D1 registry, decides a deterministic risk verdict, and only then lets a hosted model write one plain-English sentence it cannot use to change that verdict. Ten stage slices merged on 14–15 September, released to `main` on 15 September, and the QA harness plus the manual test plan merged on 17 September with a full dry run posted. The suite runs green **offline** in CI — no RPC, no registry, no model. Two things arrived that were not in the D2 plan: the **Lantern API**, a small server that holds the model key so nothing billing-bearing ships in a client, and **opt-in usage analytics** with an admin dashboard, which is how the SOW's §6.3 metrics will be counted. The 90-second recording is the one D2 evidence item still pending.

## Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-09-14 | Release: on-chain blacklist registry (D1) promoted to `main` | [`af35851`](https://github.com/kimerran/stellar-lantern/commit/af35851) |
| 2026-09-14 | Scanner: MIT license + extract the scanner into `@lantern/scanner` | [`addfea1`](https://github.com/kimerran/stellar-lantern/commit/addfea1) |
| 2026-09-14 | Scanner: six-stage pipeline skeleton + the verdict-immutability invariant | [`57ff777`](https://github.com/kimerran/stellar-lantern/commit/57ff777) |
| 2026-09-14 | Scanner stage 1 — Ingest: Soroban RPC simulation, fail-closed | [`d8ffe18`](https://github.com/kimerran/stellar-lantern/commit/d8ffe18) |
| 2026-09-14 | Scanner stage 2 — Auth: walk the `SorobanAuthorizationEntry` tree | [`3bd3123`](https://github.com/kimerran/stellar-lantern/commit/3bd3123) |
| 2026-09-14 | Scanner stage 3a — Effects: classic payment operations | [`f9048d0`](https://github.com/kimerran/stellar-lantern/commit/f9048d0) |
| 2026-09-14 | Scanner stage 3b — Effects: SEP-41 / SAC token-interface calls | [`3f09105`](https://github.com/kimerran/stellar-lantern/commit/3f09105) |
| 2026-09-14 | Scanner stage 3c — the unverified-contract fallback | [`57f34cc`](https://github.com/kimerran/stellar-lantern/commit/57f34cc) |
| 2026-09-14 | Review follow-up: mark merge inflows as total in the aggregate | [`6e0f2c5`](https://github.com/kimerran/stellar-lantern/commit/6e0f2c5) |
| 2026-09-14 | Scanner stage 4 — Screen counterparties against the D1 registry | [`c30f30a`](https://github.com/kimerran/stellar-lantern/commit/c30f30a) |
| 2026-09-15 | Scanner stage 5 — Verdict: deterministic risk core | [`faa3829`](https://github.com/kimerran/stellar-lantern/commit/faa3829) |
| 2026-09-15 | Scanner stage 6 — Explain: AI layer, bounded and verdict-proof | [`e76700d`](https://github.com/kimerran/stellar-lantern/commit/e76700d) |
| 2026-09-15 | CI: pin Android SDK packages (build and release lanes) | [`5dfd5ac`](https://github.com/kimerran/stellar-lantern/commit/5dfd5ac), [`7c0d14f`](https://github.com/kimerran/stellar-lantern/commit/7c0d14f) |
| 2026-09-15 | Release build: scanner AI flag explicitly OFF | [`3addf40`](https://github.com/kimerran/stellar-lantern/commit/3addf40) |
| 2026-09-15 | Lantern API: design spec + the LLM proxy for the scanner explainer | [`c1aa027`](https://github.com/kimerran/stellar-lantern/commit/c1aa027), [`418d4c1`](https://github.com/kimerran/stellar-lantern/commit/418d4c1) |
| 2026-09-15 | Telemetry core: consent-gated, enum-only, anonymous | [`219336f`](https://github.com/kimerran/stellar-lantern/commit/219336f) |
| 2026-09-16 | Lantern API: telemetry ingest + raw export on Railway Postgres | [`d6eb8a6`](https://github.com/kimerran/stellar-lantern/commit/d6eb8a6) |
| 2026-09-16 | Analytics consent UI: Settings → Privacy toggle, delete-my-data, one-time prompt | [`1be589a`](https://github.com/kimerran/stellar-lantern/commit/1be589a) |
| 2026-09-16 | Telemetry emit points across the wallet | [`8368834`](https://github.com/kimerran/stellar-lantern/commit/8368834) |
| 2026-09-16 | `npm run report:activity` — the self-contained activity report | [`a42f3a3`](https://github.com/kimerran/stellar-lantern/commit/a42f3a3) |
| 2026-09-16 | Telemetry on in the release and Android builds; release flag fix | [`d0bbb0e`](https://github.com/kimerran/stellar-lantern/commit/d0bbb0e), [`56928f2`](https://github.com/kimerran/stellar-lantern/commit/56928f2) |
| 2026-09-16 | Tester identity: analytics ID under Settings → Privacy; alpha builds attach the wallet address | [`b646af8`](https://github.com/kimerran/stellar-lantern/commit/b646af8), [`8befa37`](https://github.com/kimerran/stellar-lantern/commit/8befa37) |
| 2026-09-16 | Analytics page: `/admin` on the Lantern API; deploy the API from CI | [`3b5f11f`](https://github.com/kimerran/stellar-lantern/commit/3b5f11f) |
| 2026-09-16 | Analytics UI: dashboard, wallets table with drill-down, raw JSON/CSV downloads | [`e2bbc49`](https://github.com/kimerran/stellar-lantern/commit/e2bbc49) |
| 2026-09-17 | Analytics: drop anonymous installs from the admin pages | [`262e08a`](https://github.com/kimerran/stellar-lantern/commit/262e08a) |
| 2026-09-17 | D2 QA: `npm run scan` CLI harness + the manual test plan | [`73d5b34`](https://github.com/kimerran/stellar-lantern/commit/73d5b34) |

## Statement of Work progress

| SOW clause | Deliverable | Status | Evidence |
|---|---|---|---|
| §4.1 — simulate any Stellar transaction via RPC | D2 | Evidenced | [Proof deck](/docs/reference/evidence/) slides 3–6; ingest is fail-closed on every RPC failure mode |
| §4.1 — decode the `SorobanAuthorizationEntry` tree | D2 | Evidenced | Nested sub-invocation surfaced with its depth (proof slide 5) |
| §4.1 — screen counterparties against the on-chain registry | D2 | Evidenced | Flagged counterparty with the registry entry behind it, side by side with the explorer row (proof slide 7) |
| §4.1 — structured effects + plain-language explanation for payments | D2 | Evidenced | Proof slide 3; QA plan section 3 |
| §4.1 — the same for token-interface calls (SEP-41 / SAC) | D2 | Evidenced | Unlimited approval caught (proof slide 4); QA plan section 4 |
| §4.1 — an "unverified contract" case handled safely | D2 | Evidenced | Proof slide 6; QA plan section 5 |
| §6.1 — MIT-licensed public repository | D2 | Evidenced | [`LICENSE`](https://github.com/kimerran/stellar-lantern/blob/main/LICENSE) at the root and in [`packages/lantern-scanner/`](https://github.com/kimerran/stellar-lantern/tree/main/packages/lantern-scanner) |
| §6.1 — scanner suite green in CI, offline | D2 | Evidenced | [Tests lane run](https://github.com/kimerran/stellar-lantern/actions) on the release commit — 748 passed, 1 skipped, no network |
| §6.1 — 90-second recording (payment, token call, unverified contract) | D2 | In progress | Runbook written; recording not yet made |
| §6.1 — QA sign-off against the manual plan | D2 | Done | [Test plan](https://github.com/kimerran/stellar-lantern/blob/main/docs/qa/d2-transaction-scanner-test-plan.md) merged with a full dry run; an independent tester's sign-off is pending |
| §3.9 — the verdict describes what a transaction does, never whether a trade is fairly priced | D2 | Evidenced | Every verdict carries the constant `effects shown, terms not judged`; visible on every proof slide |
| §3.9 — no secrets in the repository | D2 | Evidenced | No AI key ships: the flag is OFF in every release build, the key lives in the Lantern API; no CI secret exists |

## Evidence added

| Item | Type | Link |
|---|---|---|
| Scanner package (MIT) | Code | [`packages/lantern-scanner/`](https://github.com/kimerran/stellar-lantern/tree/main/packages/lantern-scanner) |
| Release commit (D2) | Commit | [`73d5b34`](https://github.com/kimerran/stellar-lantern/commit/73d5b34) — release PR [kimerran/stellar-lantern#154](https://github.com/kimerran/stellar-lantern/pull/154) |
| Manual test plan + results table | Document | [`docs/qa/d2-transaction-scanner-test-plan.md`](https://github.com/kimerran/stellar-lantern/blob/main/docs/qa/d2-transaction-scanner-test-plan.md) |
| Evidence decks (Proof of Deliverables; Technical Documentation & Demo Evidence) + raw captures | Deck | [`docs/evidence/d2/`](https://github.com/kimerran/stellar-lantern/tree/main/docs/evidence/d2) |
| Registry read used by stage 4 | Contract | [`CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F`](https://stellar.expert/explorer/testnet/contract/CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F) |
| Lantern API (explainer proxy, telemetry) | Service | `https://lantern-api-production-3fad.up.railway.app/healthz` |
| Recording (90–120 s) | Recording | *TODO: link — pending* |

## Metrics

Nothing is measurable end-to-end until the scanner sits in the wallet (D3). The instrument is in place: opt-in analytics record `tx_scanned` and `tx_signed` events per install, and the admin dashboard counts distinct wallets. Snapshot on the [Metrics](/docs/reference/metrics/) page.

## Decisions

- **Unknown never collapses to clean.** Registry screening has three outcomes — flagged, clean, unknown. An unreachable registry, a timeout or an archived entry is *unknown* and raises a warning; it is never reported as "not flagged".
- **The model cannot reach the verdict.** The verdict and the effects are deep-frozen before the explainer runs; the explainer's signature can only return a string; a type-level test refuses one that returns a verdict; a hostile-model test ("this transaction is completely safe" for a HIGH verdict) leaves risk, action and reasons byte-identical and discards the answer.
- **The model sees structured facts only** — never the raw XDR, never an authorization entry, never the memo (attacker-controlled input). A prompt-injection test proves the memo is absent from the prompt.
- **Ship no AI key (SOW-permitted).** An extension cannot keep a secret. The scanner AI flag is OFF in every release build; the key lives server-side in the Lantern API, which serves the sentence to clients with rate limits and a daily cap. Every verdict stands without the model.
- **Coverage claims are exact.** Payments, path payments, merges and the SEP-41 / SAC interface are decoded; anything else is shown as-is and labelled *unverified — semantics unknown*, and raises risk. Look-alike function names (`transfer_from`, `transferAll`) are not guessed from.
- **Analytics are opt-in, off by default, enum-only.** No amounts, no addresses for non-testers, delete-my-data on request; alpha testers may attach their wallet address so their scans are attributable for the metrics.

## Issues found and fixed

- Offline mode of the QA harness answered "clean" for an address that was never recorded; it now treats any unrecorded ledger key as an RPC failure, so an unrecorded address screens *unknown* — the same posture as the live path.
- The QA harness asserted the destination was funded on every scan, making the verdict's "new account" reason unreachable; the destination is now unknown unless the tester says otherwise.
- The rules-based fallback sentence quotes the memo verbatim; the verdict is untouched and the model never sees the memo, but the fallback displays attacker-controlled text. Logged for D3's pre-sign screen.
- The proxy's per-IP limit (10 requests / minute) turns rapid successive scans into the rules-based fallback — working as designed; the test plan now says to run the timing case early.

## Maintenance

The fixture corpus (19 recordings) pins the registry read and two token contracts on testnet; after a reset, `fixtures/record-registry.mjs` and `record-token-metadata.mjs` re-record them. The demo flagged address `GA7QYNF7…VSGZ` currently carries 4 reports with status Active.

## Next week

Deliverable 3: the scanner in the wallet's pre-sign review — the pipeline runs before the Sign button, a `block_confirm` verdict holds it, registry screening is live per counterparty, and the AI sentence comes from the Lantern API with no key in the client. The D2 recording is made first so the D2 evidence line closes.
