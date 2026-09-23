> Markdown twin of https://golantern.xyz/docs/weekly/week-1/ — index of every page: https://golantern.xyz/docs/llms.txt

# Week 1 — 7–13 September 2026 · D1, on-chain blacklist registry

## Summary

Deliverable 1 shipped in full. The blacklist registry — a Soroban contract where anyone can report a scam address for a 1 XLM fee routed straight to a treasury, where an admin can mark an entry Active, Disputed or Revoked, and where anyone can read the result without an account, a signature or a fee — was written in six merged slices between 7 and 8 September, **deployed to testnet on 9 September**, smoke-tested on chain the same day with the fee transfer asserted, and documented on 10 September. The published deployment's WASM hash matches a fresh local build; the deploy script refuses to publish a hash it cannot reproduce. Ten of ten planned slices are merged.

## Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-09-07 | Blacklist registry: crate scaffold, data model, storage schema, constructor | [`22de070`](https://github.com/kimerran/stellar-lantern/commit/22de070) |
| 2026-09-07 | Blacklist registry: fee-gated `report()` write + treasury routing | [`072c336`](https://github.com/kimerran/stellar-lantern/commit/072c336) |
| 2026-09-07 | CI: Soroban contracts lane (fmt, clippy, tests, wasm build) | [`619214a`](https://github.com/kimerran/stellar-lantern/commit/619214a) |
| 2026-09-08 | Blacklist registry: admin status transitions (active / disputed / revoked) + config | [`76edfba`](https://github.com/kimerran/stellar-lantern/commit/76edfba) |
| 2026-09-08 | Blacklist registry: public read API (`is_flagged`, `get`, `count`, `list`) | [`4d7b093`](https://github.com/kimerran/stellar-lantern/commit/4d7b093) |
| 2026-09-08 | Blacklist registry: O(1) hot read — deterministic ledger key + `getLedgerEntries` recipe | [`3bcfc4e`](https://github.com/kimerran/stellar-lantern/commit/3bcfc4e) |
| 2026-09-09 | Blacklist registry: testnet deploy + smoke report (fee-routing evidence) | [`96c4713`](https://github.com/kimerran/stellar-lantern/commit/96c4713) |
| 2026-09-10 | Blacklist registry: ABI, data model, status semantics and event reference | [`7983bd3`](https://github.com/kimerran/stellar-lantern/commit/7983bd3) |

Every code change planned for D1 is merged. The release to `main` happened on 14 September ([release PR](https://github.com/kimerran/stellar-lantern/pull/153)) and is listed under Week 2.

## Statement of Work progress

| SOW clause | Deliverable | Status | Evidence |
|---|---|---|---|
| D1 — a registry contract anyone can write to for a fee | D1 | Evidenced | [Report transaction `81fa64a6…`](https://stellar.expert/explorer/testnet/tx/81fa64a67eb583f8fb499b2d425e88754b701480f1c8aff2e3ad8a6725fb8ed8) |
| D1 — fee routed to a treasury in the same transaction | D1 | Evidenced | Same transaction; the smoke script asserts the treasury delta equals the fee (`100000000000 → 100010000000`, +1 XLM) |
| D1 — admin status transitions, auditable | D1 | Evidenced | `set_status` calls visible on the [contract's history](https://stellar.expert/explorer/testnet/contract/CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F) |
| D1 — public reads without an account or signature | D1 | Evidenced | `scripts/hot-read-blacklist-registry.mjs` reads the entry via `getLedgerEntries`; the recipe is in the [registry reference](/docs/reference/registry/) |
| §6.1 — stellar.expert contract page | D1 | Evidenced | [`CBJWD6SA…G623F`](https://stellar.expert/explorer/testnet/contract/CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F) |
| §6.1 — WASM hash published in the README | D1 | Evidenced | [README, *Testnet smart contracts*](https://github.com/kimerran/stellar-lantern/blob/main/README.md#testnet-smart-contracts) — `40fd3771…5be23783` |
| §6.1 — sample report transaction with the fee routed | D1 | Evidenced | [`81fa64a6…`](https://stellar.expert/explorer/testnet/tx/81fa64a67eb583f8fb499b2d425e88754b701480f1c8aff2e3ad8a6725fb8ed8) |
| §3.9 — no secrets in the repository | D1 | Evidenced | Admin and treasury are local `stellar keys` identities; the contracts CI lane and a repo grep confirm no key material is committed |

## Evidence added

| Item | Type | Link |
|---|---|---|
| Registry contract (published deployment) | Contract | [`CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F`](https://stellar.expert/explorer/testnet/contract/CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F) |
| WASM hash | Hash | `40fd37718c3fbc7f849c4d414364cdd86c01b4db9ab86be9099007ba5be23783` |
| Treasury | Account | `GA4A2EPXERUUVMBMH3D5OV4ONZ7QXIYKHBSI2ZWZ5HQAIFUMYCQZRSNR` |
| Smoke report transaction (fee routed) | Transaction | [`81fa64a6…8ed8`](https://stellar.expert/explorer/testnet/tx/81fa64a67eb583f8fb499b2d425e88754b701480f1c8aff2e3ad8a6725fb8ed8) |
| QA sandbox instance (same WASM, tester holds the admin key) | Contract | [`CDPEFCHAYIGBHZWEF4TA5VC4V6TX4DIO3KM2E25TZARQMPR2J6E53F4N`](https://stellar.expert/explorer/testnet/contract/CDPEFCHAYIGBHZWEF4TA5VC4V6TX4DIO3KM2E25TZARQMPR2J6E53F4N) |
| Sandbox report transaction | Transaction | [`eda0d8e0…2aa`](https://stellar.expert/explorer/testnet/tx/eda0d8e042773a1a83a6c7d955829b3fe0aca9654cf41b5435fcda1b99a852aa) |
| Sandbox `set_status(Disputed)` transaction | Transaction | [`ae57d189…30b8`](https://stellar.expert/explorer/testnet/tx/ae57d1890c5ef6198e08e9723d063b1186889bef4b20286c826deb984b9130b8) |
| Registry reference (ABI, data model, events, read paths) | Document | [`docs/blacklist-registry.md`](https://github.com/kimerran/stellar-lantern/blob/main/docs/blacklist-registry.md) |
| Recording — registry end to end (1:40) | Recording | *TODO: link* |
| Recording — captioned terminal capture (1:07) | Recording | *TODO: link* |
| Evidence decks (Proof of Deliverables; Technical Documentation & Demo Evidence) | Deck | *TODO: link* |

## Metrics

The SOW's §6.3 metrics (transactions scanned, wallets that ran a scan) are reached through Deliverables 3 and 4; nothing is measurable in Week 1. See [Metrics](/docs/reference/metrics/).

## Decisions

- **Reporting costs money.** The write fee is the anti-abuse mechanism and it funds the scanner's AI inference; it moves reporter → treasury inside the report transaction and the contract never custodies it. A zero fee is legal, so a registry can run before a treasury is funded.
- **The signal is attributed, never an auto-block.** Every entry records who reported it, so a consumer can weight the claim by reporter reputation; the registry informs a warning, it does not gate a transaction on its own.
- **Only a hash goes on chain.** Evidence is a 32-byte digest of material kept off chain.
- **Two read paths.** Contract views for UIs and indexers, and a fee-free direct ledger read (`getLedgerEntries` on a deterministic key) for the per-signature screening path — no source account, no signing, no simulation round-trip.
- **Entries are never deleted.** A Disputed or Revoked entry stops raising a warning but stays readable, so the record of who reported what, and how it was resolved, survives.

## Issues found and fixed

- The published ledger-key example in the reference document was first verified against a throwaway instance and hard-coded; it is now derived from the document by the test suite, so a re-deploy that updates the document and nothing else still passes, and an example whose key no longer follows from its contract id fails the tests instead of shipping.
- The deploy script compares the CLI's returned WASM hash against the local `sha256sum` and aborts on mismatch, after an early run showed how easily a drifted artifact's hash could reach the README.

## Maintenance

Testnet is periodically reset. The deploy script is re-runnable (identities generated and funded only if absent; every step prints what the README needs), and the re-deploy runbook is three steps: README row, deployment table, worked example — the test suite reads the document rather than a copy of it.

## Next week

Deliverable 2, the transaction security scanner: twelve slices sequenced into five waves, from the MIT package boundary through ingest, auth-tree walk, effects, registry screening, a deterministic verdict, and — last on purpose — the AI explainer.
