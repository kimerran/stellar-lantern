> Markdown twin of https://golantern.xyz/docs/weekly/week-4/ — index of every page: https://golantern.xyz/docs/llms.txt

# Week 4 — 28 September – 4 October 2026 · D4, public demo

> **In progress.** This report covers 28–30 September and is updated as the week closes. The walkthrough recording, the two transaction hashes, the non-team QA sweep and the launch post are still to come.

## Summary

Deliverable 4's playground is live at [golantern.xyz/demo](https://golantern.xyz/demo/): the D2 scanner in a web page anyone can open, with no wallet, no install and no key. A visitor can paste or compose a testnet transaction and see its effects, verdict, plain-language summary and registry screening; run six seeded examples, including a payment to a reported scammer that is caught every time, even offline; browse the live registry; and report an address, signed by their own Stellar wallet. Nineteen merges built it in three days, shipped as four releases (0.4.0, 0.4.1, 0.4.2 and 0.4.3, the last fixing two offline findings from QA), and it reached the public site on 30 September. A fifth release that week, 0.5.0, is wallet-only (scanning a QR code on Android) and not part of D4. Around it: a manual test plan written for a reviewer outside the team, honest demo analytics that never count an example click as a scan, a separate AI budget so public traffic can't use up the wallet's, the D3 and D4 evidence pages, a reviewer packet for rebuilding the contract from source, and the walkthrough's runbook. What remains needs people: the recording, a report filed from the live page and an admin status change (the two transaction hashes), the QA sweep, and the launch.

## Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-09-28 | Playground scaffold: a static page at `/demo/` built from the scanner package, with a drift-checked build | [`dc5159b`](https://github.com/kimerran/stellar-lantern/commit/dc5159b) |
| 2026-09-28 | Paste a transaction or compose a payment, and run the live pipeline | [`d550cab`](https://github.com/kimerran/stellar-lantern/commit/d550cab) |
| 2026-09-28 | Six seeded examples, live first, with a visible fallback to the recording; a new signer-takeover fixture | [`cf9a510`](https://github.com/kimerran/stellar-lantern/commit/cf9a510), [`a3cebdf`](https://github.com/kimerran/stellar-lantern/commit/a3cebdf) |
| 2026-09-28 | A live registry panel, read from ledger entries without an account | [`a38a5a0`](https://github.com/kimerran/stellar-lantern/commit/a38a5a0) |
| 2026-09-28 | D4 manual test plan, written for a reviewer outside the team | [`2cb9b47`](https://github.com/kimerran/stellar-lantern/commit/2cb9b47) |
| 2026-09-29 | Playground analytics: example clicks counted apart from visitors' own scans | [`8181e75`](https://github.com/kimerran/stellar-lantern/commit/8181e75), [`f4d43b4`](https://github.com/kimerran/stellar-lantern/commit/f4d43b4) |
| 2026-09-29 | Release 0.4.0: the playground | [`9954062`](https://github.com/kimerran/stellar-lantern/commit/9954062) |
| 2026-09-29 | Report an address from the playground, signed by the visitor's own wallet | [`65e25df`](https://github.com/kimerran/stellar-lantern/commit/65e25df) |
| 2026-09-29 | The AI summary on the playground, on its own daily budget; the privacy policy updated | [`871cc4f`](https://github.com/kimerran/stellar-lantern/commit/871cc4f) |
| 2026-09-29 | Release 0.4.1 | [`d8b4d5b`](https://github.com/kimerran/stellar-lantern/commit/d8b4d5b) |
| 2026-09-29 | Launch post: draft | [`ceec8c7`](https://github.com/kimerran/stellar-lantern/commit/ceec8c7) |
| 2026-09-29 | Evidence site: the D4 page; a reviewer packet, *Verify it yourself* | [`0ba2ee5`](https://github.com/kimerran/stellar-lantern/commit/0ba2ee5), [`08ca298`](https://github.com/kimerran/stellar-lantern/commit/08ca298) |
| 2026-09-29 | After a report, scanning the same payment again reads the registry afresh | [`1a9aae5`](https://github.com/kimerran/stellar-lantern/commit/1a9aae5) |
| 2026-09-29 | The walkthrough's runbook, shot list and script | [`acb7834`](https://github.com/kimerran/stellar-lantern/commit/acb7834), [`eebbbd5`](https://github.com/kimerran/stellar-lantern/commit/eebbbd5) |
| 2026-09-29 | Release 0.4.2 | [`8477fe7`](https://github.com/kimerran/stellar-lantern/commit/8477fe7) |
| 2026-09-30 | 0.4.1 and 0.4.2 published to the public site | — |
| 2026-09-30 | Release 0.4.3: offline, the playground never reads clean or claims a live answer | [`25d5a65`](https://github.com/kimerran/stellar-lantern/commit/25d5a65) |
| 2026-09-30 | The website's download links serve the current build (0.4.3) | [`v0.4.3-testnet.14`](https://github.com/kimerran/stellar-lantern/releases/tag/v0.4.3-testnet.14) |
| 2026-09-30 | Android: scan a QR code to fill the Send recipient | [`6879df9`](https://github.com/kimerran/stellar-lantern/commit/6879df9) |
| 2026-09-30 | Release 0.5.0, published to the website's download links | [`ea94bfc`](https://github.com/kimerran/stellar-lantern/commit/ea94bfc), [`v0.5.0-testnet.15`](https://github.com/kimerran/stellar-lantern/releases/tag/v0.5.0-testnet.15) |

## Statement of Work progress

| SOW clause | Deliverable | Status | Evidence |
|---|---|---|---|
| §4.1 — a public testnet playground anyone can use | D4 | Evidenced | [golantern.xyz/demo](https://golantern.xyz/demo/) |
| §4.1 — paste or compose a transaction; summary, verdict and blacklist screening live | D4 | Evidenced | The live page |
| §4.1 — a pre-seeded malicious example, caught on demand | D4 | Evidenced | Example 2 reads high risk, reported, live and offline |
| §5.1 — report an address from the demo | D4 | Built; first live report pending | Filed from the live playground by the QA reviewer during the re-test, against a never-reported address |
| §6.1 — the /demo URL | D4 | Evidenced | [golantern.xyz/demo](https://golantern.xyz/demo/) |
| §6.1 — testnet transaction hashes for a report and a status update | D4 | Pending | The report comes from the QA re-test; the status update needs the admin key |
| §6.1 — the 3-minute captioned walkthrough | D4 | Pending | [Runbook and script](https://github.com/kimerran/stellar-lantern/blob/main/docs/evidence/d4/walkthrough.md) ready |
| §6.1 — the launch post, in the repository and cross-posted | D4 | Draft | [Draft](https://github.com/kimerran/stellar-lantern/blob/main/docs/launch/lantern-instawards-launch.md) |
| §5.1 — a QA sweep by a non-team reviewer | D4 | Plan written | [Test plan](https://github.com/kimerran/stellar-lantern/blob/main/docs/qa/d4-playground-test-plan.md); reviewer named (AJ Maranan), sweep scheduled for the re-test |

## Evidence added

| Item | Type | Link |
|---|---|---|
| The public playground | Live URL | [golantern.xyz/demo](https://golantern.xyz/demo/) |
| D4 evidence page | Page | [D4 — Public demo](/docs/deliverables/d4/) |
| D3 evidence page, brought up to date | Page | [D3 — Scanner in the wallet](/docs/deliverables/d3/) |
| Reviewer packet | Page | [Verify it yourself](/docs/reference/verify/) |
| D4 manual test plan | Document | [`docs/qa/d4-playground-test-plan.md`](https://github.com/kimerran/stellar-lantern/blob/main/docs/qa/d4-playground-test-plan.md) |
| Walkthrough runbook, shot list and script | Document | [`docs/evidence/d4/walkthrough.md`](https://github.com/kimerran/stellar-lantern/blob/main/docs/evidence/d4/walkthrough.md) |

## Metrics

Registry, read from the ledger on 30 September: **19 addresses reported, 30 reports filed**. Usage figures and the final §6.3 snapshot are on [Metrics](/docs/reference/metrics/) once taken.

## Decisions

- **Reporting from the playground is signed by the visitor's own wallet** (Albedo, Freighter, xBull or LOBSTR), not by Lantern's. A web page can't reach the Lantern extension, and a bridge into it would be exactly the surface wallet phishing attacks. Albedo runs in the browser, so reporting still needs nothing installed.
- **The playground's AI summaries have their own daily budget**, so public traffic can never use up the wallet's.
- **An example click is never counted as a scan.** Only a visitor scanning their own pasted or composed transaction counts toward §6.3's "transactions scanned end-to-end"; example clicks are reported beside it.
- **No shortcut for our own contract.** A report from the playground is scanned like any other transaction before the wallet signs it.

## Issues found and fixed

- **A slow example could overwrite a newer result** when two were clicked quickly. Only the last click's result is shown now.
- **The report could have submitted a different transaction** from the one Lantern checked, if a wallet connector returned one. The signed transaction must now match the scanned one exactly.
- **After a report, scanning the same payment again** could still say "not in the registry" for up to a minute, from a cache. A report now clears it.
- **The xBull connector pulled in 740 KB it never used.** Its chunk is now 68 KB, and every wallet connector loads only when a visitor opens the wallet list.
- **Icons showed as their names** on the first playground build. The icon style now lives with the font every page loads.

## Maintenance

- The website's download links served build 0.2.0 until 30 September, when 0.4.3 was published to them by hand, checked against its checksums and the Android release key; 0.5.0 followed the same day, the same way. Publishing each new release to them automatically is still to set up.
- The dependency lockfile is written with the npm version CI runs.

## Next week

This is the sprint's last week. To close it: the first report from the live page (filed during the QA re-test), the captioned walkthrough, the admin status change, the non-team QA sweep, the final §6.3 snapshot, the launch post with at least three cross-posts, and the evidence handoff to the Chapter Lead.
