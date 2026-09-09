# Blacklist registry — read paths and testnet deployment

The registry answers one question for wallets: **has this counterparty been
reported?** There are two ways to ask, and they are not interchangeable.

| | Hot read (this doc) | Contract views (#34) |
|---|---|---|
| Mechanism | `getLedgerEntries` on a derived ledger key | `simulateTransaction` against `is_flagged` / `get` / `list` |
| Source account | **none** | conventionally required |
| Signing / fee | **none** | none, but a simulation round-trip |
| Answers | one subject | one subject, or paging, or config |
| Use it for | the per-signature screening path (D2 Screen) | UIs, indexers, anything wanting the whole set |

The hot read is what the scanner's Screen stage runs per counterparty on every
scan, TTL-cached. Simulating once per counterparty is the wrong cost profile for
the critical path, and it demands an account the caller may not have — a visitor
pasting an XDR into the public demo has no key at all.

## Why the hot read exists at all

Nothing about it needs the contract's cooperation. Entries live at
`DataKey::Entry(Address)` in **persistent** storage, and Soroban ledger keys are
deterministic, so any client that knows the contract id and the subject address
can compute exactly where the answer lives and read it. No discovery call, no
index, no backend.

## Deriving the ledger key

Three facts do all the work:

1. The entry is stored under `DataKey::Entry(subject)` — see
   `contracts/blacklist-registry/src/lib.rs`.
2. A `#[contracttype]` enum variant carrying one field encodes as an ScVal
   vector: `[ symbol("Entry"), address(subject) ]`. The symbol is the *variant
   name*, verbatim.
3. That ScVal, plus the contract id and `durability = Persistent`, is a
   `LedgerKey::ContractData`.

```js
import { Address, xdr } from "@stellar/stellar-sdk";

const key = xdr.ScVal.scvVec([
  xdr.ScVal.scvSymbol("Entry"),
  new Address(subject).toScVal(),
]);

const ledgerKey = xdr.LedgerKey.contractData(
  new xdr.LedgerKeyContractData({
    contract: new Address(contractId).toScAddress(),
    key,
    durability: xdr.ContractDataDurability.persistent(),
  }),
);
```

### Worked example

Contract `CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F`,
subject `GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7`:

```
AAAABgAAAAFTYfpAhtxljUyEXStVJrepr4CSWlFIzYV62i5SB+n0bwAAABAAAAABAAAAAgAAAA8A
AAAFRW50cnkAAAAAAAASAAAAAAAAAAABlHJijueOuScU0i0DkJY8JNkn6gCZmUhuiR+sLaqcIQAA
AAE=
```

Reproduce it offline — the derivation touches no network:

```bash
node scripts/hot-read-blacklist-registry.mjs --key-only \
  --contract CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F \
  --subject  GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7
```

## Reading and decoding

`getLedgerEntries(ledgerKey)` returns at most one entry. Nothing back means the
subject was never reported — the common case, and not an error.

### Archived is a third answer, and empty is not a promise

A persistent entry that ages out is **archived**, not deleted. While it is still
returned, `getLedgerEntries` hands it back with a `liveUntilLedgerSeq` that is
behind the response's `latestLedger` — or zero. The RPC reference defines the
field as *"The ledger sequence number of the ledger that the entry will be live
until. May be zero if the entry is no longer live."*
([getLedgerEntries](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries)).
The helper keys off exactly that and reports a **third outcome** —
`status: "unknown"`, `reason: "archived"`, and `flagged: null` rather than
`false` — because answering "not flagged" for a subject whose entry is merely
asleep is the one direction a screening call must not fail in.

Expiry and eviction are separate events, though, and that matters for the empty
case. An entry whose TTL has lapsed stays in the live state until an eviction
scan removes it; only during that window is it returned with a stale
`liveUntilLedgerSeq`. Once evicted it is gone from the live state, and the
`getLedgerEntries` reference does not say whether the RPC then serves it from
the archive — so **an empty result means "no live entry at this key", not
"never reported"**. In practice it is almost always never-reported, and the
helper keeps that path cheap and non-fatal (`status: "not-flagged"`), but its
`reason` says what the read actually established rather than claiming more.

If you need certainty for one subject — before gating a signature on a clean
answer, say — ask the contract views (#46). They see through archival, at the
cost of a simulation. Do not add an archive lookup to the hot path: it would
spend a round-trip on every clean address, which is nearly all of them.

The value decodes to the contract's `Entry` struct. The current shape is **nine**
fields, not the eight in the original schema: `index: u32` was added in #32 so an
entry's insertion ordinal is recoverable from the entry alone (the index slot's
TTL is refreshed alongside the entry, and that needs the ordinal). A decoder
written against the original spec will silently miss it.

| Field | Type | Notes |
|---|---|---|
| `subject` | `Address` | the flagged address |
| `reporter` | `Address` | first reporter; a later report does not overwrite it |
| `reason` | `Reason` | `Scam` \| `Phishing` \| `Drainer` \| `Poisoning` \| `Mixer` \| `Other` |
| `evidence` | `BytesN<32>` | sha256 of off-chain evidence; all-zero means none |
| `reported_at` | `u64` | first report |
| `updated_at` | `u64` | last write |
| `status` | `Status` | `Active` \| `Disputed` \| `Revoked` |
| `reports` | `u32` | how many times reported |
| `index` | `u32` | insertion ordinal (added #32) |

Unit-variant enums arrive from `scValToNative` as a single-element array —
`["Active"]`, not `"Active"`. Unwrap before comparing.

**`is_flagged` is `status === "Active"`, and nothing else.** A `Disputed` entry's
evidence is contested and a `Revoked` one has been cleared by the admin; both
still exist and both must stop producing a warning. Treating "an entry exists" as
"flagged" would keep gating a user whose report was already withdrawn.

## The reference helper

`scripts/hot-read-blacklist-registry.mjs` does the whole path — derive, read,
decode, verdict — with no source account and no signing:

```bash
node scripts/hot-read-blacklist-registry.mjs \
  --contract C... --subject G... [--rpc https://soroban-testnet.stellar.org] [--json]
```

## Deployment (testnet)

| | |
|---|---|
| Contract id | [`CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F`](https://stellar.expert/explorer/testnet/contract/CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F) |
| WASM hash | `40fd37718c3fbc7f849c4d414364cdd86c01b4db9ab86be9099007ba5be23783` |
| Admin | `GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK` |
| Treasury | `GA4A2EPXERUUVMBMH3D5OV4ONZ7QXIYKHBSI2ZWZ5HQAIFUMYCQZRSNR` |
| Fee | `10000000` stroops (1 XLM) of the native XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

The WASM hash is the sha256 of the built artifact — `scripts/build-blacklist-registry.sh`
prints it, `stellar contract upload` returns it, and the deploy script refuses to
continue if the two disagree, so a hash published here cannot have drifted from
the bytes on chain.

Admin and treasury above are local `stellar keys` identities on the deploying
machine. **No secret ever enters the repo**; a real deployment's admin and
treasury secrets live in environment secrets (SOW §3.9).

### Smoke report — the fee-routing evidence

`scripts/smoke-blacklist-registry.sh <contract-id>` reports Lantern's demo
flagged address and asserts the money moved:

| | |
|---|---|
| Report tx | [`81fa64a67eb583f8fb499b2d425e88754b701480f1c8aff2e3ad8a6725fb8ed8`](https://stellar.expert/explorer/testnet/tx/81fa64a67eb583f8fb499b2d425e88754b701480f1c8aff2e3ad8a6725fb8ed8) |
| Subject | `GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ` (`DEMO_FLAGGED_ADDRESSES`) |
| Reason | `Scam`, evidence `7f107062713d6b640e0491e374f26314e3d12a1c4e3687959269ae5d32e411d8` |
| Treasury balance | `100000000000` → `100010000000` stroops — **exactly +1 XLM** |
| After | `is_flagged(GA7QY…) == true` |

The script asserts the delta rather than printing two balances, so a fee that
silently stopped routing fails the run instead of reading as success. The
subject is the address the scanner already shows as flagged in the demo, so the
on-chain entry and the demo agree.

### Re-deploying after a testnet reset

Testnet is periodically reset, which wipes the contract *and* every entry.

```bash
scripts/deploy-blacklist-registry.sh                 # prints new id + wasm hash
scripts/smoke-blacklist-registry.sh <new-contract-id>  # re-seeds the demo entry
```

Then update, in this order:

1. the README "Testnet smart contracts" row (contract id **and** WASM hash),
2. the deployment table above, plus the smoke tx hash, and
3. the worked example in this document (contract id **and** the base64 key).

There is deliberately **no fourth step in the test suite**.
`tests/blacklist-hot-read.test.ts` reads the worked example out of this file and
re-derives the key from it, so this document is the fixture rather than a copy of
one: a stale example fails `npm test` instead of sitting green next to a passing
duplicate. Run the suite after step 3.

Get the new key from `--key-only`, which needs no network:

```bash
node scripts/hot-read-blacklist-registry.mjs --key-only \
  --contract <new-contract-id> --subject GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7
```

## Verified against a live contract

Against the deployment above, over `getLedgerEntries` with no source account, no
transaction and no signature:

| Case | Result |
|---|---|
| Reported subject, `Active` | `FLAGGED`, reason `Scam`, reporter and `reports: 1` decoded, `index: 0` |
| Address never reported | `not flagged — no live entry`, clean exit, no error |

The `Disputed` case — `flagged: false` with the entry still readable and
`status: "Disputed"` — was verified in #44 against a throwaway zero-fee instance,
because proving it here would mean disputing the demo entry this deployment
exists to seed.

## What this does not do

Wiring the hot read into the scanner or the wallet is D2 (Screen stage) and D3.
**The wallet does not read this registry yet** — today's scanner still screens
against the hardcoded `DEMO_FLAGGED_ADDRESSES` in `src/core/scan/engine.ts`, not
against the deployed contract. This is the primitive, the proof and the recipe.

The ABI, data model, status semantics, event schema and error codes are #45's
job, not this document's.
