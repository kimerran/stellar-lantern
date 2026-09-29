// Report an address from the playground (#187). A web page can't reach the
// Lantern extension, so the visitor's own Stellar wallet signs (decision on
// #187: Stellar Wallets Kit's modules for Freighter, xBull, Lobstr, Albedo).
// Albedo is web-based, so a reviewer can file a report with nothing installed.
//
// The report is built by the wallet's own code (src/core/registry/report.ts,
// #120) and, like any transaction, goes through Lantern's scan before anyone
// is asked to sign it: no privileged path for our own contract. Nothing here
// holds a key. Framework-free, with every network call injectable.

import {
  buildReportTx,
  checkReport,
  describeFee,
  readReportFee,
  readSubject,
  type RegistryReason,
} from '@core/registry/report';
import { TransactionBuilder } from '@stellar/stellar-sdk';
import type { ScreenAnswer } from '@lantern/scanner';
import { DEMO_NETWORK, runDemoScan, type DemoScan } from './scan';

/** The slice of a Wallets Kit module the playground uses. */
export interface DemoWallet {
  productId: string;
  productName: string;
  isAvailable(): Promise<boolean>;
  getAddress(): Promise<{ address: string }>;
  signTransaction(
    xdr: string,
    opts: { networkPassphrase: string; address: string },
  ): Promise<{ signedTxXdr: string }>;
}

/** The four wallets the decision names, loaded only when a visitor reports. */
export async function loadWallets(): Promise<DemoWallet[]> {
  const [freighter, albedo, xbull, lobstr] = await Promise.all([
    import('@creit.tech/stellar-wallets-kit/modules/freighter'),
    import('@creit.tech/stellar-wallets-kit/modules/albedo'),
    import('@creit.tech/stellar-wallets-kit/modules/xbull'),
    import('@creit.tech/stellar-wallets-kit/modules/lobstr'),
  ]);
  return [
    new albedo.AlbedoModule(),
    new freighter.FreighterModule(),
    new xbull.xBullModule(),
    new lobstr.LobstrModule(),
  ] as unknown as DemoWallet[];
}

export interface ReportDeps {
  fetchImpl?: typeof fetch;
  // Test seam for the scan gate: the pipeline dependencies runDemoScan uses.
  scan?: typeof runDemoScan;
}

export interface PreparedReport {
  xdr: string;
  fee: string; // "1 XLM", as describeFee writes it
  // The subject's registry answer before this report. A repeat report is
  // allowed (the contract counts it) but still pays the fee.
  existing: ScreenAnswer;
  scan: DemoScan;
}

export type PrepareResult =
  | { ok: true; report: PreparedReport }
  | { ok: false; error: string; unfunded?: true };

/**
 * Everything the confirmation sheet needs, in the order that matters: the
 * guards, the fee (read, never assumed), what the registry already says about
 * the subject, the transaction, and Lantern's scan of that exact transaction.
 * Only a prepared report can be signed, so the scan always comes first.
 */
export async function prepareReport(
  params: { reporter: string; subject: string; reason: RegistryReason | null },
  deps: ReportDeps = {},
): Promise<PrepareResult> {
  const reporter = params.reporter.trim();
  const subject = params.subject.trim();
  const guard = checkReport({ reporter, subject, network: DEMO_NETWORK });
  if (!guard.ok) return { ok: false, error: guard.error };
  // No default reason (#151): the visitor has to choose one.
  if (params.reason === null) return { ok: false, error: 'Choose a reason for the report.' };
  const fetchImpl = deps.fetchImpl ?? fetch;

  const [fee, existing] = await Promise.all([
    readReportFee({ network: DEMO_NETWORK, fetchImpl }),
    readSubject({ network: DEMO_NETWORK, subject, fetchImpl }),
  ]);
  if (!fee.ok) return { ok: false, error: `${fee.error} Nothing was sent.` };

  const built = await buildReportTx({
    reporter,
    subject,
    reason: params.reason,
    network: DEMO_NETWORK,
    fetchImpl,
  });
  if (!built.ok) {
    return /not funded/i.test(built.error)
      ? {
          ok: false,
          unfunded: true,
          error:
            'Your wallet’s account doesn’t exist on testnet yet. Fund it with Friendbot, then try again.',
        }
      : { ok: false, error: built.error };
  }

  const scanned = await (deps.scan ?? runDemoScan)({ xdr: built.xdr, source: reporter });
  if (!scanned.ok) return { ok: false, error: scanned.error };
  return {
    ok: true,
    report: { xdr: built.xdr, fee: describeFee(fee.fee), existing, scan: scanned.scan },
  };
}

export type SubmitResult = { ok: true; hash: string } | { ok: false; error: string };

/**
 * Sign the prepared (and scanned) XDR with the visitor's wallet, then submit
 * it to Horizon, which answers once the ledger has closed, so a read straight
 * after sees the new entry.
 */
export async function signAndSubmit(
  wallet: DemoWallet,
  report: PreparedReport,
  reporter: string,
  deps: ReportDeps = {},
): Promise<SubmitResult> {
  let signed: string;
  try {
    ({ signedTxXdr: signed } = await wallet.signTransaction(report.xdr, {
      networkPassphrase: DEMO_NETWORK.passphrase,
      address: reporter,
    }));
  } catch {
    return { ok: false, error: `${wallet.productName} didn’t sign the report. Nothing was sent.` };
  }
  // Submit only what Lantern scanned: a buggy or hostile connector could hand
  // back another transaction (other operations, a fee bump, another source).
  // The hash covers everything but the signatures.
  const hashOf = (envelope: string) =>
    TransactionBuilder.fromXDR(envelope, DEMO_NETWORK.passphrase).hash().toString('hex');
  let same: boolean;
  try {
    same = hashOf(signed) === hashOf(report.xdr);
  } catch {
    same = false;
  }
  if (!same) {
    return {
      ok: false,
      error: `${wallet.productName} returned a different transaction from the one Lantern checked. Nothing was sent.`,
    };
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${DEMO_NETWORK.horizonUrl}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ tx: signed }).toString(),
    });
    const body = (await res.json()) as {
      hash?: unknown;
      extras?: { result_codes?: { transaction?: unknown } };
    };
    if (res.ok && typeof body.hash === 'string') return { ok: true, hash: body.hash };
    const code = body.extras?.result_codes?.transaction;
    return {
      ok: false,
      error: `The network rejected the report${typeof code === 'string' ? ` (${code})` : ''}. Nothing was recorded.`,
    };
  } catch {
    return {
      ok: false,
      error:
        'Stellar testnet couldn’t be reached, so the report may not have been sent. Check your wallet’s history before trying again.',
    };
  }
}

/** Re-read the subject after a report, uncached: the video's final beat. */
export function rescreen(subject: string, deps: ReportDeps = {}): Promise<ScreenAnswer> {
  return readSubject({
    network: DEMO_NETWORK,
    subject: subject.trim(),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

export const explorerTx = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

// The registry panel (#186) listens for this and reloads after a report.
export const REGISTRY_CHANGED = 'lantern:registry-changed';

// A screening row's "Report" button sends its address to the report panel.
export const REPORT_SUBJECT = 'lantern:report-subject';
export function reportSubject(address: string): void {
  dispatchEvent(new CustomEvent(REPORT_SUBJECT, { detail: address }));
}
