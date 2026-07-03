import { useEffect, useState } from 'react';
import { BASE_FEE } from '@stellar/stellar-sdk';
import type { NetworkConfig } from '@shared/constants';
import { sendMessage } from '@shared/messages';
import { getServer } from '@core/stellar/client';
import { totalFeeXlm } from '@core/stellar/tx';
import { buildGuardianSetupXdr, describeGuardianSetup } from '@core/recovery/guardians';
import { scan } from '@core/scan/engine';
import type { ScanVerdict } from '@core/scan/types';
import { isNativePlatform } from '@shared/kv';
import { formatAmount } from '@shared/format';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { RiskCallout } from '../components/RiskCallout';
import { HoldToConfirm } from '../components/HoldToConfirm';

interface Props {
  address: string;
  network: NetworkConfig;
  onBack: () => void;
}

type Step = 'form' | 'review' | 'success';

interface ReviewData {
  xdr: string;
  guardianCount: number;
  threshold: number;
  fee: string; // XLM
}

export function Guardians({ address, network, onBack }: Props) {
  const [step, setStep] = useState<Step>('form');
  const [guardians, setGuardians] = useState<string[]>(['']);
  const [threshold, setThreshold] = useState(2);

  const [building, setBuilding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const [verdict, setVerdict] = useState<ScanVerdict | null>(null);
  const [scanning, setScanning] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  // Reveal the scan verdict after a short latency-shaped delay (mirrors Send).
  useEffect(() => {
    if (step !== 'review' || !verdict) return;
    setScanning(true);
    const t = setTimeout(() => setScanning(false), Math.min(verdict.latencyMs, 600));
    return () => clearTimeout(t);
  }, [step, verdict]);

  const filled = guardians.map((g) => g.trim()).filter(Boolean);
  // Threshold can never require more guardians than have been entered.
  const maxThreshold = Math.max(1, filled.length);
  const effectiveThreshold = Math.min(threshold, maxThreshold);

  function setGuardian(i: number, value: string) {
    setGuardians((gs) => gs.map((g, idx) => (idx === i ? value : g)));
    setError(null);
  }
  function addGuardian() {
    setGuardians((gs) => [...gs, '']);
  }
  function removeGuardian(i: number) {
    setGuardians((gs) => (gs.length > 1 ? gs.filter((_, idx) => idx !== i) : gs));
  }

  function backToForm() {
    setStep('form');
    setVerdict(null);
    setConfirmText('');
    setError(null);
  }

  async function toReview() {
    if (filled.length === 0) {
      setError('Add at least one guardian address.');
      return;
    }
    setBuilding(true);
    setError(null);
    try {
      const server = getServer(network);
      const sourceAccount = await server.loadAccount(address);
      let baseFee = BASE_FEE;
      try {
        const fetched = await server.fetchBaseFee();
        baseFee = String(Math.min(Math.max(fetched, Number(BASE_FEE)), 100_000));
      } catch {
        /* keep BASE_FEE fallback */
      }

      let xdr: string;
      try {
        xdr = buildGuardianSetupXdr({
          sourceAccountId: address,
          sourceSequence: sourceAccount.sequenceNumber(),
          networkPassphrase: network.passphrase,
          baseFee,
          guardians: filled,
          threshold: effectiveThreshold,
        });
      } catch (e) {
        // buildGuardianSetupXdr rejects invalid/duplicate/self keys and bad K.
        setError(e instanceof Error ? e.message : 'Invalid guardian setup.');
        setBuilding(false);
        return;
      }

      // Lantern pre-sign scan — this is a high-impact account-control change and
      // will surface as high risk with a confirm gate (same as Send).
      const scanVerdict = scan({
        xdr,
        networkPassphrase: network.passphrase,
        context: { network: network.id, fromAddress: address },
      });

      setReview({
        xdr,
        guardianCount: filled.length,
        threshold: effectiveThreshold,
        // TOTAL fee off the built tx, not baseFee: this is a multi-op
        // transaction (one setOptions per guardian + one threshold op) and the
        // network fee is baseFee × opCount, so baseFee alone understates it.
        fee: formatAmount(totalFeeXlm(xdr, network.passphrase)),
      });
      setVerdict(scanVerdict);
      setConfirmText('');
      setStep('review');
    } catch {
      setError('Could not prepare the setup. Your account must be funded — check your connection and try again.');
    } finally {
      setBuilding(false);
    }
  }

  async function confirm() {
    if (!review) return;
    setSubmitting(true);
    setError(null);
    const res = await sendMessage({
      type: 'SIGN_AND_SUBMIT',
      xdr: review.xdr,
      networkPassphrase: network.passphrase,
      horizonUrl: network.horizonUrl,
    });
    setSubmitting(false);
    if (res.ok) {
      setTxHash(res.data.hash);
      setStep('success');
    } else if (res.code === 'LOCKED') {
      setError('Wallet locked. Close and reopen to unlock, then try again.');
    } else {
      setError(res.error);
    }
  }

  // ── Success ──
  if (step === 'success' && txHash && review) {
    return (
      <div className="flex h-full flex-col bg-background px-4">
        <div className="flex flex-1 flex-col items-center pt-10 text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-primary-container/15">
            <Icon name="verified_user" filled size={48} className="text-primary-container drop-shadow-glow-amber" />
          </div>
          <h2 className="text-title-md text-on-surface">Recovery set up</h2>
          <p className="mt-1 px-2 text-label-md text-on-surface-variant">
            {describeGuardianSetup(review.guardianCount, review.threshold)}
          </p>
          <p className="mt-4 break-all px-2 font-mono text-label-sm text-on-surface-variant">{txHash}</p>
          <div className="mt-6 w-full space-y-3">
            <Button
              fullWidth
              variant="secondary"
              trailingIcon="open_in_new"
              onClick={() => window.open(network.explorerTxUrl(txHash), '_blank')}
            >
              View on Explorer
            </Button>
            <Button fullWidth onClick={onBack}>
              Done
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Review (with Lantern scan) ──
  if (step === 'review' && review) {
    const isHigh = verdict?.action === 'block_confirm';
    const native = isNativePlatform();
    const acknowledged = !isHigh || native || confirmText.trim().toUpperCase() === 'CONFIRM';

    return (
      <div className="flex h-full flex-col bg-background">
        <ScreenHeader title="Review Setup" onBack={backToForm} />
        <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          <div className="rounded-2xl bg-surface-container p-5 text-center shadow-layer-1">
            <p className="text-label-sm uppercase tracking-wide text-on-surface-variant">Guardian recovery</p>
            <p className="mt-2 text-title-md text-on-surface">
              {review.threshold} of {review.guardianCount} to recover
            </p>
          </div>

          <div aria-live="polite" aria-atomic="true">
            {scanning ? (
              <div className="flex items-center gap-2 rounded-2xl border border-outline-variant/40 bg-surface-container p-3.5">
                <Icon name="security" size={18} className="animate-pulse text-on-surface-variant" />
                <span className="text-label-md text-on-surface-variant">Lantern is checking this change…</span>
              </div>
            ) : verdict ? (
              <RiskCallout
                risk={verdict.risk}
                reasons={verdict.reasons}
                explanation={verdict.explanation}
                whatToDo={
                  isHigh
                    ? 'Only continue if you set this up yourself. Changing who can sign for your account is irreversible.'
                    : undefined
                }
              />
            ) : null}
          </div>

          <Card className="space-y-3">
            <ReviewRow label="Guardians" value={String(review.guardianCount)} />
            <ReviewRow label="Required to recover" value={`${review.threshold} of ${review.guardianCount}`} />
            <ReviewRow label="Network fee" value={`~${review.fee} XLM`} />
            <ReviewRow label="Network" value={network.label} />
          </Card>

          {isHigh && !scanning && !native && (
            <div className="space-y-2">
              <p className="text-label-sm text-error">
                To proceed, type <span className="font-mono font-semibold">CONFIRM</span> below.
              </p>
              <Input mono placeholder="CONFIRM" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            </div>
          )}

          {error && (
            <p role="alert" className="text-center text-label-md text-error">
              {error}
            </p>
          )}

          {isHigh && native && !scanning ? (
            <HoldToConfirm
              label={submitting ? 'Setting up…' : 'Hold to Set Up Recovery'}
              danger
              onConfirm={confirm}
              disabled={submitting}
            />
          ) : (
            <Button
              fullWidth
              onClick={confirm}
              loading={submitting}
              disabled={scanning || !acknowledged}
              variant={isHigh ? 'secondary' : 'primary'}
              trailingIcon="lock"
              className={isHigh ? '!border-error/50 !text-error' : ''}
            >
              Set Up Recovery
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Form ──
  return (
    <div className="flex h-full flex-col bg-background">
      <ScreenHeader title="Set Up Recovery" onBack={onBack} />
      <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <p className="text-label-md leading-relaxed text-on-surface-variant">
          Add trusted people as <span className="text-on-surface">guardians</span>. If you ever lose your key, a
          quorum of them can help you recover this account — without any of them being able to spend your funds.
        </p>

        <div className="space-y-2">
          <label className="block text-label-sm uppercase tracking-wide text-on-surface-variant">Guardians</label>
          {guardians.map((g, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1">
                <Input
                  mono
                  placeholder="Guardian address (G…)"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={g}
                  onChange={(e) => setGuardian(i, e.target.value)}
                />
              </div>
              {guardians.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove guardian ${i + 1}`}
                  onClick={() => removeGuardian(i)}
                  className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-variant active:scale-95"
                >
                  <Icon name="close" size={20} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addGuardian}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-label-md text-primary-container transition-colors hover:bg-surface-variant active:scale-95"
          >
            <Icon name="add" size={18} /> Add another guardian
          </button>
        </div>

        <div>
          <label htmlFor="guardian-threshold" className="mb-2 block text-label-sm uppercase tracking-wide text-on-surface-variant">
            Required to recover
          </label>
          <div className="relative">
            <select
              id="guardian-threshold"
              value={effectiveThreshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full appearance-none rounded-full border border-outline-variant bg-surface-variant px-4 py-2.5 text-label-md text-on-surface focus:border-primary-container focus:outline-none"
            >
              {Array.from({ length: maxThreshold }, (_, i) => i + 1).map((k) => (
                <option key={k} value={k}>
                  {k} of {maxThreshold} guardian{maxThreshold > 1 ? 's' : ''}
                </option>
              ))}
            </select>
            <Icon name="expand_more" size={20} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          </div>
        </div>

        {describeGuardianSetup(filled.length, effectiveThreshold) && (
          <p className="rounded-lg bg-surface-container-high/60 p-3 text-label-sm text-on-surface-variant">
            {describeGuardianSetup(filled.length, effectiveThreshold)}
          </p>
        )}

        {error && (
          <p role="alert" className="text-center text-label-md text-error">
            {error}
          </p>
        )}

        <Button fullWidth onClick={toReview} loading={building} trailingIcon="arrow_forward">
          Review
        </Button>
      </div>
    </div>
  );
}

function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 bg-surface-container-low px-2">
      <button
        onClick={onBack}
        aria-label="Back"
        className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-variant active:scale-95"
      >
        <Icon name="arrow_back" size={22} />
      </button>
      <h1 className="text-title-md text-on-surface">{title}</h1>
    </header>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-label-md text-on-surface-variant">{label}</span>
      <span className="text-right text-label-md text-on-surface">{value}</span>
    </div>
  );
}
