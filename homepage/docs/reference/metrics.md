> Markdown twin of https://lantern.artisam.xyz/docs/reference/metrics/ — index of every page: https://lantern.artisam.xyz/docs/llms.txt

# Metrics

The Statement of Work's §6.3 targets, against actuals read from the analytics dashboard on a dated snapshot. Numbers are never typed from memory: each row names how it is measured and when it was read.

## How the numbers are measured

Lantern's wallet builds carry **opt-in** usage analytics (off by default; one toggle under Settings → Privacy; delete-my-data on request). Events are enum-only — no amounts, no memos, no keys — under a random install id. Alpha-tester builds may additionally attach the wallet's public address, which is what makes a "unique wallet" countable; installs with no address are counted as installs, not wallets. The Lantern API stores the events and serves the admin dashboard the snapshots below are read from.

| Metric | Measured as |
|---|---|
| Transactions scanned end-to-end | Count of `tx_scanned` events across all installs in the window |
| Unique wallets that ran a scan | Distinct wallet addresses with at least one `tx_scanned` event in the window |
| Transactions signed | Count of `tx_signed` events (context only; not an SOW target) |

## Snapshot

| Metric | Target | At 2026-09-17 (snapshot) | Change | Met |
|---|---|---|---|---|
| Transactions scanned end-to-end | ≥ 60 | 18 | +18 (first data: 16 Sep) | Not yet |
| Unique wallets that ran a scan | ≥ 15 | 4 | +4 | Not yet |
| Transactions signed | — | 6 across 4 wallets | — | — |
| Installs reporting | — | 6 (4 with a wallet address) | — | — |

Snapshot read from the analytics export on 2026-09-17; window 2026-09-16 → 2026-09-17 (the first day the instrumented builds were in testers' hands). The scanner is a library in Week 2 — every scan above came from the alpha wallet's existing review screen. The SOW's counts are expected to move in Weeks 3 and 4, when the D2 scanner sits in the wallet's pre-sign review (D3) and a public playground opens (D4).

## History

| Snapshot | Scanned | Wallets scanned | Signed |
|---|---|---|---|
| 2026-09-17 | 18 | 4 | 6 |

Each weekly report from Week 3 on adds a row.
