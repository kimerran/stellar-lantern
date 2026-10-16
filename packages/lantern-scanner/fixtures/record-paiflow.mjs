#!/usr/bin/env node
// Records Paiflow envelopes for the scanner fixture corpus (#294): real base64
// XDR plus the raw `simulateTransaction` body from testnet, for the three calls
// Paiflow asks a wallet to sign on its public payment pages. The envelopes have
// the shape Paiflow's server builds (lib/stellar/invoke.ts in
// webnxt-2030/pinkraft): one invokeHostFunction, the user as transaction
// source and as `from`.
//
// The contracts are instances of Paiflow's own testnet WASM uploads (hashes in
// Paiflow's README "Template WASM uploads"), deployed by `lantern-deployer` on
// 2026-10-15 with `stellar contract deploy --wasm-hash …`:
//   splitter      60% / 40% to two ordinary accounts, XLM
//   deposit       pipeline trigger whose next step is that splitter
//   subscription  5 XLM every 30 days, subscriber = the source account
// After a testnet reset, redeploy them and update the ids below.
//
//   node packages/lantern-scanner/fixtures/record-paiflow.mjs [--rpc URL]
//
// Writes paiflow-*.json and adds their names to index.json, leaving every other
// fixture alone. Nothing is signed or submitted.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  XdrLargeInt,
  xdr,
} from '@stellar/stellar-sdk';

const OUT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const i = args.indexOf('--rpc');
const RPC = i >= 0 && args[i + 1] ? args[i + 1] : 'https://soroban-testnet.stellar.org';
const HORIZON = 'https://horizon-testnet.stellar.org';
const PASSPHRASE = Networks.TESTNET;

const SOURCE = 'GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK'; // lantern-deployer
const XLM_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
export const PAIFLOW_SPLITTER = 'CDONRKQI3HR526AEK2TYCN7TWWOC2PYT3EWF5IFNXE2V5LOBB2ZPEY27';
export const PAIFLOW_DEPOSIT = 'CAZN6V3TZBLLJXFQW4Q673J23NOOIMVT33FCLIW7H3VKQE36JPTB4UWR';
export const PAIFLOW_SUBSCRIPTION = 'CDQZHL55LRY76ONEBHBAUOLHSYSZ2CSWZ5DXZN3LJKRRVTWBDVDADX4M';

// Paiflow's approve expiry: as far out as a storage entry can be extended,
// less a small buffer (MAX_APPROVAL_LEDGER_DELTA / APPROVAL_LEDGER_BUFFER).
const MAX_APPROVAL_LEDGER_DELTA = 3_110_400;
const APPROVAL_LEDGER_BUFFER = 10;

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status} on ${method}`);
  return res.json();
}

async function sequence() {
  const res = await fetch(`${HORIZON}/accounts/${SOURCE}`);
  if (!res.ok) throw new Error(`Horizon ${res.status} loading ${SOURCE}`);
  return (await res.json()).sequence;
}

const addr = (a) => new Address(a).toScVal();
const i128 = (n) => new XdrLargeInt('i128', String(n)).toScVal();

function invoke(seq, contractId, fn, ...callArgs) {
  return new TransactionBuilder(new Account(SOURCE, seq), {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call(fn, ...callArgs))
    .setTimeout(180)
    .build()
    .toXDR();
}

const seq = await sequence();
const ledger = (await rpc('getLatestLedger')).result.sequence;

const cases = {
  'paiflow-splitter-distribute': {
    description:
      'Paiflow trigger page, splitter flow: `distribute(from, 10 XLM)` on a Paiflow splitter that pays 60% / 40% to two accounts. The splitter pulls the XLM from the user (nested SAC transfer) and pays both recipients.',
    xdr: invoke(seq, PAIFLOW_SPLITTER, 'distribute', addr(SOURCE), i128(100_000_000)),
  },
  'paiflow-pipeline-deposit': {
    description:
      'Paiflow trigger page, pipeline flow: `deposit(from, 10 XLM)` on a Paiflow deposit trigger whose next step is the splitter. The user authorises one transfer into the trigger; the trigger forwards it and calls the splitter.',
    xdr: invoke(seq, PAIFLOW_DEPOSIT, 'deposit', addr(SOURCE), i128(100_000_000)),
  },
  'paiflow-subscription-approve': {
    description:
      'Paiflow allowance page: XLM SAC `approve(from, <Paiflow subscription contract>, 60 XLM, ~180 days)`, the allowance a subscriber grants so the subscription can charge 5 XLM a month.',
    xdr: invoke(
      seq,
      XLM_SAC,
      'approve',
      addr(SOURCE),
      addr(PAIFLOW_SUBSCRIPTION),
      i128(600_000_000),
      xdr.ScVal.scvU32(ledger + MAX_APPROVAL_LEDGER_DELTA - APPROVAL_LEDGER_BUFFER),
    ),
  },
};

const indexPath = join(OUT, 'index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
for (const [name, c] of Object.entries(cases)) {
  const simulation = await rpc('simulateTransaction', { transaction: c.xdr });
  const fixture = {
    name,
    description: c.description,
    networkPassphrase: PASSPHRASE,
    source: SOURCE,
    recordedAt: new Date().toISOString(),
    rpc: RPC,
    xdr: c.xdr,
    simulation,
  };
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(fixture, null, 2) + '\n');
  console.log(`${name.padEnd(30)} ${simulation.result?.error ? 'sim: error' : 'sim: ok'}`);
  if (!index.includes(name)) index.push(name);
}
writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
