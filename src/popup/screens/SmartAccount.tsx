// The passkey smart-account home (#53): balance + send XLM, where every send
// runs the SAME scan → approve gate as the classic Send screen (no bypass
// lane) and is then authorized by a passkey assertion instead of an Ed25519
// signature. Fees are paid by an ephemeral friendbot-funded keypair that lives
// only in this popup session's memory (testnet-only; it controls nothing —
// the smart account answers only to the passkey).
import { useCallback, useEffect, useState } from 'react';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { NETWORKS } from '@shared/constants';
import type { PasskeyAccountRecord } from '@shared/types';
import { sendMessage } from '@shared/messages';
import { clearPasskeyAccount } from '@shared/storage';
import { formatAmount, truncateAddress } from '@shared/format';
import { finalizePasskeyTransfer, preparePasskeyTransfer } from '@core/passkey/transfer';
import { sacContractBalance } from '@core/stellar/sac';
import { getServer, fundWithFriendbot } from '@core/stellar/client';
import { isValidPublicKey, isValidContractId } from '@core/wallet/wallet';
import { scan } from '@core/scan/engine';
import type { ScanVerdict } from '@core/scan/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { Input } from '../components/Input';
import { NetworkBadge } from '../components/NetworkBadge';
import { RiskCallout } from '../components/RiskCallout';
import { ScanBadge } from '../components/ScanBadge';
import { useToast } from '../components/Toast';

interface Props {
  account: PasskeyAccountRecord;
  /** Re-check storage after the account is forgotten. */
  onForget: () => void;
}

type Step = 'home' | 'review' | 'success';

const NETWORK = NETWORKS.TESTNET;

// The session fee payer: ephemeral, friendbot-funded, popup-memory only. It
// pays Soroban fees for the smart account (which cannot be a tx source
// itself); it holds nothing else and is discarded when the popup closes.
let sessionFeeSource: Keypair | null = null;

async function getFeeSource(): Promise<Keypair> {
  if (sessionFeeSource) return sessionFeeSource;
  const kp = Keypair.random();
  await fundWithFriendbot(NETWORK, kp.publicKey());
  sessionFeeSource = kp;
  return kp;
}

function xlmToStroops(amount: string): string | null {
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(amount.trim());
  if (!m) return null;
  const stroops = BigInt(m[1]!) * 10_000_000n + BigInt((m[2] ?? '').padEnd(7, '0') || '0');
  return stroops > 0n ? stroops.toString() : null;
}

function stroopsToXlm(stroops: bigint): string {
  const whole = stroops / 10_000_000n;
  const frac = (stroops % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

function credentialIdBytes(record: PasskeyAccountRecord): Uint8Array {
  const b64 = record.credentialId.replace(/-/g, '+').replace(/_/g, '/');
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function SmartAccount({ account, onForget }: Props) {
  const [step, setStep] = useState<Step>('home');
  const [balance, setBalance] = useState<bigint | null>(null);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ xdr: string; latestLedger: number; amount: string; to: string } | null>(null);
  const [verdict, setVerdict] = useState<ScanVerdict | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);
  const showToast = useToast();

  const loadBalance = useCallback(() => {
    void sacContractBalance({
      holderContractId: account.contractId,
      networkPassphrase: NETWORK.passphrase,
      rpcUrl: NETWORK.sorobanRpcUrl!,
    }).then((res) => {
      if (res.ok) setBalance(res.stroops);
    });
  }, [account.contractId]);

  useEffect(loadBalance, [loadBalance]);

  function copyAddress() {
    navigator.clipboard.writeText(account.contractId).then(
      () => showToast('Address copied'),
      () => showToast('Couldn’t copy address', 'error'),
    );
  }

  async function forget() {
    if (!window.confirm('Forget this smart account on this device? The on-chain account (and its passkey) keep existing.')) return;
    await clearPasskeyAccount();
    onForget();
  }

  async function toReview() {
    const dest = to.trim();
    if (!isValidPublicKey(dest) && !isValidContractId(dest)) {
      setError('Enter a valid Stellar address (G…) or contract (C…).');
      return;
    }
    const stroops = xlmToStroops(amount);
    if (!stroops) {
      setError('Enter an amount greater than zero (up to 7 decimals).');
      return;
    }
    if (balance !== null && BigInt(stroops) > balance) {
      setError('Amount exceeds your balance.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const feeSource = await getFeeSource();
      const feeAccount = await getServer(NETWORK).loadAccount(feeSource.publicKey());
      const prepared = await preparePasskeyTransfer({
        contractId: account.contractId,
        destination: dest,
        amountStroops: stroops,
        feeSourceAccount: feeSource.publicKey(),
        feeSourceSequence: feeAccount.sequenceNumber(),
        networkPassphrase: NETWORK.passphrase,
        rpcUrl: NETWORK.sorobanRpcUrl!,
      });
      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }
      // The same pre-sign scan gate as the classic Send screen (no bypass lane).
      setVerdict(
        scan({
          xdr: prepared.xdr,
          networkPassphrase: NETWORK.passphrase,
          context: { network: NETWORK.id, fromAddress: account.contractId },
        }),
      );
      setReview({ xdr: prepared.xdr, latestLedger: prepared.latestLedger, amount, to: dest });
      setConfirmText('');
      setStep('review');
    } catch {
      setError('Could not prepare the transaction. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      // The passkey prompt IS the signature: it signs the auth-entry payload.
      const finalized = await finalizePasskeyTransfer({
        preparedXdr: review.xdr,
        smartAccountId: account.contractId,
        rpId: account.rpId,
        credentialId: credentialIdBytes(account),
        signatureExpirationLedger: review.latestLedger + 120,
        networkPassphrase: NETWORK.passphrase,
        rpcUrl: NETWORK.sorobanRpcUrl!,
      });
      if (!finalized.ok) {
        setError(finalized.error);
        return;
      }
      const feeSource = await getFeeSource();
      const tx = TransactionBuilder.fromXDR(finalized.xdr, NETWORK.passphrase);
      tx.sign(feeSource);
      const res = await sendMessage({
        type: 'SUBMIT_ONLY',
        xdr: tx.toXDR(),
        networkPassphrase: NETWORK.passphrase,
        horizonUrl: NETWORK.horizonUrl,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setTxHash(res.data.hash);
      setStep('success');
      setTo('');
      setAmount('');
      loadBalance();
    } finally {
      setBusy(false);
    }
  }

  // ── Success ──
  if (step === 'success' && txHash) {
    return (
      <Shell>
        <div className="flex flex-col items-center pt-10 text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-primary-container/15">
            <Icon name="check_circle" filled size={48} className="text-primary-container drop-shadow-glow-amber" />
          </div>
          <h2 className="text-title-md text-on-surface">Sent!</h2>
          <p className="mt-1 text-label-md text-on-surface-variant">Authorized by your passkey.</p>
          <p className="mt-4 break-all px-2 font-mono text-label-sm text-on-surface-variant">{txHash}</p>
          <div className="mt-6 w-full space-y-3">
            <Button
              fullWidth
              variant="secondary"
              trailingIcon="open_in_new"
              onClick={() => window.open(NETWORK.explorerTxUrl(txHash), '_blank')}
            >
              View on Explorer
            </Button>
            <Button fullWidth onClick={() => setStep('home')}>
              Done
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  // ── Review (scan gate + passkey confirm) ──
  if (step === 'review' && review) {
    const isHigh = verdict?.action === 'block_confirm';
    const acknowledged = !isHigh || confirmText.trim().toUpperCase() === 'CONFIRM';
    return (
      <Shell>
        <div className="space-y-4 pt-2">
          <button
            onClick={() => setStep('home')}
            className="flex items-center gap-1 text-label-md text-on-surface-variant hover:text-on-surface"
          >
            <Icon name="arrow_back" size={18} /> Edit
          </button>
          <h2 className="text-title-md text-on-surface">Review Transaction</h2>

          <div className="rounded-2xl bg-surface-container p-5 text-center shadow-layer-1">
            <p className="text-label-sm uppercase tracking-wide text-on-surface-variant">You're sending</p>
            <p className={`mt-2 text-headline-lg ${isHigh ? 'text-on-surface-variant' : 'text-primary glow-amber-text'}`}>
              {formatAmount(review.amount)} XLM
            </p>
          </div>

          <div aria-live="polite" aria-atomic="true">
            {verdict ? (
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
                  whatToDo={isHigh ? 'If you did not expect this, do not continue.' : undefined}
                />
              )
            ) : null}
          </div>

          <Card className="space-y-3">
            <ReviewRow label="From" value={truncateAddress(account.contractId, 6, 6)} mono />
            <ReviewRow label="To" value={truncateAddress(review.to, 6, 6)} mono />
            <ReviewRow label="Signer" value="Device passkey" />
            <ReviewRow label="Network" value={NETWORK.label} />
          </Card>

          {isHigh && (
            <div className="space-y-2">
              <p className="text-label-sm text-error">
                To proceed anyway, type <span className="font-mono font-semibold">CONFIRM</span> below.
              </p>
              <Input mono placeholder="CONFIRM" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
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
            loading={busy}
            disabled={!acknowledged}
            variant={isHigh ? 'secondary' : 'primary'}
            trailingIcon="fingerprint"
            className={isHigh ? '!border-error/50 !text-error' : ''}
          >
            {isHigh ? 'Sign Anyway with Passkey' : 'Confirm with Passkey'}
          </Button>
        </div>
      </Shell>
    );
  }

  // ── Home ──
  return (
    <Shell>
      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="fingerprint" filled size={22} className="text-primary-container" />
            <h2 className="text-title-md text-on-surface">Smart Account</h2>
          </div>
          <NetworkBadge network="TESTNET" />
        </div>

        <div className="rounded-2xl bg-surface-container p-5 text-center shadow-layer-1">
          <p className="text-label-sm uppercase tracking-wide text-on-surface-variant">Balance</p>
          <p className="mt-2 text-headline-lg text-primary glow-amber-text">
            {balance === null ? '…' : `${formatAmount(stroopsToXlm(balance))} XLM`}
          </p>
          <button
            onClick={copyAddress}
            className="mx-auto mt-3 flex items-center gap-1.5 rounded-full border border-outline-variant px-3 py-1 font-mono text-label-sm text-on-surface-variant hover:border-primary-container hover:text-on-surface"
          >
            {truncateAddress(account.contractId, 6, 6)}
            <Icon name="content_copy" size={14} />
          </button>
          <p className="mt-2 text-label-sm text-on-surface-variant">
            Signed by your device passkey — no seed phrase exists.
          </p>
        </div>

        <Input
          label="Send To"
          mono
          placeholder="G… or C…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />

        <Input
          label="Amount (XLM)"
          mono
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        />

        {error && (
          <p role="alert" className="text-center text-label-md text-error">
            {error}
          </p>
        )}

        <Button fullWidth onClick={toReview} loading={busy} trailingIcon="arrow_forward">
          Review
        </Button>

        <button
          onClick={forget}
          className="mx-auto flex items-center gap-1 text-label-sm text-on-surface-variant hover:text-error"
        >
          <Icon name="delete" size={14} /> Forget this account on this device
        </button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid-bg flex h-full flex-col overflow-y-auto no-scrollbar bg-background px-5 py-6">
      {children}
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
