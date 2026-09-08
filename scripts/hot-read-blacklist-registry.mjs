#!/usr/bin/env node
/**
 * Blacklist registry — the O(1) hot read (#44).
 *
 * Answers "is this counterparty flagged?" by reading the subject's ledger entry
 * **directly**, with no simulation, no source account, no signing and no fee.
 * That is the read D2's Screen stage performs per counterparty on every scan,
 * so its cost profile matters: `simulateTransaction` once per counterparty is
 * the wrong shape for the critical path, and it needs an account the caller may
 * not have.
 *
 * The recipe, in full:
 *
 *   1. The contract stores each entry at `DataKey::Entry(Address)` in
 *      PERSISTENT storage (see contracts/blacklist-registry/src/lib.rs).
 *   2. A `#[contracttype] enum` variant with one payload field encodes as an
 *      ScVal vector: [ symbol("Entry"), address(subject) ].
 *   3. That ScVal plus the contract id and durability = Persistent is a
 *      LedgerKey::ContractData — deterministic, derivable entirely client-side,
 *      no network round-trip to discover it.
 *   4. `getLedgerEntries` on that key returns the entry (or nothing).
 *   5. `is_flagged` is `status === Active` — nothing else. A Disputed or
 *      Revoked entry exists but must not raise a warning.
 *
 * Usage
 *   node scripts/hot-read-blacklist-registry.mjs --contract C... --subject G...
 *   node scripts/hot-read-blacklist-registry.mjs --contract C... --subject G... --json
 *   node scripts/hot-read-blacklist-registry.mjs --key-only --contract C... --subject G...
 *
 * Options
 *   --rpc <url>   default https://soroban-testnet.stellar.org
 *   --json        machine-readable output
 *   --key-only    print the derived LedgerKey XDR and stop (no network at all)
 */
import { Address, xdr, scValToNative, rpc } from "@stellar/stellar-sdk";

const DEFAULT_RPC = "https://soroban-testnet.stellar.org";

function parseArgs(argv) {
  const out = { flags: new Set(), opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const name = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out.opts[name] = next; i++; }
    else out.flags.add(name);
  }
  return out;
}

/**
 * Build the LedgerKey for `DataKey::Entry(subject)`.
 *
 * This is the whole trick, and it is pure client-side arithmetic: no RPC call
 * is needed to find out where an entry lives.
 */
export function entryLedgerKey(contractId, subject) {
  const key = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Entry"),
    new Address(subject).toScVal(),
  ]);
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

/** Decode a returned ContractData entry into the contract's `Entry` shape. */
function decodeEntry(val) {
  // `Entry` is a #[contracttype] struct, so it arrives as an ScMap and
  // scValToNative gives back a plain object keyed by the Rust field names.
  const e = scValToNative(val);
  return {
    subject: e.subject,
    reporter: e.reporter,
    // Unit-variant enums decode to a single-element array, e.g. ["Active"].
    reason: Array.isArray(e.reason) ? e.reason[0] : e.reason,
    status: Array.isArray(e.status) ? e.status[0] : e.status,
    evidence: Buffer.from(e.evidence).toString("hex"),
    reported_at: Number(e.reported_at),
    updated_at: Number(e.updated_at),
    reports: Number(e.reports),
    // Added in #32 for index-TTL correctness — the decode has to match the
    // CURRENT struct, not #31's original 8-field shape.
    index: Number(e.index),
  };
}

async function main() {
  const { flags, opts } = parseArgs(process.argv.slice(2));
  const { contract, subject } = opts;
  const json = flags.has("json");

  if (!contract || !subject) {
    console.error("usage: hot-read-blacklist-registry.mjs --contract C... --subject G... [--rpc url] [--json] [--key-only]");
    process.exit(2);
  }

  let ledgerKey;
  try {
    ledgerKey = entryLedgerKey(contract, subject);
  } catch (e) {
    console.error(`could not derive the ledger key: ${e.message}`);
    process.exit(2);
  }
  const keyXdr = ledgerKey.toXDR("base64");

  if (flags.has("key-only")) {
    // Deliberately reachable with no network: the derivation is the claim.
    console.log(json ? JSON.stringify({ contract, subject, keyXdr }, null, 2) : keyXdr);
    return;
  }

  const server = new rpc.Server(opts.rpc ?? DEFAULT_RPC, { allowHttp: true });
  // No source account, no transaction, no signature — just a ledger read.
  const res = await server.getLedgerEntries(ledgerKey);
  const found = res.entries?.[0];

  if (!found) {
    // Never reported is the common case, not an error.
    const out = { contract, subject, keyXdr, flagged: false, entry: null, reason: "no entry" };
    console.log(json ? JSON.stringify(out, null, 2) : `not flagged — no entry for ${subject}`);
    return;
  }

  const entry = decodeEntry(found.val.contractData().val());
  const flagged = entry.status === "Active";
  const out = {
    contract, subject, keyXdr, flagged, entry,
    liveUntilLedgerSeq: found.liveUntilLedgerSeq ?? null,
    latestLedger: res.latestLedger,
  };

  if (json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log(flagged ? `FLAGGED — ${subject}` : `not flagged (status ${entry.status}) — ${subject}`);
  console.log(`  reason      ${entry.reason}`);
  console.log(`  reported by ${entry.reporter}`);
  console.log(`  reports     ${entry.reports}`);
  console.log(`  evidence    ${entry.evidence}`);
  console.log(`  index       ${entry.index}`);
  console.log(`  ledger key  ${keyXdr}`);
}

main().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
