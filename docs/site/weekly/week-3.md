---
title: Week 3 — 21–27 Sep
---
# Week 3 — 21–27 September 2026 · D3, scanner in the wallet

## Summary

Deliverable 3 shipped: the D2 scanner now runs in the Lantern wallet's review before every signature, on the Chrome extension and on Android. Its three slices merged on 21–22 September: the six-stage pipeline in every review screen, a one-tap report to the on-chain registry, and a re-check just before submit that catches anything that changed since the review. A QA pass on the 22 September build filed five defects; all five were fixed and shipped in **0.3.0 on 25 September**, and a re-test on 0.3.0 left two open. Around it, the release process was rebuilt so every build has one version number, publishes checksums, and (from 0.3.0) is signed with one persistent key, so Android updates install in place. The product site moved to **golantern.xyz**. The D3 screen recording and the QA sign-off are still pending.

## Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-09-21 | D3 manual test plan | [`72427bf`](https://github.com/kimerran/stellar-lantern/commit/72427bf) |
| 2026-09-21 | The scanner pipeline in the wallet's pre-sign review, on every signing screen | [`16dba96`](https://github.com/kimerran/stellar-lantern/commit/16dba96) |
| 2026-09-21 | One-tap report of a counterparty to the on-chain registry | [`a6f6aa9`](https://github.com/kimerran/stellar-lantern/commit/a6f6aa9) |
| 2026-09-21 | Alpha tester guide | [`0da5e48`](https://github.com/kimerran/stellar-lantern/commit/0da5e48), [`3118c86`](https://github.com/kimerran/stellar-lantern/commit/3118c86) |
| 2026-09-22 | Re-simulate and re-screen immediately before submit | [`f297f06`](https://github.com/kimerran/stellar-lantern/commit/f297f06) |
| 2026-09-22 | Release builds published with checksums; download endpoints with download monitoring | [`9e67da4`](https://github.com/kimerran/stellar-lantern/commit/9e67da4), [`8fddd5e`](https://github.com/kimerran/stellar-lantern/commit/8fddd5e) |
| 2026-09-22 | Mainnet reviews never claim a registry check | [`8074319`](https://github.com/kimerran/stellar-lantern/commit/8074319) |
| 2026-09-23 | One version number per release, enforced by a release gate | [`3403998`](https://github.com/kimerran/stellar-lantern/commit/3403998), [`8902ac7`](https://github.com/kimerran/stellar-lantern/commit/8902ac7) |
| 2026-09-23 | The product site moves to golantern.xyz; downloads, claims and credits brought up to date | [`4b670f2`](https://github.com/kimerran/stellar-lantern/commit/4b670f2), [`30c4b25`](https://github.com/kimerran/stellar-lantern/commit/30c4b25), [`f2b2c79`](https://github.com/kimerran/stellar-lantern/commit/f2b2c79), [`331f73c`](https://github.com/kimerran/stellar-lantern/commit/331f73c) |
| 2026-09-24 | QA fixes: an unverified recipient needs a second confirm; the report needs an explicit reason; the AI sentence never says "blocked"; one retry before a registry read answers "unknown"; the Android Sign button stays above the navigation | [`8a3a8fa`](https://github.com/kimerran/stellar-lantern/commit/8a3a8fa), [`f9753b7`](https://github.com/kimerran/stellar-lantern/commit/f9753b7), [`51fe25b`](https://github.com/kimerran/stellar-lantern/commit/51fe25b), [`ae37c6b`](https://github.com/kimerran/stellar-lantern/commit/ae37c6b), [`f78dd3f`](https://github.com/kimerran/stellar-lantern/commit/f78dd3f) |
| 2026-09-24 | Homepage: the walkthrough video, slideshows, and joining the alpha through the testers' group | [`1d8b824`](https://github.com/kimerran/stellar-lantern/commit/1d8b824), [`fa3990a`](https://github.com/kimerran/stellar-lantern/commit/fa3990a), [`d8bf0d1`](https://github.com/kimerran/stellar-lantern/commit/d8bf0d1), [`6432ec1`](https://github.com/kimerran/stellar-lantern/commit/6432ec1) |
| 2026-09-24 | One persistent APK signing key, so updates install in place | [`c49d4c2`](https://github.com/kimerran/stellar-lantern/commit/c49d4c2) |
| 2026-09-24 | Release 0.3.0 | [`1ab2ab6`](https://github.com/kimerran/stellar-lantern/commit/1ab2ab6) |
| 2026-09-25 | The wallet ships its own fonts: nothing loaded from Google, icons render offline | [`3fdc899`](https://github.com/kimerran/stellar-lantern/commit/3fdc899) |
| 2026-09-25 | Telemetry records why a registry read came back "unknown" | [`52668c6`](https://github.com/kimerran/stellar-lantern/commit/52668c6) |

## Statement of Work progress

| SOW clause | Deliverable | Status | Evidence |
|---|---|---|---|
| The scanner in the wallet's pre-sign review: summary, verdict and registry screening | D3 | Evidenced | [D3 page](/docs/deliverables/d3/) |
| A one-click report to the on-chain registry | D3 | Evidenced | Report transactions in the [registry's history](https://stellar.expert/explorer/testnet/contract/CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F) |
| §3.9 — re-check immediately before submit | D3 | Evidenced | [D3 page](/docs/deliverables/d3/) |
| §6.1 — installable wallet build | D3 | Built and published; the website's download links caught up on 30 September (0.4.3) | [`/download/checksums`](https://lantern-api-production-3fad.up.railway.app/download/checksums) |
| §6.1 — screen recording | D3 | Pending | — |
| §6.1 — QA sign-off | D3 | Executed; two defects open; not signed off | [D3 test plan](https://github.com/kimerran/stellar-lantern/blob/main/docs/qa/d3-wallet-integration-test-plan.md) |

## Evidence added

| Item | Type | Link |
|---|---|---|
| D3 manual test plan | QA | [`docs/qa/d3-wallet-integration-test-plan.md`](https://github.com/kimerran/stellar-lantern/blob/main/docs/qa/d3-wallet-integration-test-plan.md) |
| Wallet builds with checksums | Release | [`/download/checksums`](https://lantern-api-production-3fad.up.railway.app/download/checksums) |
| The product site | Site | [golantern.xyz](https://golantern.xyz/) |

## Metrics

See [Metrics](/docs/reference/metrics/). Wallet scans from the pre-sign review count toward §6.3 from this week.

## Decisions

- **The wallet advises and gates; it never blocks.** A high-risk verdict holds the Sign button until the user deliberately confirms, and the AI sentence is never allowed to say a transaction was blocked.
- **An unreadable registry is never read as clean.** A recipient that couldn't be checked needs a second, deliberate confirm.
- **One version number per release**, from one place, with a gate that refuses a release whose version already shipped.
- **The product site is golantern.xyz**; the old domain is retired with no redirect.

## Issues found and fixed

- **An unverified recipient could be signed in one tap.** It now needs a second confirm.
- **The report sheet pre-selected a reason.** The user must now choose one.
- **The AI sentence could say a transaction was "blocked"** on a review the user could still sign. It no longer can.
- **The registry read intermittently answered "couldn't be reached".** One retry now runs before answering "unknown"; the re-test on 0.3.0 still saw it twice, so telemetry now records why, and diagnosis continues.
- **On Android, the review's Sign button could sit under the bottom navigation.** It now stays above it.

Still open from the re-test on 0.3.0: the intermittent registry read (being diagnosed), and Android password fields exposed to the accessibility tree (needs a device to diagnose).

## Maintenance

- Each Android release was signed with a new throwaway key, so updates couldn't install over the previous one. From 0.3.0, one persistent key signs every release.
- The wallet's fonts ship in the build instead of loading from Google Fonts.

## Next week

Deliverable 4: the public playground.
