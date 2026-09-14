#!/usr/bin/env node
// Builds fixtures/token-admin.json (#55): a SYNTHETIC auth tree exercising
// the SEP-41 admin functions the scanner must decode — mint, burn, clawback
// — plus look-alikes that must NOT be recognised (transfer_from, transferAll,
// a 2-arg transfer). The USDC SAC's admin is an issuer we do not control, so
// none of this can be recorded from testnet; the bytes are real XDR built
// with SDK constructors, the scenario is made up, and the file says so.
//
//   node packages/lantern-scanner/fixtures/make-token-admin.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Address, XdrLargeInt, xdr } from '@stellar/stellar-sdk';

const OUT = dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(join(OUT, 'sac-transfer.json'), 'utf8'));

const USDC_SAC = 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU';
const POOL = 'CC4KSBTTPCKZUYBXB47SSZGXTKO6G23Y6LJOIR6YCOJVTGJZEYJCHBOH';
const USER = base.source;
const DEST = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';

const addr = (a) => new Address(a).toScVal();
const i128 = (n) => new XdrLargeInt('i128', String(n)).toScVal();

function call(contractId, fn, args, subs = []) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(contractId).toScAddress(),
        functionName: fn,
        args,
      }),
    ),
    subInvocations: subs,
  });
}
const entry = (root) =>
  new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(USER).toScAddress(),
        nonce: new xdr.Int64(1),
        signatureExpirationLedger: 4_700_000,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: root,
  }).toXDR('base64');

// A value above Number.MAX_SAFE_INTEGER, to prove i128 → BigInt is exact.
const BIG = '9007199254740993';

const auth = [
  // Root: some pool function that, as sub-invocations, mints to the user,
  // burns from the user, and claws back from the user — each only visible
  // as a sub-invocation.
  entry(
    call(
      POOL,
      'rebalance',
      [addr(USER)],
      [
        call(USDC_SAC, 'mint', [addr(USER), i128(BIG)]),
        call(USDC_SAC, 'burn', [addr(USER), i128(2_500_000)]),
        call(USDC_SAC, 'clawback', [addr(USER), i128(1)]),
      ],
    ),
  ),
  // Look-alikes: must stay unrecognised.
  entry(call(USDC_SAC, 'transfer_from', [addr(USER), addr(USER), addr(DEST), i128(5)])),
  entry(call(USDC_SAC, 'transferAll', [addr(USER), addr(DEST)])),
  entry(call(USDC_SAC, 'transfer', [addr(USER), addr(DEST)])),
];

const fixture = {
  name: 'token-admin',
  description:
    'SYNTHETIC — the sac-transfer recording with its auth entries replaced: a pool call whose sub-invocations mint (above MAX_SAFE_INTEGER), burn and clawback USDC from the user, plus transfer_from / transferAll / a 2-arg transfer that must NOT be recognised as the token interface. Built with stellar-sdk constructors by make-token-admin.mjs; the bytes are real XDR, the scenario is not recorded from testnet.',
  networkPassphrase: base.networkPassphrase,
  source: base.source,
  recordedAt: base.recordedAt,
  rpc: base.rpc,
  synthetic: true,
  xdr: base.xdr,
  simulation: {
    ...base.simulation,
    result: {
      ...base.simulation.result,
      results: [{ ...base.simulation.result.results[0], auth }],
    },
  },
};
writeFileSync(join(OUT, 'token-admin.json'), JSON.stringify(fixture, null, 2) + '\n');
console.log('wrote token-admin.json with', auth.length, 'entries');
