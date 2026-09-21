import { describe, expect, it } from 'vitest';
import { Account, Asset, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

// Injected by vitest.config.ts from the real environment (the node-polyfills
// plugin shims `process` inside test files, so process.env is unusable here).
declare const __LANTERN_LIVE_E2E__: boolean;
import { resetWalletScanDeps, scanTx, type WalletScanInput } from '@core/scan/wallet';
import { recheckTx } from '@core/scan/recheck';
import { NETWORKS } from '@shared/constants';

// The #121 latency budget, measured against the public testnet RPC through
// the wallet's own re-check path: a classic payment (registry read only) and
// a Soroban transfer (one simulate + registry reads), plus the worst case —
// an RPC that never answers — which must land at the hard timeout.
//
//   LANTERN_LIVE_E2E=1 npx vitest run tests/scan-recheck.live.test.ts
//
// Read-only: nothing is signed or submitted.

const NETWORK = NETWORKS.TESTNET;
const FLAGGED = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const SOURCE = 'GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK';

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
};

describe.runIf(__LANTERN_LIVE_E2E__)('re-check before submit — live testnet latency', () => {
  it('classic payment and Soroban transfer, five re-checks each; then a dead RPC', async () => {
    resetWalletScanDeps();
    const lines: string[] = ['', '⏱ #121 re-check latency (testnet)'];

    // Classic payment to the demo-flagged address: registry read, no simulate.
    const payment = new TransactionBuilder(new Account(SOURCE, '1'), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: FLAGGED, asset: Asset.native(), amount: '1' }))
      .setTimeout(180)
      .build()
      .toXDR();
    const classic: WalletScanInput = {
      xdr: payment,
      networkPassphrase: NETWORK.passphrase,
      rpcUrl: NETWORK.sorobanRpcUrl,
      context: { network: 'TESTNET', fromAddress: SOURCE, destinationFunded: true },
    };
    const reviewed = await scanTx(classic);
    expect(reviewed.risk).toBe('high');
    const classicMs: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await recheckTx(reviewed, classic);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) {
        expect(r.drift).toEqual({ drifted: false });
        classicMs.push(r.latencyMs);
      }
    }
    lines.push(`  classic payment (registry read)   : ${JSON.stringify(stats(classicMs))} ms over ${classicMs.length}`);

    // A Soroban transfer: native SAC transfer from a funded throwaway, so the
    // simulate is real (auth + footprint) and the screener reads two addresses.
    const kp = Keypair.random();
    const fund = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
    expect(fund.ok).toBe(true);
    const { buildSacTransferXdr, nativeSacId } = await import('@core/stellar/sac');
    const acct = (await (await fetch(`${NETWORK.horizonUrl}/accounts/${kp.publicKey()}`)).json()) as { sequence: string };
    const sacXdr = buildSacTransferXdr({
      sacId: nativeSacId(NETWORK.passphrase),
      from: kp.publicKey(),
      to: FLAGGED,
      amountStroops: '10000000',
      sourceAccount: kp.publicKey(),
      sourceSequence: acct.sequence,
      networkPassphrase: NETWORK.passphrase,
    });
    const soroban: WalletScanInput = {
      xdr: sacXdr,
      networkPassphrase: NETWORK.passphrase,
      rpcUrl: NETWORK.sorobanRpcUrl,
      context: { network: 'TESTNET', fromAddress: kp.publicKey(), destinationFunded: true },
    };
    const reviewedS = await scanTx(soroban);
    const sorobanMs: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await recheckTx(reviewedS, soroban);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) {
        expect(r.drift).toEqual({ drifted: false });
        sorobanMs.push(r.latencyMs);
      }
    }
    lines.push(`  Soroban transfer (simulate+read)  : ${JSON.stringify(stats(sorobanMs))} ms over ${sorobanMs.length}`);

    // Worst case: an RPC that never answers. Must be the hard timeout, and a
    // failure — never a verdict.
    const dead: WalletScanInput = { ...soroban, rpcUrl: 'https://10.255.255.1/' };
    const started = performance.now();
    const r = await recheckTx(reviewedS, dead);
    const deadMs = Math.round(performance.now() - started);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['timeout', 'rpc', 'error']).toContain(r.failure);
    lines.push(`  dead RPC (worst case)             : ${deadMs} ms → ${JSON.stringify(r)}`);

    console.log(lines.join('\n') + '\n');
  }, 120_000);
});
