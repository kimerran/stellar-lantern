> Markdown twin of https://golantern.xyz/docs/ — index of every page: https://golantern.xyz/docs/llms.txt

# Lantern — Instawards Phase 1

**Lantern** is a non-custodial Stellar wallet — a Chrome extension and an Android app — with a security layer that reads every transaction *before* it is signed and says, in plain language, what it does, who it pays, and whether that counterparty has been reported. This site is the evidence trail for the four-week Stellar Development Foundation **Instawards** sprint (Philippines chapter): what was promised, what shipped each week, and where a reviewer can verify it independently.

| | |
|---|---|
| Builder | Team Lantern |
| Live site | [golantern.xyz](https://golantern.xyz) |
| Source (MIT) | [github.com/kimerran/stellar-lantern](https://github.com/kimerran/stellar-lantern) |
| Network | Stellar Testnet (`Test SDF Network ; September 2015`) |
| Sprint | 7 September – 4 October 2026, four weeks, Monday–Sunday |

## The four deliverables

| Week | Deliverable | Status |
|---|---|---|
| 1 — 7–13 Sep | [D1 — On-chain blacklist registry](/docs/deliverables/d1/) | Complete |
| 2 — 14–20 Sep | [D2 — Transaction security scanner](/docs/deliverables/d2/) | Complete, recording pending |
| 3 — 21–27 Sep | [D3 — Scanner in the wallet](/docs/deliverables/d3/) | Planned |
| 4 — 28 Sep – 4 Oct | [D4 — Public demo](/docs/deliverables/d4/) | Planned |

## How to read this site

- **Weekly reports** are the progress log: a plain-English summary, the changelog of merged changes, Statement-of-Work progress, evidence added that week, metrics, decisions, issues fixed, maintenance, and what comes next.
- **Deliverables** are the traceability view: for each deliverable, every SOW clause mapped to the change that satisfied it and the public evidence that proves it.
- **Reference** holds the [Evidence index](/docs/reference/evidence/) (every contract id, hash, transaction and artifact in one table — the page to keep open while reviewing), the [Metrics](/docs/reference/metrics/) against the SOW's targets, the [Full changelog](/docs/reference/changelog/), and condensed references for the [scanner package](/docs/reference/scanner/) and the [registry contract](/docs/reference/registry/).
- The [Statement of Work](/docs/sow/) page holds the approved SOW and is never edited; deviations are recorded in the weekly report where they happened.

Every claim on this site links to something public: a commit in the public repository, a page on stellar.expert, a CI run, a recording, a deck slide or a test-plan result. A claim with no link is a bug — please report it.

## For AI agents

Every page has a markdown twin (the *view as markdown* link at the top of each page, or replace the trailing `/` with `.md`; for the home page it is [`/docs/index.md`](/docs/index.md)), and [`/docs/llms.txt`](/docs/llms.txt) indexes all of them. There is no client-side JavaScript; the HTML is complete as served.
