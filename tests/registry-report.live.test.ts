import { describe, expect, it } from 'vitest';
import { Horizon, Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

// Injected by vitest.config.ts from the real environment (the node-polyfills
// plugin shims `process` inside test files, so process.env is unusable here).
declare const __LANTERN_LIVE_E2E__: boolean;
import { buildReportTx, describeFee, readReportFee, readSubject } from '@core/registry/report';
import { NETWORKS } from '@shared/constants';

// The #120 acceptance run against the deployed testnet registry, end to end
// through the wallet's own code: the fee read the sheet shows, the built
// `report()` invoke, the same sign + Horizon `submitTransaction` route the
// session handler's SIGN_AND_SUBMIT takes, and the hot read the sheet shows
// afterwards. Asserts the treasury moved by exactly `Config::fee` in the
// same transaction, the way scripts/smoke-blacklist-registry.sh does for D1.
//
//   LANTERN_LIVE_E2E=1 npx vitest run tests/registry-report.live.test.ts
//
// Spends 2 XLM of Friendbot money and writes two entries' worth of reports
// to a throwaway subject. Testnet only.

const NETWORK = NETWORKS.TESTNET;
const FRIENDBOT = 'https://friendbot.stellar.org';

async function fund(pub: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT}?addr=${pub}`);
  if (!res.ok) throw new Error(`friendbot ${res.status}`);
}

async function nativeBalance(server: Horizon.Server, account: string): Promise<bigint> {
  const acc = await server.loadAccount(account);
  const bal = acc.balances.find((b) => b.asset_type === 'native');
  if (!bal) throw new Error('no native balance');
  return BigInt(bal.balance.replace('.', '')); // 7 dp → stroops
}

describe.runIf(__LANTERN_LIVE_E2E__)('one-click report — live testnet', () => {
  it('reports a fresh subject, routes the fee, then reports it again', async () => {
    const server = new Horizon.Server(NETWORK.horizonUrl);
    const reporter = Keypair.random();
    const subject = Keypair.random().publicKey(); // never funded: the registry keys on Address
    await fund(reporter.publicKey());

    // 1. The fee the sheet shows, read from config() with no transaction.
    const fee = await readReportFee({ network: NETWORK });
    expect(fee.ok).toBe(true);
    if (!fee.ok) return;
    expect(describeFee(fee.fee)).toBe('1 XLM');
    const feeStroops = BigInt(fee.fee.fee);
    expect(fee.fee.treasury).not.toBe(reporter.publicKey());

    // 2. Nothing on chain for the subject yet.
    expect(await readSubject({ network: NETWORK, subject })).toMatchObject({ outcome: 'not_flagged' });
    const before = await nativeBalance(server, fee.fee.treasury);

    // 3. Build → sign → submit, exactly as the wallet does.
    const submit = async (reason: 'Scam' | 'Phishing') => {
      const built = await buildReportTx({ reporter: reporter.publicKey(), subject, reason, network: NETWORK });
      expect(built.ok, JSON.stringify(built)).toBe(true);
      if (!built.ok) throw new Error(built.error);
      const tx = TransactionBuilder.fromXDR(built.xdr, NETWORK.passphrase);
      tx.sign(reporter);
      const res = await server.submitTransaction(tx);
      expect(res.successful).toBe(true);
      return res.hash;
    };
    const hash1 = await submit('Scam');

    // 4. Count 1, flagged, attributed to us; the treasury gained exactly the fee.
    const after1 = await readSubject({ network: NETWORK, subject });
    expect(after1.outcome).toBe('flagged');
    expect(after1.entry).toMatchObject({ reports: 1, reporter: reporter.publicKey(), reason: 'Scam', status: 'Active' });
    const mid = await nativeBalance(server, fee.fee.treasury);
    expect(mid - before).toBe(feeStroops);

    // 5. Repeat report: count moves, attribution and reported_at do not, fee charged again.
    const hash2 = await submit('Phishing');
    const after2 = await readSubject({ network: NETWORK, subject });
    expect(after2.entry).toMatchObject({
      reports: 2,
      reporter: reporter.publicKey(),
      reason: 'Scam',
      reportedAt: after1.entry!.reportedAt,
      status: 'Active',
    });
    const end = await nativeBalance(server, fee.fee.treasury);
    expect(end - mid).toBe(feeStroops);

    console.log(
      [
        '',
        '✅ #120 live evidence',
        `  reporter  : ${reporter.publicKey()}`,
        `  subject   : ${subject}`,
        `  fee       : ${describeFee(fee.fee)} → ${fee.fee.treasury} (${before} → ${mid} → ${end})`,
        `  report #1 : ${NETWORK.explorerTxUrl(hash1)}  (count 1)`,
        `  report #2 : ${NETWORK.explorerTxUrl(hash2)}  (count 2, first reporter/reason/reported_at kept)`,
        '',
      ].join('\n'),
    );
  }, 120_000);
});
