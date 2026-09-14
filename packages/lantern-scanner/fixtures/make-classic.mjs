#!/usr/bin/env node
// Builds the classic-operation fixtures for stage 3a (#54). Deterministic and
// offline: classic ops need no simulation, so these carry `simulation: null`
// and a fixed sequence number. Real transaction XDR built with the SDK.
//
//   node packages/lantern-scanner/fixtures/make-classic.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Account,
  Asset,
  BASE_FEE,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

const OUT = dirname(fileURLToPath(import.meta.url));
const SOURCE = 'GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK';
const DEST = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const OTHER = 'GBVG3DQJNAYAPTB4FKPLL65BUNF76K2TKPTK72LDIAJKRATGRY5BFJBP';
const USDC = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
const SEQ = '4242424242';

const build = (add) =>
  add(
    new TransactionBuilder(new Account(SOURCE, SEQ), {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    }),
  )
    .setTimeout(0)
    .build()
    .toXDR();

const cases = {
  'classic-path-payment-receive': {
    description:
      'pathPaymentStrictReceive: the destination gets exactly 9 USDC; the source spends at most 10 XLM (sendMax is the risk-relevant number).',
    xdr: build((b) =>
      b.addOperation(
        Operation.pathPaymentStrictReceive({
          sendAsset: Asset.native(),
          sendMax: '10',
          destination: DEST,
          destAsset: USDC,
          destAmount: '9',
          path: [],
        }),
      ),
    ),
  },
  'classic-account-merge': {
    description: 'accountMerge: the entire XLM balance leaves and the source account closes.',
    xdr: build((b) => b.addOperation(Operation.accountMerge({ destination: DEST }))),
  },
  'classic-multi-op': {
    description:
      'Three ops: 25 XLM payment to DEST, 1.5 USDC payment to DEST, and a 0.5 XLM payment to OTHER acting for OTHER via an op-level source — aggregation must be per address, not per first op.',
    xdr: build((b) =>
      b
        .addOperation(Operation.payment({ destination: DEST, asset: Asset.native(), amount: '25' }))
        .addOperation(Operation.payment({ destination: DEST, asset: USDC, amount: '1.5' }))
        .addOperation(
          Operation.payment({
            destination: SOURCE,
            asset: Asset.native(),
            amount: '0.5',
            source: OTHER,
          }),
        ),
    ),
  },
};

for (const [name, c] of Object.entries(cases)) {
  writeFileSync(
    join(OUT, `${name}.json`),
    JSON.stringify(
      {
        name,
        description: c.description,
        networkPassphrase: Networks.TESTNET,
        source: SOURCE,
        recordedAt: null,
        rpc: null,
        xdr: c.xdr,
        simulation: null,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('wrote', name);
}
