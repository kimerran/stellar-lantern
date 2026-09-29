<!--
DRAFT (#191). Not published. Before publishing:
  1. Fill every {{…}} from the final §6.3 snapshot in #190. Copy the numbers and
     the labels exactly as docs/site/reference/metrics.md has them.
  2. Add the walkthrough video URL from #190.
  3. Remove this comment, publish, then record the ≥ 3 cross-post URLs at the
     bottom and on docs/site/deliverables/d4.md.
Only golantern.xyz links. The old domain has no redirect (#173).
-->

# Lantern: check a Stellar transaction before you sign it

Signing a Stellar transaction usually means trusting a string of base64 you can't read. Smart-contract calls make it worse: the wallet shows a function name, and what actually moves is anyone's guess. And when someone finds a scam address, there's been nowhere shared to say so. Every wallet keeps its own list, or none at all.

Over the last four weeks we built Lantern's answer, in the open, as a Stellar Development Foundation **Instawards** project (Philippines chapter).

## What shipped

- **An on-chain scam registry (D1).** A Soroban contract anyone can write to, by paying a small fee to report an address, and anyone can read for free, with no account and no signature. A wallet, a dApp or a script can ask whether an address was reported, by whom, why and how many times.
- **An open-source transaction scanner (D2).** It simulates any Stellar transaction, works out what it would actually move and to whom, checks every counterparty against the registry, and gives a risk verdict plus one plain-language sentence. The verdict comes from deterministic code. The AI only writes the sentence, and it can never change the verdict. MIT-licensed.
- **The scanner inside the Lantern wallet (D3).** It runs on every review in the Chrome extension and the Android app, before you sign. A reported recipient holds the Sign button, a recipient that couldn't be checked never reads as safe, and you can report an address in one tap.
- **A public playground (D4).** The same scanner in a web page, with nothing to install.

## Try it: no install, no key

**[golantern.xyz/demo](https://golantern.xyz/demo/)**

- Paste any Stellar testnet transaction, or compose a payment, and see what Lantern makes of it: what moves, the risk verdict, and a registry check of every address it pays.
- Run the built-in examples. One is a payment to a reported scammer, and it's caught every time, even with the network off.
- Browse the live registry: every reported address, its reason and its status.
- Report an address yourself, signed with your own Stellar wallet. Albedo works in the browser with nothing to install.

It's testnet only, and nothing on the page moves real funds.

## Watch the walkthrough

{{3-minute walkthrough video URL, from #190}}

## The numbers

Read from Lantern's opt-in analytics and from the registry contract on {{snapshot date, from #190}}:

| Metric | Result |
|---|---|
| Transactions scanned end-to-end | {{from #190}} |
| Unique wallets that ran a scan | {{from #190}} |
| Addresses reported on-chain | {{from #190}} |
| On-chain registry executions | {{from #190}} |

Scans on the playground count toward the first row only when a visitor scanned a transaction they brought themselves. Clicks on the built-in examples are counted separately and never added in. How each number is measured: [metrics.md](https://github.com/kimerran/stellar-lantern/blob/main/docs/site/reference/metrics.md).

## Don't take our word for it

- **The registry contract:** [`CBJWD6SA…G623F` on stellar.expert](https://stellar.expert/explorer/testnet/contract/CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F), with every report and status change in its history.
- **The contract's WASM hash:** `40fd37718c3fbc7f849c4d414364cdd86c01b4db9ab86be9099007ba5be23783`. It is published in the [README](https://github.com/kimerran/stellar-lantern#testnet-smart-contracts), and a fresh build of the source reproduces it.
- **The code**, MIT-licensed: [github.com/kimerran/stellar-lantern](https://github.com/kimerran/stellar-lantern). The scanner's test suite runs entirely offline, against recorded testnet data.
- **The evidence** for each deliverable, clause by clause against the grant's statement of work: [docs/site/deliverables](https://github.com/kimerran/stellar-lantern/tree/main/docs/site/deliverables).

## Join the alpha

Lantern's wallet is in a testnet alpha on Chrome and Android. [Join the testers' group on WhatsApp](https://lantern-api-production-3fad.up.railway.app/join?src=launch), or follow [@lanternwallet](https://x.com/lanternwallet).

## Thanks

To the Stellar Development Foundation's **Instawards** program and the **Philippines chapter**, who made these four weeks possible, and to the alpha testers who broke things so strangers wouldn't.

---

### Cross-posts

<!-- Record each live URL here and on docs/site/deliverables/d4.md (#191 needs ≥ 3). -->
- X: {{URL}}
- Stellar developer Discord: {{URL}}
- {{third channel: LinkedIn, the Stellar community forum, or dev.to / Medium}}: {{URL}}
