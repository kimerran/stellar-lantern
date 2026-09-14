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

**What is skeleton.** The stage *bodies* after 3b are interim: a contract call
that is not a token function is still a coarse `contract_call` row with
`coverage: 'partial'` (#56); `screen` defaults to the demo list (#57 injects the D1
registry); `buildVerdict` reuses today's `scan()` heuristics plus the
pipeline's own fail-closed and screening reasons (#58 is the real risk core).
`signals[]` on the verdict is the audit trail of what each stage evaluated.

### Stage 2 — Auth (#53)

`auth(simulation)` walks every `SorobanAuthorizationEntry` the simulation
requires and answers *who is authorising what*:

- **Credentials** — `{ kind: 'source_account' }` (the transaction source
  signs implicitly) or `{ kind: 'address', address, nonce,
  signatureExpirationLedger }` (a specific address must sign this entry —
  exactly what the user is approving).
- **Root + recursive sub-invocations** — `entries[]` keeps the tree
  (`AuthNode`: `kind`, `depth`, `contractId`, `functionName`, `args`,
  `children`); `calls[]` is its pre-order flattening with `entryIndex`,
  `path` and `depth`, so stage 3 computes effects from *every* authorised
  call. A `transfer` two levels down is a row like any other. `nestedCount`
  and `maxDepth` summarise it.
- **Arguments** are decoded losslessly by `decodeScVal` (`src/scval.ts`):
  addresses as `G…`/`C…`, all integers as decimal strings (`i128` and
  `u256` don't fit a JS number), symbols/strings as text, bytes as hex,
  `Vec`/`Map` structurally, and anything without a human form kept as its
  base64 XDR under `{ type: 'opaque' }`.
- **Fail closed** — an entry that cannot be parsed is counted in
  `unparseable`, the good entries are still walked, and the verdict is
  `high` / `block_confirm` with `auth_unreadable`. An empty `calls` list
  next to `unparseable > 0` must never be read as "this call authorises
  nothing" — that is the most dangerous wrong answer available.

### Stage 3a — Effects: classic operations (#54)

`effects(simulation, authTree, request)` turns the value-moving classic ops
— `payment`, `createAccount`, `pathPaymentStrictSend`,
`pathPaymentStrictReceive`, `accountMerge` — into a net-effect object:

- `deltas[]` — one `AssetDelta` per balance movement: `address`,
  `direction`, `asset` (`code` + `issuer`, native XLM has none), `amount`
  as an exact 7-decimal string, `bound`, `opIndex`. `bound` says what the
  number is: `exact`, `max` (strict-receive: "you may spend up to"), `min`
  (strict-send: "you receive at least"), or `total` (accountMerge: the
  whole balance, `amount: null` — never a fake zero).
- `net[]` — per (address, asset) aggregate across every op: `in` / `out`
  sums plus `inAtLeast` / `outUpTo` / `outIsTotal` flags. A three-op
  transaction nets per address; op-level `source` overrides are honoured.
- `closes[]` — accounts an `accountMerge` deletes, with the merge target.
- `contractsTouched[]` — every contract id from the op and the auth tree.
- `approvals[]` — filled by 3b.

Arithmetic goes through `decimal.ts` (`toStroops` / `fromStroops` /
`addAmounts`) — bigint stroops end to end, no float anywhere in the effect
path.

### Stage 3b — Effects: SEP-41 / SAC token-interface calls (#55)

`token.ts` recognises the five value-moving token functions — `transfer`,
`approve`, `burn`, `mint`, `clawback` — by **exact name and exact argument
shape** in the flattened auth tree, at every depth. `transfer_from`,
`transferAll` or a 2-arg `transfer` are not "probably a transfer"; they fall
through to 3c. A recognised call becomes `AssetDelta`s (`source: 'token'`,
with `raw` = the i128 base units and `depth`) or, for `approve`, an
`Approval { owner, spender, asset, amount, amountScaled, expirationLedger,
unlimited, depth }`.

**Metadata.** `PipelineDeps.resolveToken` answers code / decimals / issuer
per contract id; wrap it in `createTokenMetadataCache`. The live one,
`createRpcTokenResolver({ rpcUrl })`, reads the contract's instance entry
through `getLedgerEntries` — no source account, no signature — and parses
the SAC's `METADATA` / `AssetInfo`. A SEP-41 token that does not use the
SAC's storage layout, or any RPC failure, resolves to `null`, and the delta
then carries the raw integer with `asset.decimals: null` — the explicit
"decimals unknown" marker. **Never a guessed 7.** The native SAC is `XLM`
at 7 decimals without a lookup.

**Amounts are i128** and stay `BigInt` end to end; `scaleAmount` renders
at the boundary only. Aggregation (`net[]`) sums base units and renders once,
per the asset's decimals; a classic XLM payment and a native-SAC `transfer`
net into the same row.

**`approve` is the risk-bearing one.** An allowance ≥ 2^100 base units
(`UNLIMITED_ALLOWANCE_THRESHOLD`) is `unlimited` and raises a `high`
`unlimited_allowance` reason; one expiring more than ~a year of ledgers out
(`LONG_LIVED_ALLOWANCE_LEDGERS`), or whose horizon cannot be bounded, adds
a `long_lived_allowance` signal. Both are in `signals[]` for stage 5.

### Fixture corpus

`fixtures/*.json` — one file per case, each with real testnet XDR and, for
Soroban cases, the **raw** `simulateTransaction` body as the RPC returned it:
classic payment, path payment (strict-send and strict-receive), account
merge, a three-op transaction, SAC `transfer`, SEP-41 `approve`, a Blend
`submit` whose auth tree nests a `transfer` sub-invocation, a call to an
undeployed contract, and malformed XDR. Two files are marked
`synthetic: true`: `archived-state.json` is the real `sac-transfer`
recording with a `restorePreamble` added (testnet had no archived entry to
record against), `deep-auth.json` is the `nested-subinvocation`
recording with its auth entries replaced by a three-level tree under address
credentials plus a source-account entry, built with SDK constructors by
`make-deep-auth.mjs` (no deployed contract we use asks the user to authorise
a call two levels down), and `token-admin.json` is the `sac-transfer`
recording with `mint` / `burn` / `clawback` sub-invocations plus the
look-alikes that must not be recognised (`make-token-admin.mjs`; the USDC
SAC's admin is not ours). The bytes are real XDR; the scenarios are not
recordings. `token-metadata.json` is a real `getLedgerEntries` recording of
the XLM and USDC SAC instance entries (`record-token-metadata.mjs`). Tests load them through Vite
(`import.meta.glob`) and never open a socket. Re-record after a testnet reset
with `node packages/lantern-scanner/fixtures/record.mjs` (needs a funded
source account; nothing is signed or submitted). The `classic-*` files need
no network and are rebuilt by `make-classic.mjs`.

## What it does **not** do (yet)

Be honest with users about this — the SOW's six-stage pipeline lands in
later D2 slices (#51–#59), and none of it is here today:

- **Non-token contract calls are not decoded.** A call that is not one of
  the five token functions is a coarse `contract_call` row; the raw decoded
  call with its "unverified contract" label is #56. `scan()` still flags
  `invokeHostFunction` as a contract call and nothing more.
- **Metadata for non-SAC SEP-41 tokens.** The resolver reads the SAC storage
  layout; a custom token that keeps its metadata elsewhere resolves to
  `null` (raw amounts, `decimals: null`) rather than being probed with a
  simulated `decimals()` call.
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
src/scval.ts      lossless ScVal → DecodedScVal rendering (#53)
src/effects.ts    classic ops → AssetDelta[] + per-address NetDelta[] (#54)
src/decimal.ts    exact 7-decimal arithmetic over bigint stroops (#54)
src/token.ts      SEP-41 / SAC recognition, metadata resolver + cache, approvals (#55)
fixtures/         offline corpus: XDR + recorded RPC bodies, and record.mjs
```

## Tests

Live in the repo's `tests/` (`scanner-pipeline.test.ts`, `scanner-ingest.test.ts`, `scanner-auth.test.ts`, `scanner-effects.test.ts`, `scanner-token.test.ts`, `scan.test.ts`, `swap-scan.test.ts`,
`guardians.test.ts`, `tx.test.ts`, `invoke.test.ts`, `blend*.test.ts`) and run
with `npm test` from the repo root — no network required.

## License

MIT — see [LICENSE](./LICENSE).
