// Report an address from the playground (#187). The visitor connects their
// own wallet, reviews a confirmation sheet (with Lantern's scan of the report
// transaction itself), signs in their wallet, and sees the address re-screen
// as reported: the walkthrough's last beat.

import { useEffect, useRef, useState } from 'react';
import { REGISTRY_REASONS, type RegistryReason } from '@core/registry/report';
import type { ScreenAnswer } from '@lantern/scanner';
import {
  explorerTx,
  loadWallets,
  prepareReport,
  REGISTRY_CHANGED,
  REPORT_SUBJECT,
  rescreen,
  signAndSubmit,
  type DemoWallet,
  type PreparedReport,
} from './report';
import { DEMO_NETWORK, resetDemoScreening } from './scan';
import { ScanResultView } from './ScanPanel';

type Step =
  | { kind: 'form' }
  | { kind: 'preparing' }
  | { kind: 'review'; report: PreparedReport }
  | { kind: 'signing'; report: PreparedReport }
  | { kind: 'done'; hash: string; after: ScreenAnswer | null };

const field =
  'w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary-container focus:outline-none';

// What each wallet button promises. Albedo and xBull always work: Albedo is a
// web wallet, and xBull falls back to its web wallet when no extension is
// installed. The two extension-only wallets say when they're missing.
export function walletNote(productId: string, available: boolean): string {
  if (productId === 'albedo') return 'Web wallet, nothing to install';
  if (productId === 'xbull') return 'Extension, or its web wallet in a new window';
  return available ? 'Extension detected' : 'Not installed in this browser';
}

function countOf(a: ScreenAnswer): number | null {
  return a.entry ? a.entry.reports : null;
}

/** The confirmation sheet: everything the visitor agrees to before signing. */
export function ReportReview({
  report,
  subject,
  reason,
  wallet,
  acknowledged,
  onAcknowledge,
}: {
  report: PreparedReport;
  subject: string;
  reason: RegistryReason;
  wallet: string;
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
}) {
  const repeat = countOf(report.existing);
  const gated = report.scan.result.action === 'block_confirm';
  return (
    <div className="space-y-3" data-testid="report-review">
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs text-on-surface-variant">Address you’re reporting</dt>
          <dd className="break-all font-mono text-on-surface">{subject}</dd>
        </div>
        <div>
          <dt className="text-xs text-on-surface-variant">Reason</dt>
          <dd className="text-on-surface">{reason}</dd>
        </div>
        <div>
          <dt className="text-xs text-on-surface-variant">Registry fee</dt>
          <dd className="text-on-surface" data-testid="report-fee">
            {report.fee}, plus the network fee, paid from your wallet
          </dd>
        </div>
      </dl>
      {repeat !== null && (
        <p
          role="note"
          className="rounded-xl border border-secondary/40 bg-secondary-container/10 p-3 text-sm text-on-surface"
        >
          This address is already in the registry ({repeat} report{repeat === 1 ? '' : 's'},{' '}
          {report.existing.entry?.status}). Reporting again adds one to the count and{' '}
          <strong>still charges the fee</strong>.
        </p>
      )}
      <p className="text-sm text-on-surface">
        This report is <strong>public and permanent</strong>, and it’s recorded on-chain against
        your address.
      </p>
      <div>
        <p className="text-xs uppercase tracking-wide text-on-surface-variant">
          Lantern’s scan of this report transaction
        </p>
        <p className="mb-2 text-xs text-on-surface-variant">
          Our own contract gets no shortcut: the report is checked like any other transaction before
          you sign it.
        </p>
        <ScanResultView scan={report.scan} />
      </div>
      {gated && (
        <label className="flex items-start gap-2 text-sm text-on-surface">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => onAcknowledge(e.target.checked)}
          />
          I’ve read the warning above and still want {wallet} to sign this report.
        </label>
      )}
    </div>
  );
}

export function ReportPanel() {
  const [subject, setSubject] = useState('');
  const [reason, setReason] = useState<RegistryReason | null>(null);
  const [wallets, setWallets] = useState<Array<{ w: DemoWallet; available: boolean }> | null>(null);
  const [wallet, setWallet] = useState<{ w: DemoWallet; address: string } | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [error, setError] = useState<{ message: string; unfunded?: boolean } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onSubject = (e: Event) => {
      setSubject(String((e as CustomEvent<string>).detail));
      setStep({ kind: 'form' });
      setError(null);
      root.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    addEventListener(REPORT_SUBJECT, onSubject);
    return () => removeEventListener(REPORT_SUBJECT, onSubject);
  }, []);

  async function showWallets() {
    setError(null);
    try {
      const list = await loadWallets();
      setWallets(
        await Promise.all(
          list.map(async (w) => ({ w, available: await w.isAvailable().catch(() => false) })),
        ),
      );
    } catch {
      setError({ message: 'The wallet list couldn’t be loaded. Try again.' });
    }
  }

  async function connect(w: DemoWallet) {
    setError(null);
    try {
      const { address } = await w.getAddress();
      setWallet({ w, address });
      setWallets(null);
    } catch {
      setError({ message: `${w.productName} didn’t share an address. Nothing was connected.` });
    }
  }

  async function review() {
    if (!wallet) return;
    setError(null);
    setAcknowledged(false);
    setStep({ kind: 'preparing' });
    const out = await prepareReport({ reporter: wallet.address, subject, reason });
    if (!out.ok) {
      setError({ message: out.error, ...(out.unfunded ? { unfunded: true } : {}) });
      setStep({ kind: 'form' });
      return;
    }
    setStep({ kind: 'review', report: out.report });
  }

  async function sign(report: PreparedReport) {
    if (!wallet) return;
    setError(null);
    setStep({ kind: 'signing', report });
    const out = await signAndSubmit(wallet.w, report, wallet.address);
    if (!out.ok) {
      setError({ message: out.error });
      setStep({ kind: 'review', report });
      return;
    }
    const after = await rescreen(subject).catch(() => null);
    setStep({ kind: 'done', hash: out.hash, after });
    // The next scan of a payment to this address must see the new entry.
    resetDemoScreening();
    dispatchEvent(new Event(REGISTRY_CHANGED));
  }

  const friendbot = wallet
    ? `${DEMO_NETWORK.friendbotUrl}?addr=${encodeURIComponent(wallet.address)}`
    : '';
  const busy = step.kind === 'preparing' || step.kind === 'signing';

  return (
    <div ref={root} className="space-y-4" data-testid="report-panel">
      <p className="text-sm text-on-surface-variant">
        Add an address to the on-chain scam registry, signed by your own Stellar wallet. Testnet
        only.
      </p>

      {step.kind !== 'done' && (
        <div className="grid gap-3">
          <label className="block space-y-1">
            <span className="text-sm text-on-surface-variant">Address to report (G… or C…)</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              spellCheck={false}
              disabled={busy || step.kind === 'review'}
              className={`${field} font-mono`}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-on-surface-variant">Reason</span>
            <select
              value={reason ?? ''}
              onChange={(e) => setReason((e.target.value || null) as RegistryReason | null)}
              disabled={busy || step.kind === 'review'}
              className={field}
            >
              <option value="">Choose a reason…</option>
              {REGISTRY_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {!wallet && step.kind === 'form' && (
        <div className="space-y-2">
          {wallets === null ? (
            <button
              type="button"
              onClick={() => void showWallets()}
              className="rounded-xl border border-outline-variant px-4 py-2 text-sm font-semibold text-on-surface"
            >
              Connect a wallet to report
            </button>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2" aria-label="Choose a wallet">
              {wallets.map(({ w, available }) => (
                <li key={w.productId}>
                  <button
                    type="button"
                    disabled={!available}
                    onClick={() => void connect(w)}
                    className="w-full rounded-xl border border-outline-variant px-3 py-2 text-left text-sm text-on-surface disabled:opacity-50"
                  >
                    <span className="font-semibold">{w.productName}</span>
                    <span className="block text-xs text-on-surface-variant">
                      {walletNote(w.productId, available)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {wallet && step.kind !== 'done' && (
        <p className="break-all text-xs text-on-surface-variant">
          Connected: {wallet.w.productName} · <span className="font-mono">{wallet.address}</span>
        </p>
      )}

      {wallet && (step.kind === 'form' || step.kind === 'preparing') && (
        <button
          type="button"
          onClick={() => void review()}
          disabled={busy}
          className="rounded-xl bg-primary-container px-4 py-2 font-semibold text-on-primary disabled:opacity-60"
        >
          {step.kind === 'preparing' ? 'Preparing…' : 'Review the report'}
        </button>
      )}

      {(step.kind === 'review' || step.kind === 'signing') && wallet && reason && (
        <>
          <ReportReview
            report={step.report}
            subject={subject.trim()}
            reason={reason}
            wallet={wallet.w.productName}
            acknowledged={acknowledged}
            onAcknowledge={setAcknowledged}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void sign(step.report)}
              disabled={
                step.kind === 'signing' ||
                (step.report.scan.result.action === 'block_confirm' && !acknowledged)
              }
              className="rounded-xl bg-primary-container px-4 py-2 font-semibold text-on-primary disabled:opacity-60"
            >
              {step.kind === 'signing'
                ? `Waiting for ${wallet.w.productName}…`
                : `Sign with ${wallet.w.productName} and report`}
            </button>
            <button
              type="button"
              onClick={() => setStep({ kind: 'form' })}
              disabled={step.kind === 'signing'}
              className="rounded-xl border border-outline-variant px-4 py-2 text-sm text-on-surface"
            >
              Change
            </button>
          </div>
        </>
      )}

      {step.kind === 'done' && (
        <div
          className="space-y-2 rounded-2xl border border-tertiary-container/40 bg-tertiary-container/10 p-4 text-sm text-on-surface"
          data-testid="report-done"
        >
          <p className="font-semibold">Reported.</p>
          <p className="break-all">
            <a
              href={explorerTx(step.hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              See the transaction on stellar.expert
            </a>
          </p>
          <p>
            Checked again just now:{' '}
            {step.after?.outcome === 'flagged' ? (
              <strong className="text-error">
                Reported in the scam registry ({step.after.entry?.reports} report
                {step.after.entry?.reports === 1 ? '' : 's'})
              </strong>
            ) : step.after?.outcome === 'not_flagged' ? (
              <span>in the registry, but not Active, so Lantern doesn’t warn on it</span>
            ) : (
              <span>
                the registry couldn’t be read right now. Scan a payment to it to check again.
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              setStep({ kind: 'form' });
              setSubject('');
              setReason(null);
            }}
            className="text-primary underline"
          >
            Report another address
          </button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-error/30 bg-error-container/15 p-3 text-sm text-on-surface"
        >
          {error.message}
          {error.unfunded && (
            <a
              href={friendbot}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 text-primary underline"
            >
              Fund it with Friendbot
            </a>
          )}
        </p>
      )}
    </div>
  );
}
