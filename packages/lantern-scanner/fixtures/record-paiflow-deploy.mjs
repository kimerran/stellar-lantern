#!/usr/bin/env node
// Records `paiflow-deploy-pipeline-fresh` (#305): Paiflow's factory
// `deploy_pipeline` with a simulation that SUCCEEDS, so the scanner can be
// tested on a call that creates contracts. Paiflow's own sample
// (paiflow-live-factory-deploy-pipeline, pinkraft#1022) now reverts on
// re-simulation because its salts were already used on chain.
//
// It takes that sample's envelope and changes only what a fresh deploy needs:
//   - both blueprint salts → fresh random 32 bytes;
//   - Paiflow's account (source and every argument naming it) →
//     lantern-deployer, so the source and the admin are the same account;
//   - a fresh sequence from Horizon.
// The factory, the WASM hashes and every other argument stay as Paiflow built
// them. Nothing is signed or submitted.
//
//   node packages/lantern-scanner/fixtures/record-paiflow-deploy.mjs [--rpc URL]
//
// Writes paiflow-deploy-pipeline-fresh.json and adds its name to index.json.

import { randomBytes } from 'node:crypto';
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
  xdr,
} from '@stellar/stellar-sdk';

const OUT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const i = args.indexOf('--rpc');
const RPC = i >= 0 && args[i + 1] ? args[i + 1] : 'https://soroban-testnet.stellar.org';
const HORIZON = 'https://horizon-testnet.stellar.org';
const PASSPHRASE = Networks.TESTNET;
const PAIFLOW_ACCOUNT = 'GCDF6TFSMWXBK7DGO4AQ4WYBSTS5OHM6S4OJRG7MZ7V34AT2LYSOJNWZ';
const SOURCE = 'GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK'; // lantern-deployer
const NAME = 'paiflow-deploy-pipeline-fresh';

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status} on ${method}`);
  return res.json();
}

// Paiflow's account → ours, salts → fresh; everything else as is.
function rewrite(v) {
  switch (v.switch().name) {
    case 'scvAddress': {
      const a = Address.fromScVal(v).toString();
      return a === PAIFLOW_ACCOUNT ? new Address(SOURCE).toScVal() : v;
    }
    case 'scvVec':
      return xdr.ScVal.scvVec((v.vec() ?? []).map(rewrite));
    case 'scvMap':
      return xdr.ScVal.scvMap(
        (v.map() ?? []).map((e) => {
          const key = e.key();
          const isSalt = key.switch().name === 'scvSymbol' && key.sym().toString() === 'salt';
          return new xdr.ScMapEntry({
            key,
            val: isSalt ? xdr.ScVal.scvBytes(randomBytes(32)) : rewrite(e.val()),
          });
        }),
      );
    default:
      return v;
  }
}

const sample = JSON.parse(
  readFileSync(join(OUT, 'paiflow-live-factory-deploy-pipeline.json'), 'utf8'),
);
const original = TransactionBuilder.fromXDR(sample.xdr, PASSPHRASE);
const invoke = original.operations[0].func.invokeContract();
const contractId = Address.fromScAddress(invoke.contractAddress()).toString();
const fn = invoke.functionName().toString();
const callArgs = invoke.args().map(rewrite);

const res = await fetch(`${HORIZON}/accounts/${SOURCE}`);
if (!res.ok) throw new Error(`Horizon ${res.status} loading ${SOURCE}`);
const seq = (await res.json()).sequence;
const tx = new TransactionBuilder(new Account(SOURCE, seq), {
  fee: BASE_FEE,
  networkPassphrase: PASSPHRASE,
})
  .addOperation(new Contract(contractId).call(fn, ...callArgs))
  .setTimeout(180)
  .build()
  .toXDR();

const simulation = await rpc('simulateTransaction', { transaction: tx });
const fixture = {
  name: NAME,
  description:
    "Paiflow factory `deploy_pipeline` with fresh salts and lantern-deployer as source and admin, so the simulation succeeds: one call that creates an on-receive trigger and a splitter. Built from Paiflow's sample in pinkraft#1022 (paiflow-live-factory-deploy-pipeline).",
  networkPassphrase: PASSPHRASE,
  source: SOURCE,
  recordedAt: new Date().toISOString(),
  rpc: RPC,
  xdr: tx,
  simulation,
};
writeFileSync(join(OUT, `${NAME}.json`), JSON.stringify(fixture, null, 2) + '\n');
console.log(
  `${NAME} ${simulation.result?.error ? `sim: error ${simulation.result.error}` : 'sim: ok'}`,
);
const indexPath = join(OUT, 'index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
if (!index.includes(NAME)) index.push(NAME);
writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
