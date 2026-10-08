> Markdown twin of https://golantern.xyz/docs/reference/metrics/ — index of every page: https://golantern.xyz/docs/llms.txt

# Metrics

The Statement of Work's §6.3 targets, against actuals read from the raw analytics export on a dated snapshot. Numbers are never typed from memory: each row names how it is measured and when it was read.

## How the numbers are measured

Lantern's wallet builds carry **opt-in** usage analytics (off by default; one toggle under Settings → Privacy; delete-my-data on request). Events are enum-only — no amounts, no memos, no keys — under a random install id. Alpha-tester builds may additionally attach the wallet's public address, which is what makes a "unique wallet" countable; installs with no address are counted as installs, not wallets. The Lantern API stores the events; the snapshots below are read from its raw export (which, unlike the dashboard, also counts installs with no wallet address).

| Metric | Measured as |
|---|---|
| Transactions scanned end-to-end | Count of `tx_scanned` events across all installs in the window, **plus** demo scans (visitor-supplied) below. Never plus seeded demo scans |
| Demo scans (visitor-supplied) | Count of `demo_scanned` events with `origin` `pasted` or `composed`: a visitor on the public playground scanned a transaction they brought themselves. Counts toward the headline above |
| Demo scans (seeded) | Count of `demo_scanned` events with `origin` `seeded`: one click on a built-in example. Engagement only, reported separately and **never summed into the §6.3 headline**, since sixty clicks on an example would otherwise clear it |
| Unique wallets that ran a scan | Distinct wallet addresses with at least one `tx_scanned` event in the window |
| Transactions signed | Count of `tx_signed` events (context only; not an SOW target) |
| Download intents | Clicks on `/download/android` and `/download/extension` — a server log, not analytics; counts a click, not a completed install (context only) |

The public playground (golantern.xyz/demo) has no install and no consent screen, so it collects less than the wallet: one enum-only `demo_scanned` event per finished scan (risk, action, origin) under a random id that is new on every page load. There is no cookie and no storage, no address, amount or XDR, and never a wallet address. A demo page load is therefore not a person: it is never counted as an install or a wallet, and **unique wallets that ran a scan stays a wallet-side metric**, with nothing inferred from a pasted transaction's accounts.

## Snapshot

| Metric | Target | At 2026-10-08 (snapshot) | Change since 17 Sep | Met |
|---|---|---|---|---|
| Transactions scanned end-to-end | ≥ 60 | 272 (236 in the wallet, 36 visitor scans on the playground) | +254 | Met |
| Unique wallets that ran a scan | ≥ 15 | 58 | +54 | Met |
| Addresses reported on-chain | ≥ 20 | 20 | first reading | Met (see below) |
| On-chain registry executions | ≥ 30 | 35 | first reading | Met |
| Transactions signed | — | 133 across 56 wallets | +127 | — |
| Installs reporting | — | 101 (70 distinct wallet addresses) | +95 | — |
| Demo scans (seeded) | — | 52 (engagement only, not in the headline) | first reading | — |
| Download intents | — | 188 (133 Android, 55 Chrome extension) | first reading | — |

The download row is the context that makes the wallet numbers legible: *60 clicks, 15 wallets scanning* and *16 clicks, 15 wallets scanning* are very different results, and only the second is a good one. It is a click count from our own redirect links, with no identity and no consent behind it, so it is never joined to the analytics rows — only shown next to them.

Installs and wallets differ because one wallet address can report from more than one install: the extension and the phone, or a reinstall. About a third of the installs (34) came from a single campus onboarding session on 2 Oct.

The two registry rows are not analytics: *addresses reported* is the registry contract's `count()` (distinct subjects), and *registry executions* is the number of contract invocations, both read from the testnet explorer. Reports made during the alpha exercises are **seeded testnet entries** (addresses generated for the exercise, two per tester), and the 20 include them, so the reported-addresses target is met on testnet activity, not yet on organic community reports.

Snapshot read on 2026-10-08: the analytics rows from the raw export (all data since the first instrumented build on 16 Sep), the registry rows from stellar.expert, and the download intents from the API's download log (links live since 23 Sep). Every scan above came from the wallet's pre-sign review (Deliverable 3) or the public playground (Deliverable 4).

## History

| Snapshot | Scanned | Wallets scanned | Signed |
|---|---|---|---|
| 2026-09-17 | 18 | 4 | 6 |
| 2026-09-27 | 167 | 26 | 84 |
| 2026-10-04 | 255 | 56 | 126 |
| 2026-10-08 | 272 | 58 | 133 |

The 17 Sep row was read on that day. The later rows were recomputed on 8 Oct from the same export, counting everything up to the end of the day shown (UTC); *Scanned* includes the playground's visitor scans from 30 Sep on.
