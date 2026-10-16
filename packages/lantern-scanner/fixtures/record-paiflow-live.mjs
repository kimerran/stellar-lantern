#!/usr/bin/env node
// Turns Paiflow's five real testnet samples (#300) into scanner fixtures. The
// samples are expired, unsigned envelopes their app actually built, published
// in webnxt-2030/pinkraft#1022 (docs/testing/lantern-live-scan-samples/ on
// `lantern-integration`, commit ad6fe7d6). That repo is private, so download
// the packet first and pass its folder:
//
//   d=$(mktemp -d); for f in manifest.json splitter-distribute.simulation-public.json \
//     factory-deploy-pipeline.unsigned.xdr deposit.unsigned.xdr splitter-distribute.unsigned.xdr \
//     streamer-top-up.unsigned.xdr token-approve.unsigned.xdr; do
//     gh api "repos/webnxt-2030/pinkraft/contents/docs/testing/lantern-live-scan-samples/$f?ref=ad6fe7d6" \
//       -q .content | base64 -d > "$d/$f"; done
//   node packages/lantern-scanner/fixtures/record-paiflow-live.mjs --samples "$d" [--rpc URL]
//
// Simulation: Paiflow kept the raw simulateTransaction result only for the
// splitter distribute, and that one is used as is. The other four are
// simulated again against testnet when this runs, and whatever comes back is
// recorded, errors included: `deploy_pipeline` reuses salts that already
// deployed, so it fails now, and the scanner has to fail closed on it.
//
// Writes paiflow-live-*.json and adds their names to index.json, leaving every
// other fixture alone. Nothing is signed or submitted.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Networks } from '@stellar/stellar-sdk';

const OUT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const SAMPLES = opt('--samples');
if (!SAMPLES)
  throw new Error('Pass --samples <folder with the pinkraft#1022 packet> (see the header).');
const RPC = opt('--rpc') ?? 'https://soroban-testnet.stellar.org';
const PASSPHRASE = Networks.TESTNET;

const DESCRIPTIONS = {
  'factory-deploy-pipeline':
    "Paiflow deploy, real sample: `deploy_pipeline(admin, blueprints)` on Paiflow's factory, creating an on-receive trigger and a splitter in one call.",
  deposit:
    'Paiflow trigger page, real sample: `deposit(from, 0.1 XLM)` on a deployed on-receive trigger.',
  'splitter-distribute':
    "Paiflow trigger page, real sample: `distribute(from, 0.1 XLM)` on a splitter paying one recipient (the user). Paiflow's retained public simulation.",
  'streamer-top-up':
    'Paiflow streamer, real sample: `top_up(from, 0.1 XLM)` on a native-XLM streamer.',
  'token-approve':
    'Paiflow allowance page, real sample: XLM SAC `approve(from, <subscription contract>, 1 stroop, ledger 8323016)`.',
};

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status} on ${method}`);
  return res.json();
}

const manifest = JSON.parse(readFileSync(join(SAMPLES, 'manifest.json'), 'utf8'));
const indexPath = join(OUT, 'index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));

for (const sample of manifest.samples) {
  const name = `paiflow-live-${sample.id}`;
  const xdr = readFileSync(join(SAMPLES, sample.file), 'utf8').trim();
  let simulation;
  let rpcUsed = RPC;
  let recordedAt = new Date().toISOString();
  if (sample.id === 'splitter-distribute') {
    const kept = JSON.parse(
      readFileSync(join(SAMPLES, 'splitter-distribute.simulation-public.json'), 'utf8'),
    );
    simulation = { jsonrpc: '2.0', id: 1, result: kept.result };
    rpcUsed = kept.rpcUrl;
    recordedAt = kept.capturedAt;
  } else {
    simulation = await rpc('simulateTransaction', { transaction: xdr });
  }
  const fixture = {
    name,
    // Only the samples Paiflow actually submitted say "executed": the
    // distribute was simulated only (chainExecution is null in the manifest).
    description: `${DESCRIPTIONS[sample.id]} From pinkraft#1022; ${
      sample.chainExecution?.status === 'SUCCESS'
        ? `executed on testnet as ${sample.transactionHashTestnet}`
        : `simulated only, never submitted (transaction hash ${sample.transactionHashTestnet})`
    }.`,
    networkPassphrase: PASSPHRASE,
    source: sample.source,
    recordedAt,
    rpc: rpcUsed,
    xdr,
    simulation,
  };
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(fixture, null, 2) + '\n');
  console.log(
    `${name.padEnd(36)} ${simulation.result?.error || simulation.error ? 'sim: error' : 'sim: ok'}`,
  );
  if (!index.includes(name)) index.push(name);
}
writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
