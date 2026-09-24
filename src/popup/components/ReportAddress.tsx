import { useEffect, useState } from 'react';
import { track } from '@core/telemetry';
import type { NetworkConfig } from '@shared/constants';
import { sendMessage } from '@shared/messages';
import type { ScanVerdict, ScreenAnswer } from '@core/scan';
import {
  REGISTRY_REASONS,
  buildReportTx,
  checkReport,
  describeFee,
  evidenceHash,
  isRegistryReason,
  readReportFee,
  readSubject,
  registryFor,
  type ReportFee,
  type RegistryReason,
} from '@core/registry/report';
import { Button } from './Button';
import { Input } from './Input';
import { Icon } from './Icon';

// The one-click report to the on-chain registry (#120). Two entry points share
// this: the pre-sign review (one row per screened counterparty) and TxDetail
// (a counterparty from a transaction that already happened — the realistic
// case; people work out they were scammed afterwards).
//
// The sheet exists to make "one click" honest. Reporting spends the user's
// money and records their address on chain, so before signing it shows the
// subject IN FULL (a poisoned lookalike is the whole point), the fee and its
// token — read from the contract, never assumed — and the one sentence that
// says what a report is. Keys never leave the session: the built XDR goes
// through the same SIGN_AND_SUBMIT as a payment.

export interface ReportSubject {
  address: string;
  // The registry's answer from the scan, when there was one: drives the
  // "already N reports / report it too" wording and the repeat-fee warning.
  screening?: ScreenAnswer;
}

// The counterparties the scan screened, minus the reporter — what the review
// screens hand to <ReportCounterparties>. Empty when the legacy engine ran.
//
// The screener also checks every contract the transaction touches (the DEX
// router, a Blend pool, a SAC), so on Swap and Earn the list would otherwise
// offer "Report this address" for infrastructure. A contract is offered only
// when the registry already flags it; accounts (G…) are always offered.
export function counterpartiesOf(verdict: ScanVerdict | null, reporter: string): ReportSubject[] {
  if (!verdict?.screening) return [];
  return verdict.screening
    .filter((s) => s.address !== reporter)
    .filter((s) => !s.address.startsWith('C') || s.answer.outcome === 'flagged')
    .map((s) => ({ address: s.address, screening: s.answer }));
}

interface ListProps {
  reporter: string;
  network: NetworkConfig;
  subjects: ReportSubject[];
}

// One entry row per subject. Renders nothing at all on a network without a
// registry (PUBLIC): a disabled button the user cannot explain is worse than
// no button (#120 §5).
export function ReportCounterparties({ reporter, network, subjects }: ListProps) {
  if (!registryFor(network)) return null;
  const rows = subjects.filter((s) => checkReport({ reporter, subject: s.address, network }).ok);
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      {rows.map((s) => (
        <ReportAddress key={s.address} reporter={reporter} network={network} subject={s} />
      ))}
    </div>
  );
}

type Stage = 'entry' | 'sheet' | 'submitting' | 'done';

type FeeStatus = 'loading' | 'ok' | 'unknown';

// Whether the sheet may submit. The reason goes on a public, permanent
// registry, so there is no default: an untouched select must not write Scam
// on the reporter's behalf (#151). A narrowing guard, so `submit` needs no
// cast to hand the reason on.
export function canSubmitReport(state: {
  reason: RegistryReason | null;
  fee: FeeStatus;
  busy: boolean;
}): state is { reason: RegistryReason; fee: FeeStatus; busy: false } {
  return state.reason !== null && state.fee !== 'loading' && !state.busy;
}

// The select's value back to a reason: the placeholder ('') and anything
// outside the closed set are "no reason chosen".
export function reasonFromSelect(value: string): RegistryReason | null {
  return isRegistryReason(value) ? value : null;
}

interface Props {
  reporter: string;
  network: NetworkConfig;
  subject: ReportSubject;
}

export function ReportAddress({ reporter, network, subject }: Props) {
  const [stage, setStage] = useState<Stage>('entry');
  const [reason, setReason] = useState<RegistryReason | null>(null);
  const [note, setNote] = useState('');
  const [fee, setFee] = useState<
    { status: 'loading' } | { status: 'ok'; fee: ReportFee } | { status: 'unknown' }
  >({
    status: 'loading',
  });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ hash: string; count: number | null } | null>(null);

  const entry = subject.screening?.entry;
  const flagged = subject.screening?.outcome === 'flagged';
  const disputed = entry?.status === 'Disputed';
  const hasEntry = !!entry && entry.status !== 'Revoked';

  // Read the fee when the sheet opens — never before the user asked, never
  // assumed. "unknown" is a state the sheet shows, not a zero.
  useEffect(() => {
    if (stage !== 'sheet') return;
    let cancelled = false;
    setFee({ status: 'loading' });
    void readReportFee({ network }).then((r) => {
      if (cancelled) return;
      setFee(r.ok ? { status: 'ok', fee: r.fee } : { status: 'unknown' });
    });
    return () => {
      cancelled = true;
    };
  }, [stage, network]);

  if (!registryFor(network)) return null;
  const guard = checkReport({ reporter, subject: subject.address, network });
  if (!guard.ok) return null;

  async function submit() {
    // The button is disabled without a reason; this is the same rule, and it
    // narrows `reason` for the build and the telemetry below.
    const state = { reason, fee: fee.status, busy: stage === 'submitting' };
    if (!canSubmitReport(state)) return;
    const chosen = state.reason;
    setStage('submitting');
    setError(null);
    const built = await buildReportTx({
      reporter,
      subject: subject.address,
      reason: chosen,
      // The commitment is sha256 of the note exactly as typed; trim only
      // decides whether there is a note at all.
      ...(note.trim() ? { evidence: evidenceHash(note) } : {}),
      network,
    });
    if (!built.ok) {
      setError(built.error);
      setStage('sheet');
      return;
    }
    const res = await sendMessage({
      type: 'SIGN_AND_SUBMIT',
      xdr: built.xdr,
      networkPassphrase: network.passphrase,
      horizonUrl: network.horizonUrl,
    });
    if (!res.ok) {
      if (__FEATURE_TELEMETRY__) track.registryReport(chosen, false);
      setError(
        res.code === 'LOCKED'
          ? 'Wallet locked. Close and reopen to unlock, then try again.'
          : res.error,
      );
      setStage('sheet');
      return;
    }
    if (__FEATURE_TELEMETRY__) track.registryReport(chosen, true);
    // Horizon returned after the ledger closed, so the hot read sees the
    // write: the subject's new total is `entry.reports`.
    const after = await readSubject({ network, subject: subject.address });
    setResult({ hash: res.data.hash, count: after.entry ? after.entry.reports : null });
    setStage('done');
  }

  if (stage === 'done' && result) {
    return (
      <div className="space-y-2 rounded-2xl border border-tertiary-container/30 bg-tertiary-container/10 p-3.5">
        <div className="flex items-start gap-2">
          <Icon name="flag" filled size={18} className="mt-0.5 shrink-0 text-tertiary" />
          <div className="min-w-0 flex-1">
            <p className="text-label-md font-semibold text-on-surface">Reported to the registry</p>
            <p className="text-label-sm text-on-surface-variant">
              {result.count !== null
                ? `This address now has ${result.count} report${result.count === 1 ? '' : 's'}.`
                : 'The report is on chain; the new count could not be read back yet.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => window.open(network.explorerTxUrl(result.hash), '_blank')}
          className="flex items-center gap-1 text-label-sm text-primary-container hover:underline"
        >
          View report on stellar.expert <Icon name="open_in_new" size={14} />
        </button>
      </div>
    );
  }

  if (stage === 'entry') {
    return (
      <button
        type="button"
        onClick={() => setStage('sheet')}
        className="flex w-full items-center justify-between rounded-2xl border border-outline-variant/40 bg-surface-container px-3.5 py-2.5 text-left transition-colors hover:border-primary-container"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-label-md text-on-surface">
            {flagged ? 'Report it too' : 'Report this address'}
          </span>
          <span className="block truncate font-mono text-label-sm text-on-surface-variant">
            {hasEntry && entry
              ? `${entry.reports} report${entry.reports === 1 ? '' : 's'} on chain · ${subject.address.slice(0, 6)}…${subject.address.slice(-6)}`
              : `${subject.address.slice(0, 6)}…${subject.address.slice(-6)}`}
          </span>
        </span>
        <Icon name="flag" size={18} className="shrink-0 text-on-surface-variant" />
      </button>
    );
  }

  const busy = stage === 'submitting';
  return (
    <div className="space-y-3 rounded-2xl border border-outline-variant/40 bg-surface-container p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-label-md font-semibold text-on-surface">Report to the registry</p>
        <button
          type="button"
          aria-label="Cancel report"
          disabled={busy}
          onClick={() => {
            setStage('entry');
            setError(null);
            // Reopening starts from no reason again, like the first time.
            setReason(null);
          }}
          className="text-on-surface-variant hover:text-on-surface"
        >
          <Icon name="close" size={18} />
        </button>
      </div>

      {/* The full address, never truncated: a lookalike is the whole point. */}
      <div>
        <p className="text-label-sm uppercase tracking-wide text-on-surface-variant">Address</p>
        <p className="break-all font-mono text-label-sm text-on-surface">{subject.address}</p>
      </div>

      <label className="block">
        <span className="mb-1 block text-label-sm uppercase tracking-wide text-on-surface-variant">
          Reason
        </span>
        <select
          value={reason ?? ''}
          disabled={busy}
          required
          onChange={(e) => setReason(reasonFromSelect(e.target.value))}
          className="w-full rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 text-body-md text-on-surface focus:border-primary-container focus:shadow-focus-amber focus:outline-none"
        >
          <option value="" disabled>
            Choose a reason
          </option>
          {REGISTRY_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <Input
        label="Note (optional, stays on this device)"
        placeholder="What happened?"
        value={note}
        disabled={busy}
        onChange={(e) => setNote(e.target.value)}
      />
      <p className="text-label-sm text-on-surface-variant">
        Only a hash of the note goes on chain, as a commitment you can prove later. The note itself
        is never sent or saved anywhere.
      </p>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-high/60 p-2">
        <span className="text-label-md text-on-surface-variant">Report fee</span>
        <span className="text-right text-label-md text-on-surface">
          {fee.status === 'loading' && 'Reading…'}
          {fee.status === 'ok' && describeFee(fee.fee)}
          {fee.status === 'unknown' && (
            <span className="text-secondary">Unknown — could not read the registry fee</span>
          )}
        </span>
      </div>

      {hasEntry && (
        <p className="text-label-sm text-secondary">
          This address is already on the registry. Reporting again adds to its count and charges the
          fee again; the first reporter and date stay as they are
          {disputed ? ', and the entry stays marked as disputed' : ''}.
        </p>
      )}

      <p className="text-label-sm text-on-surface">
        This is public, permanent, and recorded on-chain against your address.
      </p>

      {error && (
        <p role="alert" className="text-label-md text-error">
          {error}
        </p>
      )}

      <Button
        fullWidth
        onClick={submit}
        loading={busy}
        disabled={!canSubmitReport({ reason, fee: fee.status, busy })}
        trailingIcon="lock"
      >
        {fee.status === 'unknown' ? 'Report anyway' : 'Sign & report'}
      </Button>
    </div>
  );
}
