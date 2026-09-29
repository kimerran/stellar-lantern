#!/usr/bin/env node
// Records fixtures/registry-list.json (#186): the whole D1 blacklist registry
// read the way the playground's registry panel reads it, with no source
// account and no simulation. Three getLedgerEntries bodies:
//   1. the contract instance, whose storage holds `Count`
//   2. `Index(0..count-1)`, each pointing at a subject
//   3. `Entry(subject)` for every subject
// The keys are derived here independently of registry.ts, so the test that
// compares them checks the package's helpers against a second derivation.
// Re-record after a testnet reset.
//
//   node packages/lantern-scanner/fixtures/record-registry-list.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Address, xdr } from '@stellar/stellar-sdk';

const OUT = dirname(fileURLToPath(import.meta.url));
const RPC = 'https://soroban-testnet.stellar.org';
const REGISTRY = 'CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F';

const contractKey = (key) =>
  xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(REGISTRY).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    }),
  ).toXDR('base64');

async function read(keys) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLedgerEntries', params: { keys } }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  return res.json();
}

const instanceKey = contractKey(xdr.ScVal.scvLedgerKeyContractInstance());
const instance = await read([instanceKey]);
const storage = xdr.LedgerEntryData.fromXDR(instance.result.entries[0].xdr, 'base64')
  .contractData()
  .val()
  .instance()
  .storage();
const count = storage
  .find((m) => m.key().vec()?.[0]?.sym().toString() === 'Count')
  .val()
  .u32();

const indexKeys = Array.from({ length: count }, (_, i) =>
  contractKey(xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Index'), xdr.ScVal.scvU32(i)])),
);
const index = await read(indexKeys);
const subjects = index.result.entries.map((e) =>
  Address.fromScVal(xdr.LedgerEntryData.fromXDR(e.xdr, 'base64').contractData().val()).toString(),
);
const entryKeys = subjects.map((s) =>
  contractKey(xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Entry'), new Address(s).toScVal()])),
);
const entries = await read(entryKeys);

writeFileSync(
  join(OUT, 'registry-list.json'),
  JSON.stringify(
    {
      name: 'registry-list',
      description:
        'The whole D1 blacklist registry as three recorded getLedgerEntries bodies: the contract instance (Count), every Index(i), and every Entry(subject). What the playground registry panel reads (#186). Re-record with record-registry-list.mjs after a testnet reset.',
      rpc: RPC,
      recordedAt: new Date().toISOString(),
      registry: REGISTRY,
      count,
      subjects,
      keys: { instance: instanceKey, index: indexKeys, entry: entryKeys },
      responses: { instance, index, entries },
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'wrote registry-list.json:',
  count,
  'subjects,',
  entries.result.entries.length,
  'entries',
);
