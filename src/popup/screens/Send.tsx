import { useEffect, useMemo, useState } from 'react';
import { BASE_FEE } from '@stellar/stellar-sdk';
import type { NetworkConfig } from '@shared/constants';
import type { AssetBalance } from '@shared/types';
import { sendMessage } from '@shared/messages';
import { getServer, loadAccountState, destinationFunded } from '@core/stellar/client';
import { buildTransferXdr, computeMaxXlm, memoByteLength, type AssetRef } from '@core/stellar/tx';
import { isValidPublicKey } from '@core/wallet/wallet';
import { MAX_MEMO_BYTES } from '@shared/constants';
import { formatAmount, truncateAddress } from '@shared/format';
import { scan } from '@core/scan/engine';
import type { ScanVerdict } from '@core/scan/types';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { ScanBadge } from '../components/ScanBadge';
import { RiskCallout } from '../components/RiskCallout';

interface Props {
  address: string;
  network: NetworkConfig;
  onDone: () => void;
}

type Step = 'form' | 'review' | 'success';

interface ReviewData {
  xdr: string;
  destination: string;
  amount: string;
  assetCode: string;
  memo: string;
  fee: string; // XLM
}

export function Send({ address, network, onDone }: Props) {
  const [step, setStep] = useState<Step>('form');
  const [balances, setBalances] = useState<AssetBalance[]>([]);
  const [subentryCount, setSubentryCount] = useState(0);

  const [to, setTo] = useState('');
  const [assetKey, setAssetKey] = useState('XLM');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');

  const [building, setBuilding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // ── Lantern pre-sign scan state ──
  const [verdict, setVerdict] = useState<ScanVerdict | null>(null);
  const [scanning, setScanning] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  // Reveal the verdict after a short, latency-shaped delay so the scan reads as
  // "checked just now" (approval UI shown immediately, low risk resolves fast).
  useEffect(() => {
    if (step !== 'review' || !verdict) return;
    setScanning(true);
    const t = setTimeout(() => setScanning(false), Math.min(verdict.latencyMs, 600));
    return () => clearTimeout(t);
  }, [step, verdict]);

  function backToForm() {
    setStep('form');
    setVerdict(null);
    setConfirmText('');
    setError(null);
  }

  useEffect(() => {
    void loadAccountState(network, address).then((s) => {
      setBalances(s.balances);
      setSubentryCount(s.subentryCount);
    });
  }, [network, address]);

  const selected = useMemo(
    () => balances.find((b) => (b.isNative ? 'XLM' : `${b.code}:${b.issuer}`) === assetKey),
    [balances, assetKey],
  );

  const spendable = useMemo(() => {
    if (!selected) return '0';
    return selected.isNative ? computeMaxXlm(selected.balance, subentryCount) : selected.balance;
  }, [selected, subentryCount]);

  function setMax() {
    setAmount(spendable);
  }

  function validateForm(): string | null {
    if (!isValidPublicKey(to)) return 'Enter a valid Stellar address (starts with G).';
    if (to.trim() === address) return 'You cannot send to your own address.';
    const amt = Number(amount);
    if (!amount || !Number.isFinite(amt) || amt <= 0) return 'Enter an amount greater than zero.';
    if (amt > Number(spendable)) return 'Amount exceeds your spendable balance.';
    if (memo && memoByteLength(memo) > MAX_MEMO_BYTES) return `Memo must be ${MAX_MEMO_BYTES} bytes or fewer.`;
    return null;
  }

  async function toReview() {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!selected) return;
    setBuilding(true);
    setError(null);
    try {
      const server = getServer(network);
      const destFunded = await destinationFunded(network, to.trim());
      if (selected.isNative && !destFunded && Number(amount) < 1) {
        setError('Sending to a new account requires at least 1 XLM (base reserve).');
        setBuilding(false);
        return;
      }
      if (!selected.isNative && !destFunded) {
        setError('The destination account does not exist and cannot receive this asset.');
        setBuilding(false);
        return;
      }

      const sourceAccount = await server.loadAccount(address);
      let baseFee = BASE_FEE;
      try {
        const fetched = await server.fetchBaseFee();
        baseFee = String(Math.min(Math.max(fetched, Number(BASE_FEE)), 100_000)); // cap at 0.01 XLM
      } catch {
        /* keep BASE_FEE fallback */
      }

      const asset: AssetRef = selected.isNative
        ? { isNative: true }
        : { isNative: false, code: selected.code, issuer: selected.issuer };

      const xdr = buildTransferXdr({
        sourceAccountId: address,
        sourceSequence: sourceAccount.sequenceNumber(),
        networkPassphrase: network.passphrase,
        baseFee,
        destination: to.trim(),
        destinationFunded: destFunded,
        asset,
        amount,
        memo: memo.trim() || undefined,
      });

      // Lantern pre-sign scan — runs between "initiate" and the Sign affordance.
      // Advisory only; it never signs or sends (spec §2).
      const scanVerdict = scan({
        xdr,
        networkPassphrase: network.passphrase,
        context: {
          network: network.id,
          fromAddress: address,
          destinationFunded: destFunded,
          spendableXlm: selected.isNative ? spendable : undefined,
        },
      });

      setReview({
        xdr,
        destination: to.trim(),
        amount,
        assetCode: selected.code,
        memo: memo.trim(),
        fee: formatAmount(String(Number(baseFee) / 1e7)),
      });
      setVerdict(scanVerdict);
      setConfirmText('');
      setStep('review');
    } catch {
      setError('Could not prepare the transaction. Check your connection and try again.');
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
  if (step === 'success' && txHash) {
    return (
      <div className="flex flex-col items-center pt-10 text-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-primary-container/15">
          <Icon name="check_circle" filled size={48} className="text-primary-container drop-shadow-glow-amber" />
        </div>
        <h2 className="text-title-md text-on-surface">Sent!</h2>
        <p className="mt-1 text-label-md text-on-surface-variant">
          {formatAmount(review!.amount)} {review!.assetCode} on its way.
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
          <Button fullWidth onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  // ── Review (with Lantern scan) ──
  if (step === 'review' && review) {
    const isHigh = verdict?.action === 'block_confirm';
    const acknowledged = !isHigh || confirmText.trim().toUpperCase() === 'CONFIRM';

    return (
      <div className="space-y-4 pt-2">
        <button onClick={backToForm} className="flex items-center gap-1 text-label-md text-on-surface-variant hover:text-on-surface">
          <Icon name="arrow_back" size={18} /> Edit
        </button>
        <h2 className="text-title-md text-on-surface">Review Transaction</h2>

        <div className="rounded-2xl bg-surface-container p-5 text-center shadow-layer-1">
          <p className="text-label-sm uppercase tracking-wide text-on-surface-variant">You're sending</p>
          {/* Mute the amber value glow when high-risk so the warning is the focus. */}
          <p className={`mt-2 text-headline-lg ${isHigh ? 'text-on-surface-variant' : 'text-primary glow-amber-text'}`}>
            {formatAmount(review.amount)} {review.assetCode}
          </p>
        </div>

        {/* Scan result — announced to screen readers when it resolves. */}
        <div aria-live="polite" aria-atomic="true">
        {scanning ? (
          <div className="flex items-center gap-2 rounded-2xl border border-outline-variant/40 bg-surface-container p-3.5">
            <Icon name="security" size={18} className="animate-pulse text-on-surface-variant" />
            <span className="text-label-md text-on-surface-variant">Lantern is checking this transaction…</span>
          </div>
        ) : verdict ? (
          verdict.action === 'allow' ? (
            <div className="flex items-center justify-between rounded-2xl border border-tertiary-container/20 bg-surface-container p-3.5">
              <p className="pr-2 text-label-md text-on-surface">{verdict.explanation}</p>
              <ScanBadge risk="low" latencyMs={verdict.latencyMs} />
            </div>
          ) : (
            <RiskCallout
              risk={verdict.risk}
              reasons={verdict.reasons}
              explanation={verdict.explanation}
              whatToDo={
                isHigh
                  ? 'If you did not expect this, do not continue. Scams cannot be reversed once signed.'
                  : undefined
              }
            />
          )
        ) : null}
        </div>

        <Card className="space-y-3">
          <ReviewRow label="To" value={truncateAddress(review.destination, 6, 6)} mono />
          <ReviewRow label="Asset" value={review.assetCode} />
          {review.memo && <ReviewRow label="Memo" value={review.memo} />}
          <ReviewRow label="Network fee" value={`~${review.fee} XLM`} />
          <ReviewRow label="Network" value={network.label} />
        </Card>

        {/* High-risk friction: type-to-confirm (spec §2, §7 Phase 4) */}
        {isHigh && !scanning && (
          <div className="space-y-2">
            <p className="text-label-sm text-error">
              To proceed anyway, type <span className="font-mono font-semibold">CONFIRM</span> below.
            </p>
            <Input
              mono
              placeholder="CONFIRM"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </div>
        )}

        {error && (
        <p role="alert" className="text-center text-label-md text-error">
          {error}
        </p>
      )}

        <Button
          fullWidth
          onClick={confirm}
          loading={submitting}
          disabled={scanning || !acknowledged}
          variant={isHigh ? 'secondary' : 'primary'}
          trailingIcon="lock"
          className={isHigh ? '!border-error/50 !text-error' : ''}
        >
          {isHigh ? 'Sign Anyway' : 'Confirm & Send'}
        </Button>
      </div>
    );
  }

  // ── Form ──
  return (
    <div className="space-y-4 pt-2">
      <h2 className="text-title-md text-on-surface">Send Assets</h2>

      <div className="space-y-1">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="Send To"
              mono
              placeholder="G…"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <button
            aria-label="Scan QR code (coming soon)"
            title="Scan QR (coming soon)"
            disabled
            className="mb-0.5 flex h-12 w-12 items-center justify-center rounded-lg border border-outline-variant text-outline opacity-50"
          >
            <Icon name="qr_code_scanner" size={22} />
          </button>
        </div>
      </div>

      {/* Asset selector */}
      <div>
        <label htmlFor="send-asset" className="mb-2 block text-label-sm uppercase tracking-wide text-on-surface-variant">
          Asset
        </label>
        <div className="relative">
          <select
            id="send-asset"
            value={assetKey}
            onChange={(e) => setAssetKey(e.target.value)}
            className="w-full appearance-none rounded-full border border-outline-variant bg-surface-variant px-4 py-2.5 font-mono text-label-md text-on-surface focus:border-primary-container focus:outline-none"
          >
            {balances.length === 0 && <option value="XLM">XLM</option>}
            {balances.map((b) => {
              const key = b.isNative ? 'XLM' : `${b.code}:${b.issuer}`;
              return (
                <option key={key} value={key}>
                  {b.code} — {formatAmount(b.balance)}
                </option>
              );
            })}
          </select>
          <Icon name="expand_more" size={20} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
        </div>
      </div>

      {/* Amount */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor="send-amount" className="text-label-sm uppercase tracking-wide text-on-surface-variant">
            Amount
          </label>
          <span className="text-label-sm text-on-surface-variant">
            Spendable: {formatAmount(spendable)} {selected?.code ?? 'XLM'}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 focus-within:border-primary-container focus-within:shadow-focus-amber">
          <input
            id="send-amount"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            className="w-full bg-transparent text-right font-mono text-headline-lg text-on-surface placeholder:text-outline focus:outline-none"
          />
          <button
            onClick={setMax}
            className="shrink-0 rounded-full px-2 py-1 text-label-md font-semibold text-primary-container hover:bg-surface-variant"
          >
            MAX
          </button>
        </div>
      </div>

      {/* Memo */}
      <Input
        label={`Memo (optional · ${MAX_MEMO_BYTES} bytes)`}
        placeholder="What's this for?"
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        error={memo && memoByteLength(memo) > MAX_MEMO_BYTES ? 'Memo too long.' : undefined}
      />

      {error && (
        <p role="alert" className="text-center text-label-md text-error">
          {error}
        </p>
      )}

      <Button fullWidth onClick={toReview} loading={building} trailingIcon="arrow_forward">
        Review
      </Button>
    </div>
  );
}

function ReviewRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-label-md text-on-surface-variant">{label}</span>
      <span className={`text-right text-label-md text-on-surface ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
