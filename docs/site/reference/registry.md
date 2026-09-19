---
title: Registry contract
---
# Registry contract — on-chain blacklist

Condensed from the [full reference](https://github.com/kimerran/stellar-lantern/blob/main/docs/blacklist-registry.md), which has the complete ABI, the numbered error table, the nine-field data model, the event schema, the fee model and both read paths. Source: [`contracts/blacklist-registry/`](https://github.com/kimerran/stellar-lantern/tree/main/contracts/blacklist-registry).

## Deployment (Stellar Testnet)

| | |
|---|---|
| Contract id | [`CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F`](https://stellar.expert/explorer/testnet/contract/CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F) |
| WASM hash | `40fd37718c3fbc7f849c4d414364cdd86c01b4db9ab86be9099007ba5be23783` — the sha256 of the built artifact; the deploy script refuses to continue if the uploaded hash disagrees with the local build |
| Admin | `GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK` |
| Treasury | `GA4A2EPXERUUVMBMH3D5OV4ONZ7QXIYKHBSI2ZWZ5HQAIFUMYCQZRSNR` |
| Fee | 1 XLM (`10000000` stroops) of the native XLM SAC, per accepted report |
| Smoke report transaction | [`81fa64a6…8ed8`](https://stellar.expert/explorer/testnet/tx/81fa64a67eb583f8fb499b2d425e88754b701480f1c8aff2e3ad8a6725fb8ed8) |

Admin and treasury are local `stellar keys` identities on the deploying machine; no secret is in the repository.

## Interface

| Entry point | Who | What |
|---|---|---|
| `report(reporter, subject, reason, evidence) → u32` | Anyone | Records `subject` as malicious, returns its new total report count, charges the fee reporter → treasury inside the same transaction. `reporter.require_auth()` runs first. Self-report is rejected. |
| `set_status(subject, status)` | Admin | Active / Disputed / Revoked. Only Active raises a warning; the entry is never deleted. |
| `set_fee`, `set_fee_token`, `set_treasury`, `set_admin` | Admin | Config. `set_admin` requires both the outgoing and the incoming admin to sign. |
| `is_flagged(subject) → bool`, `get(subject)`, `count()`, `list(start, limit)`, `config()` | Anyone | Public reads; no fee, no auth. |

## Two read paths

1. **Contract views** (`is_flagged`, `get`, `list`) via a simulated call — for UIs and indexers.
2. **Direct ledger read** — the entry's ledger key is deterministic from the contract id and the subject address, so a single `getLedgerEntries` RPC call returns it with **no source account, no signature, no fee and no simulation round-trip**. This is the path the scanner's Screen stage uses per counterparty, and the path a visitor to the public demo (who has no key) can take. `scripts/hot-read-blacklist-registry.mjs` is the reference implementation; the worked example in the full reference is re-derived by the test suite so it cannot drift from the deployment.

## Data model, in one line

Each entry records the subject, the reporter, the reason (an enum), the status, a 32-byte evidence hash (the material stays off chain), first-reported and last-updated ledger times, the report count and an index for paging.

## After a testnet reset

Testnet is periodically reset. `scripts/deploy-blacklist-registry.sh` is re-runnable and prints every value to update; the runbook is three steps (README row, deployment table, worked example), and the scanner's registry fixture is re-recorded with `fixtures/record-registry.mjs`.
