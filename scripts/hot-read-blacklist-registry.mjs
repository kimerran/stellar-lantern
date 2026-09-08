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
import { Address, xdr, scValToNative, rpc } from '@stellar/stellar-sdk';

const DEFAULT_RPC = 'https://soroban-testnet.stellar.org';

/** Options that take a value. Anything else is a boolean flag. */
const VALUE_OPTS = new Set(['rpc', 'contract', 'subject']);

function parseArgs(argv) {
  const out = { flags: new Set(), opts: {}, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const name = a.slice(2);
    const next = argv[i + 1];
    const hasValue = next !== undefined && !next.startsWith('--') && next !== '';

    if (VALUE_OPTS.has(name)) {
      // A value-taking option written bare used to fall through to the flag
      // branch, so `--rpc` with a missing value silently answered from the
      // default endpoint: a wrong-network verdict that reads exactly like a
      // right one. Refuse it instead.
      if (!hasValue) {
        out.errors.push(`--${name} needs a value`);
        continue;
      }
      out.opts[name] = next;
      i++;
      continue;
    }

    if (hasValue) {
      out.opts[name] = next;
      i++;
    } else out.flags.add(name);
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
  const key = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Entry'), new Address(subject).toScVal()]);
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

/** Decode a returned ContractData entry into the contract's `Entry` shape. */
export function decodeEntry(val) {
  // `Entry` is a #[contracttype] struct, so it arrives as an ScMap and
  // scValToNative gives back a plain object keyed by the Rust field names.
  const e = scValToNative(val);
  return {
    subject: e.subject,
    reporter: e.reporter,
    // Unit-variant enums decode to a single-element array, e.g. ["Active"].
    reason: Array.isArray(e.reason) ? e.reason[0] : e.reason,
    status: Array.isArray(e.status) ? e.status[0] : e.status,
    evidence: Buffer.from(e.evidence).toString('hex'),
    reported_at: Number(e.reported_at),
    updated_at: Number(e.updated_at),
    reports: Number(e.reports),
    // Added in #32 for index-TTL correctness — the decode has to match the
    // CURRENT struct, not #31's original 8-field shape.
    index: Number(e.index),
  };
}

async function main() {
  const { flags, opts, errors } = parseArgs(process.argv.slice(2));
  const { contract, subject } = opts;
  const json = flags.has('json');

  if (errors.length) {
    for (const e of errors) console.error(e);
    process.exit(2);
  }

  if (!contract || !subject) {
    console.error(
      'usage: hot-read-blacklist-registry.mjs --contract C... --subject G... [--rpc url] [--json] [--key-only]',
    );
    process.exit(2);
  }

  let ledgerKey;
  try {
    ledgerKey = entryLedgerKey(contract, subject);
  } catch (e) {
    console.error(`could not derive the ledger key: ${e.message}`);
    process.exit(2);
  }
  const keyXdr = ledgerKey.toXDR('base64');

  if (flags.has('key-only')) {
    // Deliberately reachable with no network: the derivation is the claim.
    console.log(json ? JSON.stringify({ contract, subject, keyXdr }, null, 2) : keyXdr);
    return;
  }

  const endpoint = opts.rpc ?? DEFAULT_RPC;
  const server = new rpc.Server(endpoint, { allowHttp: true });
  // No source account, no transaction, no signature — just a ledger read.
  const res = await server.getLedgerEntries(ledgerKey);
  const found = res.entries?.[0];

  if (!found) {
    // Never reported is the common case, not an error. An archived entry does
    // NOT arrive here — see the archived branch below.
    const out = {
      contract,
      subject,
      keyXdr,
      endpoint,
      status: 'not-flagged',
      flagged: false,
      entry: null,
      reason: 'no entry',
    };
    console.log(
      json ? JSON.stringify(out, null, 2) : `not flagged — no entry for ${subject} (${endpoint})`,
    );
    return;
  }

  const entry = decodeEntry(found.val.contractData().val());

  // Archival is the one failure this screening call must not answer through.
  // A persistent entry that ages out is archived, not deleted, and its
  // liveUntilLedgerSeq falls behind the network's latest ledger. Reporting that
  // as "not flagged" would turn a still-flagged subject into a clean verdict —
  // exactly the wrong direction to fail in. It is a third outcome, and the
  // caller's move is to fall back to the contract views (#46), which restore
  // the entry as part of the invocation.
  const liveUntil = found.liveUntilLedgerSeq ?? null;
  const archived = liveUntil !== null && res.latestLedger > liveUntil;

  const flagged = !archived && entry.status === 'Active';
  const out = {
    contract,
    subject,
    keyXdr,
    endpoint,
    status: archived ? 'unknown' : flagged ? 'flagged' : 'not-flagged',
    ...(archived ? { reason: 'archived' } : {}),
    flagged,
    entry,
    liveUntilLedgerSeq: liveUntil,
    latestLedger: res.latestLedger,
  };

  if (json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (archived) {
    console.log(`UNKNOWN (archived) — ${subject}`);
    console.log(`  the entry aged out at ledger ${liveUntil}; latest is ${res.latestLedger}.`);
    console.log(
      `  Do NOT read this as "not flagged" — fall back to the contract views (is_flagged/get),`,
    );
    console.log(`  which restore the entry as part of the call.`);
  } else {
    console.log(
      flagged ? `FLAGGED — ${subject}` : `not flagged (status ${entry.status}) — ${subject}`,
    );
  }
  console.log(`  reason      ${entry.reason}`);
  console.log(`  reported by ${entry.reporter}`);
  console.log(`  reports     ${entry.reports}`);
  console.log(`  evidence    ${entry.evidence}`);
  console.log(`  index       ${entry.index}`);
  console.log(`  ledger key  ${keyXdr}`);
  console.log(`  endpoint    ${endpoint}`);
}

// Only run when invoked as a script. Importing the module — which the test
// suite does, to exercise the derivation and the decode offline — must not fire
// a network read as a side effect of the import. Compared as paths rather than
// via node:url, because the test runner's node polyfills shim that module.
if (import.meta.filename === process.argv[1]) {
  main().catch((e) => {
    console.error(e.stack || String(e));
    process.exit(1);
  });
}
