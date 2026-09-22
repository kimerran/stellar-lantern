#!/usr/bin/env node
// Builds fixtures/deep-auth.json (#53): a SYNTHETIC authorisation tree three
// levels deep with both credential kinds, for the auth-walk tests.
//
// Testnet has nothing to record this against — the Blend `submit` recording
// (nested-subinvocation.json) authorises one level of sub-invocation, and no
// deployed contract we use asks the user to authorise a call two levels
// down. The XDR here is built with the stellar-sdk's own constructors, so the
// *bytes* are real SorobanAuthorizationEntry XDR; only the scenario is made
// up. The file says so in its description.
//
//   node packages/lantern-scanner/fixtures/make-deep-auth.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Address, XdrLargeInt, xdr } from '@stellar/stellar-sdk';

const OUT = dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(join(OUT, 'nested-subinvocation.json'), 'utf8'));

const POOL = 'CC4KSBTTPCKZUYBXB47SSZGXTKO6G23Y6LJOIR6YCOJVTGJZEYJCHBOH';
const XLM_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC_SAC = 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU';
const USER = base.source;
const SPENDER = 'GBVG3DQJNAYAPTB4FKPLL65BUNF76K2TKPTK72LDIAJKRATGRY5BFJBP';

const addr = (a) => new Address(a).toScVal();
const i128 = (n) => new XdrLargeInt('i128', String(n)).toScVal();
const sym = (s) => xdr.ScVal.scvSymbol(s);

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

// Entry 0 — address credentials: the user (nonce + expiry) authorises
//   pool.submit(user, user, user, [ {address, amount, request_type} ])   depth 0
//     └ xlm.transfer(user, pool, 10_000_000)                              depth 1
//         └ usdc.transfer(user, spender, -5)  (negative i128 on purpose)  depth 2
//     └ xlm.approve(user, spender, MAX_I128, 4_000_000)                   depth 1
const requests = xdr.ScVal.scvVec([
  xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: sym('address'), val: addr(XLM_SAC) }),
    new xdr.ScMapEntry({ key: sym('amount'), val: i128(10_000_000) }),
    new xdr.ScMapEntry({ key: sym('request_type'), val: xdr.ScVal.scvU32(0) }),
  ]),
]);
const entry0 = new xdr.SorobanAuthorizationEntry({
  credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
    new xdr.SorobanAddressCredentials({
      address: new Address(USER).toScAddress(),
      nonce: new xdr.Int64(BigInt('-1234567890123')),
      signatureExpirationLedger: 4_700_000,
      signature: xdr.ScVal.scvVoid(),
    }),
  ),
  rootInvocation: call(
    POOL,
    'submit',
    [addr(USER), addr(USER), addr(USER), requests],
    [
      call(
        XLM_SAC,
        'transfer',
        [addr(USER), addr(POOL), i128(10_000_000)],
        [call(USDC_SAC, 'transfer', [addr(USER), addr(SPENDER), i128(-5)])],
      ),
      call(XLM_SAC, 'approve', [
        addr(USER),
        addr(SPENDER),
        i128('170141183460469231731687303715884105727'),
        xdr.ScVal.scvU32(4_000_000),
      ]),
    ],
  ),
});

// Entry 1 — source-account credentials, a flat call with the remaining
// token-interface arg types: Bytes and a nested Vec.
const entry1 = new xdr.SorobanAuthorizationEntry({
  credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
  rootInvocation: call(USDC_SAC, 'set_metadata', [
    xdr.ScVal.scvBytes(Buffer.from('0102ff', 'hex')),
    xdr.ScVal.scvVec([sym('a'), xdr.ScVal.scvVec([xdr.ScVal.scvBool(true), xdr.ScVal.scvVoid()])]),
    xdr.ScVal.scvString('hello'),
  ]),
});

const auth = [entry0.toXDR('base64'), entry1.toXDR('base64')];
const fixture = {
  name: 'deep-auth',
  description:
    'SYNTHETIC — the nested-subinvocation recording with its auth entries replaced by a three-level tree (submit → transfer → transfer, plus an approve) under address credentials, and a second source-account entry covering Bytes / nested Vec / String args. Built with stellar-sdk constructors by make-deep-auth.mjs; the bytes are real XDR, the scenario is not recorded from testnet.',
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
writeFileSync(join(OUT, 'deep-auth.json'), JSON.stringify(fixture, null, 2) + '\n');
console.log('wrote deep-auth.json with', auth.length, 'entries');
