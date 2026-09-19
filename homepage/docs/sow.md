> Markdown twin of https://lantern.artisam.xyz/docs/sow/ — index of every page: https://lantern.artisam.xyz/docs/llms.txt

# Statement of Work

> **Placeholder.** The approved Statement of Work document has not yet been attached to this site. When it is, this page will hold it **verbatim** and will never be edited afterwards; any deviation is recorded in the weekly report where it happened, with a link back to the clause.

Until then, the clause labels used in the traceability tables on the deliverable pages follow the section numbers quoted in the project's planning: **§3.9** (security posture: no secrets in the repository; the verdict describes what a transaction does, never whether a trade is fairly priced), **§4.1** (Deliverable 2's definition), **§6.1** (the evidence each deliverable must produce), and **§6.3** (the sprint's success metrics). The deliverable definitions below are the working summaries the team built against, not the SOW text.

## Deliverables as built against

| Deliverable | Week | Working definition | Evidence the SOW asks for (§6.1) |
|---|---|---|---|
| D1 — On-chain blacklist registry | 1 | A Soroban contract where anyone can report a scam address for a fee routed to a treasury, with admin status transitions and public reads | A stellar.expert testnet contract page; the WASM hash published in the README; a sample on-chain report transaction showing the fee routed to the treasury |
| D2 — Transaction security scanner | 2 | "A scanner that simulates any Stellar transaction via RPC, decodes the `SorobanAuthorizationEntry` tree, and screens counterparties against the on-chain registry. Committed coverage: full structured effect-decoding and plain-language explanation for payment operations and token-interface calls (SEP-41 / SAC)" — §4.1 | An MIT-licensed public repository; the scanner suite green in CI, offline; a 90-second recording showing a payment and a token-interface call decoded into structured effects + plain-language summary + risk verdict, plus an "unverified contract" case handled safely; QA sign-off against the manual plan |
| D3 — Scanner in the wallet | 3 | The scanner runs in the wallet's pre-sign review, with registry screening live and the AI sentence served without a key in the client | To be confirmed against the SOW text |
| D4 — Public demo | 4 | A public playground where a visitor can paste a transaction and see the scanner's verdict | To be confirmed against the SOW text |

## Success metrics (§6.3)

| Metric | Target |
|---|---|
| Transactions scanned end-to-end | ≥ 60 |
| Unique wallets that ran a scan | ≥ 15 |

Actuals are tracked on the [Metrics](/docs/reference/metrics/) page from dated dashboard snapshots.
