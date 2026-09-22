#!/usr/bin/env node
// Records fixtures/token-metadata.json (#55): the raw getLedgerEntries body
// for the XLM and USDC SAC contract instances on testnet. No source account,
// no signing — the same fee-free read path as the D1 hot read.
//
//   node packages/lantern-scanner/fixtures/record-token-metadata.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Address, xdr } from '@stellar/stellar-sdk';

const OUT = dirname(fileURLToPath(import.meta.url));
const RPC = 'https://soroban-testnet.stellar.org';
const CONTRACTS = [
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC', // XLM SAC
  'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU', // USDC SAC
];

const keys = CONTRACTS.map((id) =>
  xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(id).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  ).toXDR('base64'),
);
const res = await fetch(RPC, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLedgerEntries', params: { keys } }),
});
if (!res.ok) throw new Error(`RPC ${res.status}`);
const response = await res.json();
writeFileSync(
  join(OUT, 'token-metadata.json'),
  JSON.stringify(
    {
      name: 'token-metadata',
      description:
        "Recorded getLedgerEntries response for the contract-instance entries of the XLM SAC and the USDC SAC (README 'Reserve / asset tokens'). The instance storage carries METADATA {decimal, name, symbol} and AssetInfo; the token-metadata resolver reads these without a source account. Re-record with record-token-metadata.mjs after a testnet reset.",
      rpc: RPC,
      recordedAt: new Date().toISOString(),
      contracts: CONTRACTS,
      keys,
      response,
    },
    null,
    2,
  ) + '\n',
);
console.log('wrote token-metadata.json with', response.result?.entries?.length ?? 0, 'entries');
