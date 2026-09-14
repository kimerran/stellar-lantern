#!/usr/bin/env node
// Records the scanner fixture corpus (#51): real base64 XDR for each case the
// D2 slices need, plus the *raw* `simulateTransaction` JSON-RPC body from
// testnet for the Soroban ones. The suite reads the JSON files this writes and
// never touches the network — re-run this only to refresh the corpus (e.g.
// after a testnet reset moves the contract ids in README "Testnet smart
// contracts").
//
//   node packages/lantern-scanner/fixtures/record.mjs [--source G…] [--rpc URL]
//
// The source account must exist on testnet (simulation loads it); the default
// is the `lantern-deployer` identity from scripts/deploy-blacklist-registry.sh.
// Nothing is signed or submitted.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
  XdrLargeInt,
  xdr,
} from '@stellar/stellar-sdk';

const OUT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const SOURCE = flag('--source', 'GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK');
const RPC = flag('--rpc', 'https://soroban-testnet.stellar.org');
const HORIZON = 'https://horizon-testnet.stellar.org';
const PASSPHRASE = Networks.TESTNET;

// Ids from README "Testnet smart contracts".
const XLM_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC_SAC = 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU';
const LANTERN_POOL = 'CC4KSBTTPCKZUYBXB47SSZGXTKO6G23Y6LJOIR6YCOJVTGJZEYJCHBOH';
// A syntactically valid contract id that is not deployed anywhere.
const UNKNOWN_CONTRACT = 'CBIVCUKRKFIVCUKRKFIVCUKRKFIVCUKRKFIVCUKRKFIVCUKRKFIVCR62'; // StrKey of 32 × 0x51
// Ordinary (not flagged) counterparties.
const DEST = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const SPENDER = 'GBVG3DQJNAYAPTB4FKPLL65BUNF76K2TKPTK72LDIAJKRATGRY5BFJBP';

async function latestLedger() {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status} on getLatestLedger`);
  return (await res.json()).result.sequence;
}

async function sequence() {
  const res = await fetch(`${HORIZON}/accounts/${SOURCE}`);
  if (!res.ok) throw new Error(`Horizon ${res.status} loading ${SOURCE}`);
  return (await res.json()).sequence;
}

function builder(seq) {
  return new TransactionBuilder(new Account(SOURCE, seq), {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  });
}
const addr = (a) => new Address(a).toScVal();
const i128 = (n) => new XdrLargeInt('i128', String(n)).toScVal();

function build(seq, ledger) {
  const tx = (b) => b.setTimeout(300).build().toXDR();
  return {
    'classic-payment': {
      description: 'Classic payment: 25 XLM to an ordinary funded account, text memo.',
      soroban: false,
      xdr: tx(
        builder(seq)
          .addOperation(
            Operation.payment({ destination: DEST, asset: Asset.native(), amount: '25' }),
          )
          .addMemo(Memo.text('coffee')),
      ),
    },
    'path-payment': {
      description:
        'pathPaymentStrictSend: 10 XLM → at least 9 USDC, proceeds to the source itself.',
      soroban: false,
      xdr: tx(
        builder(seq).addOperation(
          Operation.pathPaymentStrictSend({
            sendAsset: Asset.native(),
            sendAmount: '10',
            destination: SOURCE,
            destAsset: new Asset(
              'USDC',
              'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
            ),
            destMin: '9',
            path: [],
          }),
        ),
      ),
    },
    'sac-transfer': {
      description: 'SAC token-interface call: XLM SAC `transfer(from, to, 5 XLM)`.',
      soroban: true,
      xdr: tx(
        builder(seq).addOperation(
          new Contract(XLM_SAC).call('transfer', addr(SOURCE), addr(DEST), i128(50_000_000)),
        ),
      ),
    },
    'sep41-approve': {
      description:
        'SEP-41 `approve(from, spender, amount, expiration_ledger)` on the USDC SAC — the "unlimited approval" shape.',
      soroban: true,
      xdr: tx(
        builder(seq).addOperation(
          new Contract(USDC_SAC).call(
            'approve',
            addr(SOURCE),
            addr(SPENDER),
            i128('170141183460469231731687303715884105727'),
            // expiration_ledger must be ≥ the current ledger or the SAC rejects it (Error #9).
            xdr.ScVal.scvU32(ledger + 1_000_000),
          ),
        ),
      ),
    },
    'nested-subinvocation': {
      description:
        'Blend `submit` supply of 1 XLM on the Lantern Earn pool: the pool calls the XLM SAC `transfer` as a nested sub-invocation, so the auth tree has depth > 1.',
      soroban: true,
      xdr: tx(
        builder(seq).addOperation(
          new Contract(LANTERN_POOL).call(
            'submit',
            addr(SOURCE),
            addr(SOURCE),
            addr(SOURCE),
            xdr.ScVal.scvVec([
              xdr.ScVal.scvMap([
                new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('address'), val: addr(XLM_SAC) }),
                new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('amount'), val: i128(10_000_000) }),
                new xdr.ScMapEntry({
                  key: xdr.ScVal.scvSymbol('request_type'),
                  val: xdr.ScVal.scvU32(0),
                }),
              ]),
            ]),
          ),
        ),
      ),
    },
    'unknown-contract': {
      description:
        'Call to a contract id that is not deployed: simulation fails, the scanner must not guess.',
      soroban: true,
      xdr: tx(
        builder(seq).addOperation(new Contract(UNKNOWN_CONTRACT).call('do_thing', addr(SOURCE))),
      ),
    },
    'malformed-xdr': {
      description: 'Not a transaction envelope at all; the pipeline must fail closed.',
      soroban: false,
      xdr: 'AAAAAgAAAABub3QtYS10cmFuc2FjdGlvbg==',
    },
  };
}

async function simulate(xdrB64) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: { transaction: xdrB64 },
    }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  return res.json();
}

const seq = await sequence();
const ledger = await latestLedger();
const cases = build(seq, ledger);
const index = [];
for (const [name, c] of Object.entries(cases)) {
  const simulation = c.soroban ? await simulate(c.xdr) : null;
  const fixture = {
    name,
    description: c.description,
    networkPassphrase: PASSPHRASE,
    source: SOURCE,
    recordedAt: new Date().toISOString(),
    rpc: c.soroban ? RPC : null,
    xdr: c.xdr,
    simulation,
  };
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(fixture, null, 2) + '\n');
  const status = simulation ? (simulation.result?.error ? 'sim: error' : 'sim: ok') : 'no sim';
  console.log(`${name.padEnd(22)} ${status}`);
  index.push(name);
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
