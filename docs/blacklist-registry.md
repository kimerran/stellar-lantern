# Blacklist registry

The reference for the on-chain scam-address registry that is Deliverable 1: what
it is, its full ABI, the data it keeps, the events it emits, and the two ways to
read it.

## Report once, protect everyone

Lantern's scanner screens recipients against a hardcoded demo deny-list
(`DEMO_FLAGGED_ADDRESSES` in `src/core/scan/engine.ts`). A list that lives inside
one wallet's bundle protects one wallet's users. This contract is what replaces
it: anyone can report an address, and **any** Stellar wallet or dApp can read the
result, with no key, no account and no permission.

Three decisions shape everything below.

**Writes cost money.** Reporting charges `Config::fee` of `Config::fee_token`,
routed to `Config::treasury`. That is the anti-abuse mechanism — spamming the
registry is expensive — and the fee funds the scanner's AI inference. The
contract never custodies the fee; it moves reporter → treasury inside the same
transaction as the write.

**The signal is attributed, never an auto-block.** An entry records *who*
reported it, so a consumer can weight the signal by reporter reputation rather
than treat one stranger's claim as a verdict. This is the SOW §3.9 posture: the
registry informs a warning, it does not gate a transaction on its own.

**Only a hash goes on chain.** `evidence` is a 32-byte sha256 of material kept
off chain — never the material itself. Combined with a small closed set of
reasons, an entry stays cheap to store and cheap to read.

## Reading it: two paths

The registry answers one question for wallets: **has this counterparty been
reported?** There are two ways to ask, and they are not interchangeable.

| | Hot read | Contract views |
|---|---|---|
| Mechanism | `getLedgerEntries` on a derived ledger key | `simulateTransaction` against `is_flagged` / `get` / `list` |
| Source account | **none** | conventionally required |
| Signing / fee | **none** | none, but a simulation round-trip |
| Answers | one subject | one subject, or paging, or config |
| Archived entry | `flagged: null` — unknown, not clean | a `restorePreamble`, not a result — also unknown until you restore |
| Use it for | the per-signature screening path (D2 Screen) | UIs, indexers, anything wanting the whole set |

The hot read is what the scanner's Screen stage runs per counterparty on every
scan, TTL-cached. Simulating once per counterparty is the wrong cost profile for
the critical path, and it demands an account the caller may not have — a visitor
pasting an XDR into the public demo has no key at all.

## ABI

Every public entry point. Types are the Soroban SDK 27 types the contract
declares; `Reason` and `Status` are `#[contracttype]` enums, so a CLI passes them
by variant name (`--reason Scam`, or `--reason '"Scam"'` if your CLI version
insists on JSON).

### Constructor

| | |
|---|---|
| `__constructor(admin: Address, treasury: Address, fee_token: Address, fee: i128)` | Runs once at deploy. Writes `Config` and `Count = 0`. A negative `fee` is `InvalidFee`; **zero is legal** — that is how the registry runs before a treasury is funded. No `require_auth`: the caller is by definition the deployer. |

### Write

| | |
|---|---|
| `report(reporter: Address, subject: Address, reason: Reason, evidence: BytesN<32>) -> u32` | Records `subject` as malicious and returns its **new total report count**. Charges `fee` from `reporter` to `treasury`. `reporter.require_auth()` runs *first*, before any storage read or transfer, so nothing about the call is observable to an unauthorized caller. `reporter == subject` is `SelfReport`. |

Upsert semantics are the audit trail, and they are not obvious:

- **New subject** → written `Active`, `reports = 1`, appended to the
  insertion-ordered index, `Count` incremented.
- **Existing `Active` or `Disputed`** → only `reports` and `updated_at` move. The
  **first** reporter, reason, evidence and `reported_at` are deliberately kept,
  so a later reporter cannot rewrite who said what — and a disputed entry stays
  disputed, because only the admin resolves a dispute.
- **Existing `Revoked`** → reactivated under the *new* reporter's attribution,
  but `reported_at` is preserved.

Repeat reports never touch `Count` and never add an index slot, so the subject
list stays duplicate-free. They still charge the fee — that is the anti-spam
property, not an oversight.

### Admin

All five load `Config` and `require_auth()` the **current** admin before touching
anything else.

| | |
|---|---|
| `set_status(subject: Address, status: Status)` | Move an entry between `Active` / `Disputed` / `Revoked`. `NotFound` if the subject has no entry — never an implicit create, so the admin cannot flag an address without a fee-paying report behind it. Any transition is allowed, including a same-status no-op: a transition matrix could strand an entry in a state the admin cannot leave. |
| `set_admin(new_admin: Address)` | Hand over control. **Both** admins authorize — the outgoing one to approve, the incoming one to prove the address exists and is controlled. There is no upgrade entry point and no recovery path, so a hand-off to a mistyped address would be terminal; both signatures ride in one transaction, so a compromised key is still rotated in a single call. |
| `set_treasury(treasury: Address)` | Redirect **future** fees. Fees already collected stay where they were sent — the contract never custodies them. |
| `set_fee_token(fee_token: Address)` | Switch the token reports are paid in. Reprices nothing on its own: `fee` is denominated in the new token's units from the next report, so the two are normally set together. |
| `set_fee(fee: i128)` | Reprice a report. `0` is legal; negative is `InvalidFee`. |

### Read

None of the five takes `require_auth`. Screening a counterparty must not require
an identity, let alone a signature, or the registry stops being a public good.

| | |
|---|---|
| `is_flagged(subject: Address) -> bool` | `true` **only** for `Status::Active`. An address nobody reported is a plain `false`, never a panic — this runs on every counterparty of every transaction. |
| `get(subject: Address) -> Option<Entry>` | The whole entry, or `None`. |
| `count() -> u32` | Distinct **subjects**, not reports. |
| `list(start: u32, limit: u32) -> Vec<Entry>` | Insertion-ordered paging. `limit` outside `1..=MAX_PAGE` is `InvalidLimit`; **`MAX_PAGE = 50`**. A `start` past the end returns an empty `Vec` rather than erroring, so a caller can page to exhaustion without special-casing the last page, and an index slot with no entry behind it is skipped rather than panicked on. |
| `config() -> Config` | The four config values. |

**TTL, and why paging differs.** The per-subject reads refresh the entry's TTL
through a shared helper: the entries wallets keep asking about are exactly the
ones that must not expire, and read traffic is the best available signal about
which still matter. `list` refreshes **nothing** — a bulk indexer sweep should
not rewrite the whole registry's TTL, and it keeps a full page to one write
rather than one per row. `extend_ttl` is a no-op until the remaining TTL falls
under the threshold, so a read on a fresh entry costs nothing.

## Errors

| # | Name | Raised by |
|---|---|---|
| 1 | `InvalidFee` | `__constructor`, `set_fee` — a negative fee |
| 2 | `SelfReport` | `report` — `reporter == subject` |
| 3 | `NotFound` | `set_status` — no entry for that subject. Also the error for a missing `Config` in `report`, `config` and `require_admin` (so every admin entry point can surface it), though that is unreachable once `__constructor` has run |
| 4 | `InvalidLimit` | `list` — `limit == 0` or `limit > 50` |

Entry points that return `()` or `u32` surface these as a raw
`soroban_sdk::Error`, **not** a typed `Result`, so a client sees
`Error(Contract, #2)` rather than a named variant. Match on the number.

## Data model

### `Entry` — nine fields

| Field | Type | Notes |
|---|---|---|
| `subject` | `Address` | The flagged address |
| `reporter` | `Address` | Attribution — see the upsert rules above for which reporter survives |
| `reason` | `Reason` | |
| `evidence` | `BytesN<32>` | sha256 of off-chain evidence; all-zero means none |
| `reported_at` | `u64` | Ledger timestamp of the **first** report |
| `updated_at` | `u64` | Ledger timestamp of the last write |
| `status` | `Status` | |
| `reports` | `u32` | How many times this subject has been reported |
| `index` | `u32` | Insertion position — the entry's `DataKey::Index(index)` key |

`index` is the field a decoder written against the original schema gets wrong: it
was added in #32 so `Entry(subject)` and `Index(i)` could have their TTLs bumped
**together**. They are separate ledger entries, and a freshly written index key
starts at the network *minimum* persistent TTL. Bumping only the entry let the
index expire under a live subject — `count` and `is_flagged` would still report
the address while `list` could no longer enumerate it.

### `Config`

| Field | Type |
|---|---|
| `admin` | `Address` — may change status and config |
| `treasury` | `Address` — receives every write fee |
| `fee_token` | `Address` — the SAC fees are paid in |
| `fee` | `i128` — per report, in the token's units; `0` is legal |

### `Reason`

`Scam` · `Phishing` · `Drainer` · `Poisoning` · `Mixer` · `Other`

A deliberately small closed set. The detail lives off chain behind the
`evidence` hash.

### `Status`

`Active` · `Disputed` · `Revoked` — see below.

### `DataKey`

| Key | Storage | Holds |
|---|---|---|
| `Config` | instance | `Config` |
| `Count` | instance | `u32` — distinct subjects |
| `Entry(Address)` | persistent | `Entry` |
| `Index(u32)` | persistent | `Address` — insertion-ordered, 0-based |

`Entry(Address)` in persistent storage is what makes the hot read below possible:
its ledger key is computable offline.

## Status semantics

Only `Active` counts toward `is_flagged`. The other two exist so that a wrongly
flagged address stops producing a warning **without deleting the record** — who
reported what, and how it was resolved, stays readable on chain.

| Status | `is_flagged` | Meaning |
|---|---|---|
| `Active` | `true` | Reported and standing |
| `Disputed` | `false` | Evidence is contested; only the admin resolves it |
| `Revoked` | `false` | Cleared by the admin |

Two consequences worth stating outright:

- **A repeat report never resolves a dispute.** Reporting a `Disputed` subject
  increments `reports` and leaves the status alone.
- **`Revoked` is not durable.** The next `report()` re-flags the subject under
  the new reporter's attribution, keeping the original `reported_at`. The admin
  can clear current evidence but cannot silence an address forever — that is
  exactly the centralization the fee model exists to avoid. `set_fee` is the
  lever if re-flagging should cost more.

## Events

The bar these are written to: **an indexer must be able to rebuild the registry
from events alone.** So every admin event carries *both* sides of the change, and
never requires the consumer to have carried state across earlier events.

| Topics | Data |
|---|---|
| `(report, subject)` | `(reporter, reason, status, reports)` |
| `(status, subject)` | `(old_status, new_status)` |
| `(config, admin)` | `(old_admin, new_admin)` |
| `(config, treasury)` | `(old_treasury, new_treasury)` |
| `(config, fee)` | `(old_fee, new_fee)` |
| `(config, fee_token)` | `(old_token, new_token)` |

The `report` payload is the **persisted** attribution — `entry.reporter` and
`entry.reason`, not the call's arguments. On a repeat report the entry keeps the
first reporter and reason, so publishing the caller's would make an indexer that
folds these events into state diverge from storage. It is also deliberately not
the whole entry: `evidence`, `reported_at` and `updated_at` are absent, so an
indexer that needs those reads storage once.

Every `publish` call carries `#[allow(deprecated)]`. SDK 27's `#[contractevent]`
macro is the non-deprecated path, but adopting it would change the wire format
these topics and payloads define — so it is a deliberate follow-up, not a
drive-by.

## Fee model

| | |
|---|---|
| Charged on | **every accepted report**, including repeats of an already-flagged subject |
| Not charged on | anything that reverts — a failed transfer leaves no entry, and `Count` does not move |
| Asset | `Config::fee_token`, any SAC. Configurable rather than hardcoded to native XLM specifically so unit tests can register a mock token and assert routing with no network |
| Zero fee | Legal, and skips the transfer entirely |
| Custody | None. The transfer is reporter → treasury inside the report transaction |

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

The contract views are **not** the way out of this. Simulating `is_flagged`
against an archived entry does not return an authoritative `false`: it returns a
`restorePreamble` instead of a result, saying the footprint contains archived
state. Acting on that means building a `RestoreFootprint` transaction from the
preamble, **submitting** it — a real fee on a real transaction, not a simulation
— and re-simulating before the answer means anything. So the fallback has the
same gap as the hot read, just one step further along, and until restoration
succeeds the verdict is unknown rather than clean. That is the same posture the
helper already takes with `flagged: null`.

What the views do give you is a *named* uncertainty: a `restorePreamble` says
"archived, restorable" where an empty `getLedgerEntries` result cannot
distinguish that from never-reported. If you need certainty for one subject —
before gating a signature on a clean answer, say — that is the signal to act on,
and restoring is the only thing that resolves it. Do not put any of this on the
hot path: it would spend a round-trip on every clean address, which is nearly
all of them.

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
`tests/blacklist-hot-read.test.ts` reads this file instead: it re-derives the
ledger key from the worked example, and it asserts the worked example's contract
id equals the one in the deployment table above. This document is the fixture
rather than a copy of one, so **stopping after step 2 fails `npm test`** — the
realistic version of forgetting, since the runbook reaches the worked example
last.

What it cannot see is a re-deploy where nobody touched this file at all: the doc
stays internally consistent while pointing at a contract testnet has since wiped.
So run the suite after step 3, and open the explorer link to confirm the id is
live.

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
