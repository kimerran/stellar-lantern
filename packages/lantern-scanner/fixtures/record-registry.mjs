#!/usr/bin/env node
// Records fixtures/registry-hot-read.json (#57): the raw getLedgerEntries body
// for the D1 blacklist registry's `Entry(subject)` key, for the demo flagged
// address (an Active entry) and a never-reported one (no live entry). No
// source account, no signing, no fee — the O(1) hot read from
// docs/blacklist-registry.md. Re-record after a testnet reset (and update the
// contract id from the README's "Testnet smart contracts" table).
//
//   node packages/lantern-scanner/fixtures/record-registry.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Address, xdr } from '@stellar/stellar-sdk';

const OUT = dirname(fileURLToPath(import.meta.url));
const RPC = 'https://soroban-testnet.stellar.org';
const REGISTRY = 'CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F';
const FLAGGED = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const CLEAN = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';

const key = (subject) =>
  xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(REGISTRY).toScAddress(),
      key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Entry'), new Address(subject).toScVal()]),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  ).toXDR('base64');

const keys = { flagged: key(FLAGGED), clean: key(CLEAN) };
const res = await fetch(RPC, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getLedgerEntries',
    params: { keys: [keys.flagged, keys.clean] },
  }),
});
if (!res.ok) throw new Error(`RPC ${res.status}`);
const response = await res.json();
writeFileSync(
  join(OUT, 'registry-hot-read.json'),
  JSON.stringify(
    {
      name: 'registry-hot-read',
      description:
        'Recorded getLedgerEntries body for the D1 blacklist registry: the demo flagged address has a live Active entry; the clean address has no live entry and is absent from the response. Re-record with record-registry.mjs after a testnet reset.',
      rpc: RPC,
      recordedAt: new Date().toISOString(),
      registry: REGISTRY,
      subjects: { flagged: FLAGGED, clean: CLEAN },
      keys,
      response,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'wrote registry-hot-read.json:',
  response.result?.entries?.length ?? 0,
  'live entries, latestLedger',
  response.result?.latestLedger,
);
