# Blacklist registry — read paths

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

Contract `CDZSDRDWHL3LRK5PRQ6EJR74OYSQ4FE7OOZH37KIXN7GQ3HZ3N4MSAFK`,
subject `GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7`:

```
AAAABgAAAAHzIcR2Ova4q6+MPETH/HYlDhSfc7J9/Ui7fmhs+dt4yQAAABAAAAABAAAAAgAAAA8A
AAAFRW50cnkAAAAAAAASAAAAAAAAAAABlHJijueOuScU0i0DkJY8JNkn6gCZmUhuiR+sLaqcIQAA
AAE=
```

Reproduce it offline — the derivation touches no network:

```bash
node scripts/hot-read-blacklist-registry.mjs --key-only \
  --contract CDZSDRDWHL3LRK5PRQ6EJR74OYSQ4FE7OOZH37KIXN7GQ3HZ3N4MSAFK \
  --subject  GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7
```

## Reading and decoding

`getLedgerEntries(ledgerKey)` returns at most one entry. Nothing back means the
subject was never reported — the common case, and not an error.

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

## Verified against a live contract

Run on testnet against a throwaway instance deployed for this purpose
(`CDZSDRDWHL3LRK5PRQ6EJR74OYSQ4FE7OOZH37KIXN7GQ3HZ3N4MSAFK`, zero fee — **not**
the registry's real deployment, which is #36):

| Case | Result |
|---|---|
| Reported subject, `Active` | `FLAGGED`, reason `Scam`, reporter and `reports: 1` decoded, `index: 0` |
| Same subject after `set_status Disputed` | `flagged: false`, entry still readable with `status: "Disputed"` |
| Address never reported | `not flagged — no entry`, clean exit, no error |

Every one of those went over `getLedgerEntries` with no source account, no
transaction and no signature.

## What this does not do

Wiring the hot read into the scanner or the wallet is D2 (Screen stage) and D3.
This is the primitive, the proof and the recipe.
