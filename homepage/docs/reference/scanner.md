# Scanner package

> Markdown twin of https://lantern.artisam.xyz/docs/reference/scanner/ — index of every page: https://lantern.artisam.xyz/docs/llms.txt

# Scanner package — `@lantern/scanner`

Condensed from the package's [README](https://github.com/kimerran/stellar-lantern/blob/main/packages/lantern-scanner/README.md), which is the full reference. MIT-licensed; lives at [`packages/lantern-scanner/`](https://github.com/kimerran/stellar-lantern/tree/main/packages/lantern-scanner) and is what the wallet, the QA harness and (in D4) the public playground call.

## What it does

Given an unsigned transaction envelope (XDR), the network passphrase and a little context (the signer's address), `runPipeline` returns a `ScanResult` with a risk level, an action, reasons, an audit trail of signals, the structured effects, the screening result, and one sentence. It never signs and never submits.

## The six stages

| # | Stage | What it produces | Posture |
|---|---|---|---|
| 1 | Ingest | The decoded transaction and, for Soroban calls, the raw simulation from the RPC | Fail-closed: undecodable, unreachable, timed out, malformed, reverted or archived-state all come back as a failure with its cause, never as a clean result |
| 2 | Auth | The `SorobanAuthorizationEntry` tree — every entry, every nested sub-invocation, with depth | A nested call that moves money must never be invisible |
| 3 | Effects | Per-address balance deltas and their aggregate; approvals; account closes; unverified calls; balance changes the simulation observed | Payments and the SEP-41 / SAC interface are decoded exactly; anything else is labelled *unverified — semantics unknown* |
| 4 | Screen | Each counterparty checked against the D1 registry: flagged / clean / unknown, with the entry behind a hit | Unknown (unreachable, timeout, archived) is a warning, never clean |
| 5 | Verdict | `low` / `medium` / `high` → `allow` / `warn` / `block_confirm`, with reasons and a signal trail | Deterministic rules; same input, same answer; carries *effects shown, terms not judged* |
| 6 | Explain | One plain-English sentence | Receives only the frozen verdict and effects — never raw XDR, auth entries or the memo; bounded by a deadline; sanitised; a contradicting answer is discarded for the rules-based sentence. It cannot change the verdict |

## What is covered, and what is not

- **Covered:** classic payment, createAccount, path payments (strict-send and strict-receive, with their min/max bounds), accountMerge (entire balance), setOptions signer changes; SEP-41 / SAC `transfer`, `approve` (allowance and expiry; unlimited allowances flagged), `burn`, `mint`, `clawback`; token metadata resolved from the contract instance so amounts are scaled, or shown raw with "decimals unknown" — never a guessed scale.
- **Not covered (by design in D2):** DeFi-protocol semantics (swaps, lending); any contract call outside the token interface is decoded as far as the bytes allow and labelled unverified. Look-alike names (`transfer_from`, `transferAll`) are not guessed from.

## Running it by hand

```bash
npm run scan -- --file classic-payment              # a corpus fixture, live RPC + registry
npm run scan -- --xdr <base64 envelope>              # any transaction
npm run scan -- --file sep41-approve --json          # the full ScanResult
npm run scan -- --file sep41-approve --no-ai         # rules-based sentence only
npm run scan -- --file sep41-approve --offline       # RPC answered from the recorded corpus
```

The AI sentence is off unless `LANTERN_AI_ENDPOINT` (the Lantern API) or a local key is set, and the output always says which explainer wrote the sentence. `--ai-stub "<text>"` runs a model that always answers `<text>` through the real sanitiser and contradiction guard, so a tester can watch a hostile answer get discarded. Full instructions and every test case: the [manual test plan](https://github.com/kimerran/stellar-lantern/blob/main/docs/qa/d2-transaction-scanner-test-plan.md).

## Tests

The whole suite runs offline against 19 recorded fixtures (real testnet XDR and the raw RPC bodies as returned), so CI needs no RPC, no registry and no model — and no secret. The invariant is pinned from several sides: a type-level test refuses an explainer that returns a verdict; a hostile-model test and a prompt-injection test leave the verdict byte-identical; the harness's `--json` output with and without the model is asserted equal.
