import { describe, it, expect } from 'vitest';
import {
  Account,
  Asset,
  Contract,
  Memo,
  nativeToScVal,
  Networks,
  Operation,
  TransactionBuilder,
  type xdr,
} from '@stellar/stellar-sdk';
import { scan, decodeTransaction, explainTransaction } from '@lantern/scanner';

// Pins today's single-operation explanations and legacy verdicts (#261). The
// whole-transaction explainer and the sponsorship rules that #261 adds must
// leave every one of these byte-for-byte unchanged; the snapshot file was
// written BEFORE that change landed.

const pp = Networks.TESTNET;
const USER = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const DEST = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', ISSUER);
const CID = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';

function single(op: xdr.Operation, memo?: string): string {
  const b = new TransactionBuilder(new Account(USER, '1'), { fee: '100', networkPassphrase: pp })
    .addOperation(op)
    .setTimeout(180);
  if (memo) b.addMemo(Memo.text(memo));
  return b.build().toXDR();
}

const CASES: Record<string, string> = {
  'payment XLM': single(Operation.payment({ destination: DEST, asset: Asset.native(), amount: '12.5' })),
  'payment USDC': single(Operation.payment({ destination: DEST, asset: USDC, amount: '1000' })),
  'payment with memo': single(
    Operation.payment({ destination: DEST, asset: Asset.native(), amount: '3' }),
    'invoice 42',
  ),
  'payment with scam memo': single(
    Operation.payment({ destination: DEST, asset: Asset.native(), amount: '3' }),
    'claim your airdrop',
  ),
  'payment to deny-listed': single(
    Operation.payment({
      destination: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
      asset: Asset.native(),
      amount: '5',
    }),
  ),
  createAccount: single(Operation.createAccount({ destination: DEST, startingBalance: '2' })),
  'strict-send swap': single(
    Operation.pathPaymentStrictSend({
      sendAsset: Asset.native(),
      sendAmount: '100',
      destination: USER,
      destAsset: USDC,
      destMin: '24.3',
      path: [],
    }),
  ),
  'strict-receive swap to other': single(
    Operation.pathPaymentStrictReceive({
      sendAsset: Asset.native(),
      sendMax: '110',
      destination: DEST,
      destAsset: USDC,
      destAmount: '25',
      path: [],
    }),
  ),
  'setOptions add signer': single(
    Operation.setOptions({ signer: { ed25519PublicKey: DEST, weight: 1 } }),
  ),
  'setOptions remove signer': single(
    Operation.setOptions({ signer: { ed25519PublicKey: DEST, weight: 0 } }),
  ),
  'setOptions master 0 + thresholds': single(
    Operation.setOptions({ masterWeight: 0, lowThreshold: 1, medThreshold: 2, highThreshold: 3 }),
  ),
  'setOptions home domain': single(Operation.setOptions({ homeDomain: 'example.com' })),
  accountMerge: single(Operation.accountMerge({ destination: DEST })),
  manageData: single(Operation.manageData({ name: 'foo', value: 'bar' })),
  'invoke supply': single(new Contract(CID).call('supply', nativeToScVal(1, { type: 'i128' }))),
  'invoke unknown fn': single(new Contract(CID).call('frobnicate')),
};

describe('single-op explanations are pinned (#261)', () => {
  for (const [name, txXdr] of Object.entries(CASES)) {
    it(name, () => {
      const decoded = decodeTransaction(txXdr, pp);
      const v = scan({
        xdr: txXdr,
        networkPassphrase: pp,
        context: { network: 'TESTNET', fromAddress: USER, destinationFunded: true, spendableXlm: '1000' },
      });
      expect({
        explanation: explainTransaction(decoded),
        risk: v.risk,
        reasons: v.reasons.map((r) => `${r.code}:${r.severity}`),
      }).toMatchSnapshot();
    });
  }

  it('undecodable', () => {
    expect(explainTransaction(decodeTransaction('AAAA', pp))).toMatchSnapshot();
  });
});
