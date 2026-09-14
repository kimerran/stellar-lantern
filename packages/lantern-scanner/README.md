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

## The six-stage pipeline (#51)

Alongside the synchronous `scan()` the wallet calls today, the package exports
the async pipeline every later D2 slice builds into:

```
ScanRequest → ingest → auth → effects → screen → verdict → explain → ScanResult
```

```ts
import { runPipeline } from '@lantern/scanner';

const result = await runPipeline(
  { xdr, networkPassphrase, context },
  {
    simulate: createRpcSimulator({ rpcUrl: 'https://soroban-testnet.stellar.org' }), // #52
    isFlagged: (address) => registry.isFlagged(address), // true | false | null (#57)
    explain: modelExplainer, // ({ verdict, effects }) => Promise<string> (#59)
  },
);
result.risk; // 'low' | 'medium' | 'high'
result.explanation; // prose — and nothing else the explainer returned
```

Each stage (`ingest`, `auth`, `effects`, `screen`, `buildVerdict`,
`explainRulesBased`) is exported and testable on its own; `runPipeline` is the
only thing that knows the order. Everything external is injected through
`PipelineDeps`, so the suite runs entirely from `fixtures/`.

**The invariant.** `buildVerdict` is the only constructor of a `Verdict`; the
type is deeply `readonly` and the object is `Object.freeze`d recursively
before stage 6 sees it. The explainer's signature is
`({ verdict: Readonly<Verdict>, effects }) => Promise<string>` — it returns a
string, never a verdict. The orchestrator copies `risk` / `action` /
`reasons` from the frozen verdict; a non-string, empty or thrown explainer
result — or one that has not settled within `explainTimeoutMs` (default
5 s) — is replaced by the rules-based sentence (`explanationSource:
'fallback'`) and can reach no field but `explanation`. The `EffectSet` the
explainer receives is deep-frozen too, so it cannot corrupt the stage-3
output `ScanResult` carries. The AI layer cannot change risk by
construction, not by policy.

### Stage 1 — Ingest (#52)

`ingest` decodes the XDR and, for a Soroban transaction, runs the injected
`simulate` and normalises the raw `simulateTransaction` body into one
`SimulationResult`: `returnValue` (base64 ScVal), `auth` entries, `footprint`
(`readOnly` / `readWrite` as base64 `LedgerKey` XDR, decoded from
`transactionData`), `events` (base64 `DiagnosticEvent`), `latestLedger` and,
when present, `restorePreamble`. Classic transactions skip simulation.

`createRpcSimulator({ rpcUrl, timeoutMs, attempts, backoffMs, fetchImpl,
sleep })` is the client: every attempt is bounded by a deadline (default 8 s),
transient failures — network error, 5xx, 429, timeout — retry with
exponential backoff (default 3 attempts from 250 ms), a definite 4xx does
not. It throws `RpcError` with `kind: 'timeout' | 'transport' | 'malformed'`
so the verdict can say what actually happened. The wallet's own
`src/core/stellar/soroban.ts` client and its callers are unchanged.

**Fail-closed, per mode.** Every way stage 1 can fail is a distinct
high-severity reason and `action: 'block_confirm'` — never a quiet `low`:

| `SimulationResult.failure` | reason code | what the user is told |
|---|---|---|
| `undecodable` | `undecodable` | couldn't read the transaction |
| `simulation_unavailable` | `simulation_unavailable` | couldn't simulate (no RPC wired) |
| `rpc_timeout` | `rpc_timeout` | the network didn't answer in time — try again |
| `rpc_transport` | `rpc_unreachable` | couldn't reach the network — a connection problem, not a verdict |
| `simulation_malformed` | `simulation_malformed` | the network's answer couldn't be read |
| `simulation_reverted` | `simulation_reverted` | this transaction would fail on-chain |

**The third answer.** A simulation that carries `restorePreamble` means the
call touches archived ledger state; the result is `outcome: 'unknown'` (not
`ok`, not `failed`) and the verdict is `high` with `state_archived` — the
same posture `docs/blacklist-registry.md` documents for the hot read. An
authorisation entry the scanner cannot parse also fails closed
(`auth_unreadable`).

**What is skeleton.** The stage *bodies* are interim: `auth` parses the
`SorobanAuthorizationEntry` tree structurally (contract, function, children)
but attaches no semantics (`analyzed: false`, #53); `effects` maps decoded ops
to coarse kinds and reports `coverage: 'partial'` whenever a contract call is
present (#54–#56); `screen` defaults to the demo list (#57 injects the D1
registry); `buildVerdict` reuses today's `scan()` heuristics plus the
pipeline's own fail-closed and screening reasons (#58 is the real risk core).
`signals[]` on the verdict is the audit trail of what each stage evaluated.

### Fixture corpus

`fixtures/*.json` — one file per case, each with real testnet XDR and, for
Soroban cases, the **raw** `simulateTransaction` body as the RPC returned it:
classic payment, path payment, SAC `transfer`, SEP-41 `approve`, a Blend
`submit` whose auth tree nests a `transfer` sub-invocation, a call to an
undeployed contract, and malformed XDR. `archived-state.json` is marked
`synthetic: true`: it is the real `sac-transfer` recording with a
`restorePreamble` added, because testnet had no archived entry to record
against. Tests load them through Vite
(`import.meta.glob`) and never open a socket. Re-record after a testnet reset
with `node packages/lantern-scanner/fixtures/record.mjs` (needs a funded
source account; nothing is signed or submitted).

## What it does **not** do (yet)

Be honest with users about this — the SOW's six-stage pipeline lands in
later D2 slices (#51–#59), and none of it is here today:

- **No semantic `SorobanAuthorizationEntry` walk.** The pipeline parses the
  tree's shape and counts nested invocations, but does not yet say which of
  them move money or whose authorisation they consume (#53). `scan()` flags
  `invokeHostFunction` as a contract call and nothing more.
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
src/pipeline.ts   the six stages + runPipeline (#51)
src/rpc.ts        simulateTransaction client: deadline, backoff, RpcError (#52)
fixtures/         offline corpus: XDR + recorded RPC bodies, and record.mjs
```

## Tests

Live in the repo's `tests/` (`scanner-pipeline.test.ts`, `scanner-ingest.test.ts`, `scan.test.ts`, `swap-scan.test.ts`,
`guardians.test.ts`, `tx.test.ts`, `invoke.test.ts`, `blend*.test.ts`) and run
with `npm test` from the repo root — no network required.

## License

MIT — see [LICENSE](./LICENSE).
