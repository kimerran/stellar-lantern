# @lantern/scanner

Lantern's transaction security scanner, extracted from the wallet's
`src/core/scan/` as an MIT-licensed package (Instawards SOW, Deliverable 2,
slice 1 — #50). It takes a transaction XDR **before it is signed**, decodes it
into a structured list of operations, writes a plain-language explanation, and
returns a risk verdict (`low` / `medium` / `high`) with the reasons behind it.

It only **advises**. It never signs, never submits, never talks to the network
on its own. The wallet gates its UI on the verdict; a dApp or CLI can do the
same.

## What it does today

- `decodeTransaction(xdr, networkPassphrase)` — parses a classic or Soroban
  transaction (fee-bump aware) into `DecodedTx` / `DecodedOp[]`. Structured
  fields are filled for: `payment`, `createAccount`, `pathPaymentStrictSend`,
  `pathPaymentStrictReceive`, `accountMerge`, `setOptions` (signer / threshold /
  master-weight changes) and `invokeHostFunction` (contract id, function name,
  raw args). Any other operation type is passed through with its type name only.
- `explainTransaction(tx)` — one-paragraph rules-based summary of the decoded
  transaction (swaps, payments, account merges, signer changes, and a curated
  list of known DeFi function names via `describeDefiFunction`).
- `scan({ xdr, networkPassphrase, context })` — the deterministic verdict:
  reasons such as an unknown contract call, an account merge, a swap whose
  proceeds leave your wallet, a signer/threshold change, a suspicious memo, a
  destination on the reported-address list, and — when the host passes
  `destinationFunded` / `spendableXlm` in `ScanContext` — a brand-new
  destination or a transfer that drains / takes a large share of the balance.
  `ACTION_FOR` maps the risk level to the UI action (`allow` / `warn` /
  `block_confirm`).
- `analyzeMessage(text)` — heuristic paste-to-check classifier for scam
  messages (seed-phrase requests, urgency, fake support, …). Synchronous; never
  stores the text.
- `isReportedAddress` / `DEMO_FLAGGED_ADDRESSES` — the *demo* deny-list. See
  the honesty note below.

## What it does **not** do (yet)

Be honest with users about this — the SOW's six-stage pipeline lands in
later D2 slices (#51–#59), and none of it is here today:

- **No RPC simulation.** The verdict is derived from the XDR alone; nothing is
  simulated, so effects that only appear at execution time are invisible.
- **No `SorobanAuthorizationEntry` tree walk.** A nested sub-invocation that
  moves money is *not* surfaced. `invokeHostFunction` is flagged as a
  contract call and nothing more.
- **No SEP-41 / SAC token-interface decoding.** `transfer`, `approve` and
  friends on a token contract are not turned into structured effects.
- **No on-chain registry screening.** `isReportedAddress` checks a single
  hard-coded demo address (on testnet in every build; elsewhere only when the
  host defines `__FEATURE_DEMO_AFFORDANCES__` as `true`). The D1 blacklist
  registry (`docs/blacklist-registry.md`) is **not** consulted yet — that is
  #57.
- **No AI explanation.** `explainTransaction` is rules-based prose.

## Install / usage

The package is not published to npm (a stretch goal, not committed). Inside
this repo it is resolved through the `@lantern/scanner` alias, wired
identically in `tsconfig.json`, `vite.config.ts`, `vite.config.mobile.ts` and
`vitest.config.ts`:

```ts
import { decodeTransaction, explainTransaction, scan, ACTION_FOR } from '@lantern/scanner';
import { Networks } from '@stellar/stellar-sdk';

const verdict = scan({
  xdr,
  networkPassphrase: Networks.TESTNET,
  context: { network: 'TESTNET', fromAddress: myAddress, destinationFunded: true },
});
console.log(verdict.risk, ACTION_FOR[verdict.risk], verdict.reasons);
console.log(explainTransaction(decodeTransaction(xdr, Networks.TESTNET)));
```

The wallet itself keeps importing from `@core/scan`, which is now a one-line
re-export of this package (`src/core/scan/index.ts`).

### Requirements of the host

- `@stellar/stellar-sdk` ^16 as a peer dependency (XDR parsing, `Networks`).
- A build-time boolean `__FEATURE_DEMO_AFFORDANCES__` (Vite `define`). Lantern
  declares it in `src/feature-flags.d.ts` and sets it from
  `VITE_FEATURE_DEMO_AFFORDANCES`; a consumer outside this repo must define it
  (`false` is the safe value) or the demo-forced-verdict branch will throw a
  `ReferenceError`.
- Nothing else: no network, no DOM, no Node-only APIs. The suite runs offline.

## Layout

```
src/index.ts      public surface — import from here
src/types.ts      DecodedTx / DecodedOp / ScanVerdict / MessageVerdict contracts
src/decode.ts     XDR → DecodedTx
src/explainer.ts  DecodedTx → plain-language paragraph
src/engine.ts     DecodedTx → ScanVerdict (+ the demo deny-list)
src/paste.ts      pasted message → MessageVerdict
src/defi.ts       curated DeFi function-name descriptions
src/format.ts     address / amount display helpers (copied from the wallet so
                  the package has no import back into it)
```

## Tests

Live in the repo's `tests/` (`scan.test.ts`, `swap-scan.test.ts`,
`guardians.test.ts`, `tx.test.ts`, `invoke.test.ts`, `blend*.test.ts`) and run
with `npm test` from the repo root — no network required.

## License

MIT — see [LICENSE](./LICENSE).
