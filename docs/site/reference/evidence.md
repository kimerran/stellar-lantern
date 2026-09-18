---
title: Evidence index
---
# Evidence index

Every contract id, hash, address, transaction, recording, deck, document and CI run referenced anywhere on this site, in one table. Keep this page open while reviewing. A cell reading *TODO: link* is a known gap, not a missing artifact.

## On chain (Stellar Testnet)

| Item | Type | Value / link | Introduced in |
|---|---|---|---|
| Blacklist registry — published deployment | Contract | [`CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F`](https://stellar.expert/explorer/testnet/contract/CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F) | [Week 1](/docs/weekly/week-1/) |
| Blacklist registry — QA sandbox instance (same WASM) | Contract | [`CDPEFCHAYIGBHZWEF4TA5VC4V6TX4DIO3KM2E25TZARQMPR2J6E53F4N`](https://stellar.expert/explorer/testnet/contract/CDPEFCHAYIGBHZWEF4TA5VC4V6TX4DIO3KM2E25TZARQMPR2J6E53F4N) | Week 1 |
| Registry WASM hash | Hash | `40fd37718c3fbc7f849c4d414364cdd86c01b4db9ab86be9099007ba5be23783` | Week 1 |
| Registry admin (published deployment) | Account | `GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK` | Week 1 |
| Registry treasury (published deployment) | Account | `GA4A2EPXERUUVMBMH3D5OV4ONZ7QXIYKHBSI2ZWZ5HQAIFUMYCQZRSNR` | Week 1 |
| Fee token (native XLM SAC) | Contract | [`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`](https://stellar.expert/explorer/testnet/contract/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC) | Week 1 |
| Smoke report transaction — fee routed (published deployment) | Transaction | [`81fa64a67eb583f8fb499b2d425e88754b701480f1c8aff2e3ad8a6725fb8ed8`](https://stellar.expert/explorer/testnet/tx/81fa64a67eb583f8fb499b2d425e88754b701480f1c8aff2e3ad8a6725fb8ed8) | Week 1 |
| Demo flagged address (reported as Scam, 4 reports, Active) | Account | `GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ` | Week 1 |
| Sandbox treasury | Account | `GBVS2HW246PBWEY2NHMC65CNZD73VIWOKC5MBLX46DTGVEI3TA4OWMLL` | Week 1 |
| Sandbox report transaction | Transaction | [`eda0d8e042773a1a83a6c7d955829b3fe0aca9654cf41b5435fcda1b99a852aa`](https://stellar.expert/explorer/testnet/tx/eda0d8e042773a1a83a6c7d955829b3fe0aca9654cf41b5435fcda1b99a852aa) | Week 1 |
| Sandbox `set_status(Disputed)` transaction | Transaction | [`ae57d1890c5ef6198e08e9723d063b1186889bef4b20286c826deb984b9130b8`](https://stellar.expert/explorer/testnet/tx/ae57d1890c5ef6198e08e9723d063b1186889bef4b20286c826deb984b9130b8) | Week 1 |
| USDC SAC used by the scanner fixtures | Contract | [`CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU`](https://stellar.expert/explorer/testnet/contract/CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU) | Week 2 |

## Code and releases

| Item | Type | Value / link | Introduced in |
|---|---|---|---|
| Public repository (MIT) | Repository | [github.com/kimerran/stellar-lantern](https://github.com/kimerran/stellar-lantern) | — |
| Scanner package (MIT) | Code | [`packages/lantern-scanner/`](https://github.com/kimerran/stellar-lantern/tree/main/packages/lantern-scanner) | Week 2 |
| Registry contract source | Code | [`contracts/blacklist-registry/`](https://github.com/kimerran/stellar-lantern/tree/main/contracts/blacklist-registry) | Week 1 |
| Lantern API (explainer proxy, telemetry, analytics) | Code · Service | [`services/lantern-api/`](https://github.com/kimerran/stellar-lantern/tree/main/services/lantern-api) · `https://lantern-api-production-3fad.up.railway.app/healthz` | Week 2 |
| D1 release to `main` | Release | [Release: on-chain blacklist registry](https://github.com/kimerran/stellar-lantern/pull/153) — `af35851`, 14 Sep | Week 2 |
| D2 release to `main` | Release | [Release: transaction security scanner](https://github.com/kimerran/stellar-lantern/pull/154) — from `73d5b34` | Week 2 |
| Contracts CI lane | CI | [contracts.yml](https://github.com/kimerran/stellar-lantern/actions/workflows/contracts.yml) | Week 1 |
| Tests CI lane (offline suite, build, flag proof) | CI | [test.yml](https://github.com/kimerran/stellar-lantern/actions/workflows/test.yml) | Week 1 |
| Services CI lane (Lantern API) | CI | [services.yml](https://github.com/kimerran/stellar-lantern/actions/workflows/services.yml) | Week 2 |

## Documents, plans and decks

| Item | Type | Value / link | Introduced in |
|---|---|---|---|
| Registry reference — ABI, data model, errors, events, read paths | Document | [`docs/blacklist-registry.md`](https://github.com/kimerran/stellar-lantern/blob/main/docs/blacklist-registry.md) | Week 1 |
| Scanner reference | Document | [`packages/lantern-scanner/README.md`](https://github.com/kimerran/stellar-lantern/blob/main/packages/lantern-scanner/README.md) | Week 2 |
| Lantern API reference and threat model | Document | [`services/lantern-api/README.md`](https://github.com/kimerran/stellar-lantern/blob/main/services/lantern-api/README.md) | Week 2 |
| Analytics disclosure | Document | [`docs/telemetry.md`](https://github.com/kimerran/stellar-lantern/blob/main/docs/telemetry.md) | Week 2 |
| Dated delivery log | Document | [`docs/features.md`](https://github.com/kimerran/stellar-lantern/blob/main/docs/features.md) | — |
| D2 manual test plan + results table | QA | [`docs/qa/d2-transaction-scanner-test-plan.md`](https://github.com/kimerran/stellar-lantern/blob/main/docs/qa/d2-transaction-scanner-test-plan.md) | Week 2 |
| D1 QA sign-off | QA | *TODO: link* | Week 1 |
| D1 evidence decks (Proof of Deliverables; Technical Documentation & Demo Evidence) | Deck | *TODO: link* | Week 1 |
| D2 evidence decks + raw captures per slide | Deck | [`docs/evidence/d2/`](https://github.com/kimerran/stellar-lantern/tree/main/docs/evidence/d2) | Week 2 |
| D1 recording — registry end to end (1:40) | Recording | *TODO: link* | Week 1 |
| D1 recording — captioned terminal capture (1:07) | Recording | *TODO: link* | Week 1 |
| D2 recording (90–120 s) | Recording | *TODO: link — not yet recorded* | Week 2 |
| Analytics dashboard (admin, token-protected) | Dashboard | `https://lantern-api-production-3fad.up.railway.app/admin` — reviewers receive snapshots on the [Metrics](/docs/reference/metrics/) page rather than a login | Week 2 |
