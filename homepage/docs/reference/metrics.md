> Markdown twin of https://lantern.artisam.xyz/docs/reference/metrics/ — index of every page: https://lantern.artisam.xyz/docs/llms.txt

# Metrics

The Statement of Work's §6.3 targets, against actuals read from the raw analytics export on a dated snapshot. Numbers are never typed from memory: each row names how it is measured and when it was read.

## How the numbers are measured

Lantern's wallet builds carry **opt-in** usage analytics (off by default; one toggle under Settings → Privacy; delete-my-data on request). Events are enum-only — no amounts, no memos, no keys — under a random install id. Alpha-tester builds may additionally attach the wallet's public address, which is what makes a "unique wallet" countable; installs with no address are counted as installs, not wallets. The Lantern API stores the events; the snapshots below are read from its raw export (which, unlike the dashboard, also counts installs with no wallet address).

| Metric | Measured as |
|---|---|
| Transactions scanned end-to-end | Count of `tx_scanned` events across all installs in the window |
| Unique wallets that ran a scan | Distinct wallet addresses with at least one `tx_scanned` event in the window |
| Transactions signed | Count of `tx_signed` events (context only; not an SOW target) |
| Download intents | Clicks on `/download/android` and `/download/extension` — a server log, not analytics; counts a click, not a completed install (context only) |

## Snapshot

| Metric | Target | At 2026-09-17 (snapshot) | Change | Met |
|---|---|---|---|---|
| Transactions scanned end-to-end | ≥ 60 | 18 | +18 (first data: 16 Sep) | Not yet |
| Unique wallets that ran a scan | ≥ 15 | 4 | +4 | Not yet |
| Addresses reported on-chain | ≥ 20 | no reading yet | — | Not yet |
| On-chain registry executions | ≥ 30 | no reading yet | — | Not yet |
| Transactions signed | — | 6 across 4 wallets | — | — |
| Installs reporting | — | 6 (4 with a wallet address) | — | — |
| Download intents | — | no reading yet (links are live) | — | — |

The download row is the context that makes the wallet numbers legible: *60 clicks, 15 wallets scanning* and *16 clicks, 15 wallets scanning* are very different results, and only the second is a good one. It is a click count from our own redirect links, with no identity and no consent behind it, so it is never joined to the analytics rows — only shown next to them.

The two registry rows are not analytics: *addresses reported* is the registry contract's `count()` (distinct subjects), and *registry executions* is the number of transactions that invoked the contract, both read from the testnet explorer. Neither had a wallet-side path to move it before Deliverable 3 lands the one-click report; the first reading is taken with the Week 3 report. Reports made during the alpha exercises are **seeded testnet entries** (addresses generated for the exercise, two per tester) and are recorded here as such, not as organic community reports.

Snapshot read from the analytics export on 2026-09-17; window 2026-09-16 → 2026-09-17 (the first day the instrumented builds were in testers' hands). The scanner is a library in Week 2 — every scan above came from the alpha wallet's existing review screen. The SOW's counts are expected to move in Weeks 3 and 4, when the D2 scanner sits in the wallet's pre-sign review (D3) and a public playground opens (D4).

## History

| Snapshot | Scanned | Wallets scanned | Signed |
|---|---|---|---|
| 2026-09-17 | 18 | 4 | 6 |

Each weekly report from Week 3 on adds a row.
