> Markdown twin of https://lantern.artisam.xyz/docs/reference/changelog/ — index of every page: https://lantern.artisam.xyz/docs/llms.txt

# Full changelog

Every change merged during the sprint, newest first — the union of the weekly changelogs. Commits link to the public repository.

| Date | Change | Commit | Week |
|---|---|---|---|
| 2026-09-17 | Analytics: drop anonymous installs from the admin pages | [`262e08a`](https://github.com/kimerran/stellar-lantern/commit/262e08a) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-17 | D2 QA: `npm run scan` CLI harness + the manual test plan | [`73d5b34`](https://github.com/kimerran/stellar-lantern/commit/73d5b34) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-16 | Lantern API: telemetry ingest + raw export on Railway Postgres | [`d6eb8a6`](https://github.com/kimerran/stellar-lantern/commit/d6eb8a6) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-16 | Analytics consent UI: Settings → Privacy toggle, delete-my-data, one-time prompt | [`1be589a`](https://github.com/kimerran/stellar-lantern/commit/1be589a) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-16 | Telemetry emit points across the wallet | [`8368834`](https://github.com/kimerran/stellar-lantern/commit/8368834) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-16 | `npm run report:activity` — the self-contained activity report | [`a42f3a3`](https://github.com/kimerran/stellar-lantern/commit/a42f3a3) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-16 | Telemetry on in the release and Android builds; release flag fix | [`d0bbb0e`](https://github.com/kimerran/stellar-lantern/commit/d0bbb0e), [`56928f2`](https://github.com/kimerran/stellar-lantern/commit/56928f2) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-16 | Tester identity: analytics ID under Settings → Privacy; alpha builds attach the wallet address | [`b646af8`](https://github.com/kimerran/stellar-lantern/commit/b646af8), [`8befa37`](https://github.com/kimerran/stellar-lantern/commit/8befa37) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-16 | Analytics page: `/admin` on the Lantern API; deploy the API from CI | [`3b5f11f`](https://github.com/kimerran/stellar-lantern/commit/3b5f11f) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-16 | Analytics UI: dashboard, wallets table with drill-down, raw JSON/CSV downloads | [`e2bbc49`](https://github.com/kimerran/stellar-lantern/commit/e2bbc49) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-15 | Scanner stage 5 — Verdict: deterministic risk core | [`faa3829`](https://github.com/kimerran/stellar-lantern/commit/faa3829) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-15 | Scanner stage 6 — Explain: AI layer, bounded and verdict-proof | [`e76700d`](https://github.com/kimerran/stellar-lantern/commit/e76700d) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-15 | CI: pin Android SDK packages (build and release lanes) | [`5dfd5ac`](https://github.com/kimerran/stellar-lantern/commit/5dfd5ac), [`7c0d14f`](https://github.com/kimerran/stellar-lantern/commit/7c0d14f) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-15 | Release build: scanner AI flag explicitly OFF | [`3addf40`](https://github.com/kimerran/stellar-lantern/commit/3addf40) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-15 | Lantern API: design spec + the LLM proxy for the scanner explainer | [`c1aa027`](https://github.com/kimerran/stellar-lantern/commit/c1aa027), [`418d4c1`](https://github.com/kimerran/stellar-lantern/commit/418d4c1) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-15 | Telemetry core: consent-gated, enum-only, anonymous | [`219336f`](https://github.com/kimerran/stellar-lantern/commit/219336f) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-14 | Release: on-chain blacklist registry (D1) promoted to `main` | [`af35851`](https://github.com/kimerran/stellar-lantern/commit/af35851) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-14 | Scanner: MIT license + extract the scanner into `@lantern/scanner` | [`addfea1`](https://github.com/kimerran/stellar-lantern/commit/addfea1) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-14 | Scanner: six-stage pipeline skeleton + the verdict-immutability invariant | [`57ff777`](https://github.com/kimerran/stellar-lantern/commit/57ff777) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-14 | Scanner stage 1 — Ingest: Soroban RPC simulation, fail-closed | [`d8ffe18`](https://github.com/kimerran/stellar-lantern/commit/d8ffe18) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-14 | Scanner stage 2 — Auth: walk the `SorobanAuthorizationEntry` tree | [`3bd3123`](https://github.com/kimerran/stellar-lantern/commit/3bd3123) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-14 | Scanner stage 3a — Effects: classic payment operations | [`f9048d0`](https://github.com/kimerran/stellar-lantern/commit/f9048d0) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-14 | Scanner stage 3b — Effects: SEP-41 / SAC token-interface calls | [`3f09105`](https://github.com/kimerran/stellar-lantern/commit/3f09105) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-14 | Scanner stage 3c — the unverified-contract fallback | [`57f34cc`](https://github.com/kimerran/stellar-lantern/commit/57f34cc) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-14 | Review follow-up: mark merge inflows as total in the aggregate | [`6e0f2c5`](https://github.com/kimerran/stellar-lantern/commit/6e0f2c5) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-14 | Scanner stage 4 — Screen counterparties against the D1 registry | [`c30f30a`](https://github.com/kimerran/stellar-lantern/commit/c30f30a) | [Week 2](/docs/weekly/week-2/) |
| 2026-09-10 | Blacklist registry: ABI, data model, status semantics and event reference | [`7983bd3`](https://github.com/kimerran/stellar-lantern/commit/7983bd3) | [Week 1](/docs/weekly/week-1/) |
| 2026-09-09 | Blacklist registry: testnet deploy + smoke report (fee-routing evidence) | [`96c4713`](https://github.com/kimerran/stellar-lantern/commit/96c4713) | [Week 1](/docs/weekly/week-1/) |
| 2026-09-08 | Blacklist registry: admin status transitions (active / disputed / revoked) + config | [`76edfba`](https://github.com/kimerran/stellar-lantern/commit/76edfba) | [Week 1](/docs/weekly/week-1/) |
| 2026-09-08 | Blacklist registry: public read API (`is_flagged`, `get`, `count`, `list`) | [`4d7b093`](https://github.com/kimerran/stellar-lantern/commit/4d7b093) | [Week 1](/docs/weekly/week-1/) |
| 2026-09-08 | Blacklist registry: O(1) hot read — deterministic ledger key + `getLedgerEntries` recipe | [`3bcfc4e`](https://github.com/kimerran/stellar-lantern/commit/3bcfc4e) | [Week 1](/docs/weekly/week-1/) |
| 2026-09-07 | Blacklist registry: crate scaffold, data model, storage schema, constructor | [`22de070`](https://github.com/kimerran/stellar-lantern/commit/22de070) | [Week 1](/docs/weekly/week-1/) |
| 2026-09-07 | Blacklist registry: fee-gated `report()` write + treasury routing | [`072c336`](https://github.com/kimerran/stellar-lantern/commit/072c336) | [Week 1](/docs/weekly/week-1/) |
| 2026-09-07 | CI: Soroban contracts lane (fmt, clippy, tests, wasm build) | [`619214a`](https://github.com/kimerran/stellar-lantern/commit/619214a) | [Week 1](/docs/weekly/week-1/) |
