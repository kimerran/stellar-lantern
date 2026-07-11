import { useEffect, useMemo, useState } from 'react';
import { BASE_FEE } from '@stellar/stellar-sdk';
import type { NetworkConfig } from '@shared/constants';
import type { AssetBalance } from '@shared/types';
import { sendMessage } from '@shared/messages';
import { getServer, loadAccountState } from '@core/stellar/client';
import { buildPathPaymentStrictSendXdr, destMinFromQuote } from '@core/stellar/swap';
import { fetchStrictSendPaths } from '@core/stellar/paths';
import { fetchSoroswapQuote, buildSoroswapSwapXdr, pickBestEngine, type SoroswapConfig } from '@core/stellar/soroswap';
import { computeMaxXlm, type AssetRef } from '@core/stellar/tx';
import { scan } from '@core/scan/engine';
import type { ScanVerdict } from '@core/scan/types';
import { FLAGS } from '@shared/flags';
import { isNativePlatform } from '@shared/kv';
import { formatAmount } from '@shared/format';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { ScanBadge } from '../components/ScanBadge';
import { RiskCallout } from '../components/RiskCallout';
import { HoldToConfirm } from '../components/HoldToConfirm';

interface Props {
  address: string;
  network: NetworkConfig;
  onBack: () => void;
}

type Step = 'form' | 'review' | 'success';

// Default slippage tolerance — the received floor is quote × (1 − this).
const SLIPPAGE = 0.005; // 0.5%

// The optional Soroswap aggregator (best-price routing across Soroswap/Aqua/
// Phoenix/SDEX) — gated behind the `swapAggregator` feature flag AND a build-time
// API key. Absent → the wallet uses only the native SDEX path-payment engine, so
// nothing here can block a swap; the aggregator only takes over when configured
// and quoting a strictly better rate. Revenue share (feeBps) is sent only when a
// referral wallet is also configured, as the API requires.
function soroswapConfig(network: NetworkConfig): SoroswapConfig | null {
  if (!FLAGS.swapAggregator) return null;
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  const apiKey = env.VITE_SOROSWAP_API_KEY;
  if (!apiKey) return null;
  const referralId = env.VITE_SOROSWAP_REFERRAL_ID;
  const feeBps = referralId && env.VITE_SOROSWAP_FEE_BPS ? Number(env.VITE_SOROSWAP_FEE_BPS) : undefined;
  return {
    apiKey,
    network: network.id === 'PUBLIC' ? 'mainnet' : 'testnet',
    networkPassphrase: network.passphrase,
    slippageBps: Math.round(SLIPPAGE * 10_000),
    referralId,
    feeBps,
  };
}

const keyOf = (b: AssetBalance) => (b.isNative ? 'XLM' : `${b.code}:${b.issuer}`);
const refOf = (b: AssetBalance): AssetRef =>
  b.isNative ? { isNative: true } : { isNative: false, code: b.code, issuer: b.issuer };

interface ReviewData {
  xdr: string;
  sendCode: string;
  sendAmount: string;
  destCode: string;
  quoted: string; // expected received
  destMin: string; // slippage floor
  engine: 'sdex' | 'soroswap'; // which route won the best-price comparison
  platform: string | null; // aggregator sub-route (e.g. 'aggregator'), if any
  verdict: ScanVerdict;
}

export function Swap({ address, network, onBack }: Props) {
  const [step, setStep] = useState<Step>('form');
  const [balances, setBalances] = useState<AssetBalance[]>([]);
  const [subentryCount, setSubentryCount] = useState(0);

  const [sendKey, setSendKey] = useState('XLM');
  const [destKey, setDestKey] = useState('');
  const [amount, setAmount] = useState('');

  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    void loadAccountState(network, address).then((s) => {
      setBalances(s.balances);
      setSubentryCount(s.subentryCount);
    });
  }, [network, address]);

  const sendBal = useMemo(() => balances.find((b) => keyOf(b) === sendKey), [balances, sendKey]);
  // You can only receive an asset you hold a trustline for — so the dest options
  // are your other balances (excluding whatever you're sending).
  const destOptions = useMemo(() => balances.filter((b) => keyOf(b) !== sendKey), [balances, sendKey]);

  // Keep a valid dest selected as balances / send asset change.
  useEffect(() => {
    if (destOptions.length === 0) {
      setDestKey('');
    } else if (!destOptions.some((b) => keyOf(b) === destKey)) {
      setDestKey(keyOf(destOptions[0]!));
    }
  }, [destOptions, destKey]);

  const spendable = useMemo(() => {
    if (!sendBal) return '0';
    return sendBal.isNative ? computeMaxXlm(sendBal.balance, subentryCount) : sendBal.balance;
  }, [sendBal, subentryCount]);

  function backToForm() {
    setStep('form');
    setReview(null);
    setConfirmText('');
    setError(null);
  }

  // Quote the swap on Horizon, apply the slippage floor, build + scan the tx.
  async function toReview() {
    const destBal = destOptions.find((b) => keyOf(b) === destKey);
    const amt = Number(amount);
    if (!sendBal || !destBal) {
      setError('Pick two different assets to swap between.');
      return;
    }
    if (!amount || !Number.isFinite(amt) || amt <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (amt > Number(spendable)) {
      setError('Amount exceeds your spendable balance.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sendAsset = refOf(sendBal);
      const destAsset = refOf(destBal);

      // Quote the native SDEX path and the Soroswap aggregator (if configured) in
      // parallel. The aggregator only wins when it quotes a strictly better rate;
      // any aggregator failure (or no key) silently leaves the native engine.
      const soroCfg = soroswapConfig(network);
      const [nativeQuote, soroQuote] = await Promise.all([
        fetchStrictSendPaths({ horizonUrl: network.horizonUrl, sendAsset, sendAmount: amount, destAsset }).catch(() => null),
        soroCfg ? fetchSoroswapQuote({ config: soroCfg, sendAsset, sendAmount: amount, destAsset }) : Promise.resolve(null),
      ]);

      const nativeReceive = nativeQuote?.destAmount ?? null;
      const soroReceive = soroQuote?.amountOut ?? null;
      if (!nativeReceive && !soroReceive) {
        setError('No swap route available for this pair right now (not enough liquidity).');
        return;
      }

      let engine: 'sdex' | 'soroswap' = !nativeReceive ? 'soroswap' : pickBestEngine(nativeReceive, soroReceive);
      let xdr: string | null = null;
      let quoted = '';
      let destMin = '';
      let platform: string | null = null;

      // Aggregator route: the API returns a ready-to-sign XDR (its own slippage
      // floor enforced on-chain via slippageBps). If the build fails, drop to SDEX.
      if (engine === 'soroswap' && soroQuote && soroCfg) {
        xdr = await buildSoroswapSwapXdr({ config: soroCfg, quote: soroQuote, from: address });
        if (xdr) {
          quoted = soroQuote.amountOut;
          destMin = destMinFromQuote(soroQuote.amountOut, SLIPPAGE); // shown for parity; enforced on-chain
          platform = soroQuote.platform;
        } else {
          engine = 'sdex';
        }
      }

      // Native SDEX path payment (also the fallback when the aggregator can't build).
      if (!xdr) {
        if (!nativeReceive || !nativeQuote) {
          setError('Couldn’t build the swap. Try again in a moment.');
          return;
        }
        engine = 'sdex';
        quoted = nativeQuote.destAmount;
        destMin = destMinFromQuote(nativeQuote.destAmount, SLIPPAGE);

        const server = getServer(network);
        const sourceAccount = await server.loadAccount(address);
        let baseFee = BASE_FEE;
        try {
          const fetched = await server.fetchBaseFee();
          baseFee = String(Math.min(Math.max(fetched, Number(BASE_FEE)), 100_000));
        } catch {
          /* keep BASE_FEE */
        }

        xdr = buildPathPaymentStrictSendXdr({
          sourceAccountId: address,
          sourceSequence: sourceAccount.sequenceNumber(),
          networkPassphrase: network.passphrase,
          baseFee,
          sendAsset,
          sendAmount: amount,
          destAsset,
          destMin,
          path: nativeQuote.path,
        });
      }

      const verdict = scan({
        xdr,
        networkPassphrase: network.passphrase,
        context: {
          network: network.id,
          fromAddress: address,
          spendableXlm: sendBal.isNative ? spendable : undefined,
        },
      });

      setReview({
        xdr,
        sendCode: sendBal.code,
        sendAmount: amount,
        destCode: destBal.code,
        quoted,
        destMin,
        engine,
        platform,
        verdict,
      });
      setConfirmText('');
      setStep('review');
    } catch {
      setError('Couldn’t get a quote. Check your connection and try again.');
    } finally {
      setBusy(false);
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
      <div className="flex h-full flex-col bg-background">
        <Header title="Swap" onBack={onBack} />
        <main className="no-scrollbar flex-1 overflow-y-auto px-4 pb-6">
          <div className="flex flex-col items-center pt-8 text-center">
            <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-primary-container/15">
              <Icon name="check_circle" filled size={48} className="text-primary-container drop-shadow-glow-amber" />
            </div>
            <h2 className="text-title-md text-on-surface">Swapped!</h2>
            <p className="mt-1 text-label-md text-on-surface-variant">
              {formatAmount(review.sendAmount)} {review.sendCode} → {review.destCode}. Your balances will update shortly.
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
        </main>
      </div>
    );
  }

  // ── Review (with Lantern scan) ──
  if (step === 'review' && review) {
    const verdict = review.verdict;
    const isHigh = verdict.action === 'block_confirm';
    const native = isNativePlatform();
    const acknowledged = !isHigh || native || confirmText.trim().toUpperCase() === 'CONFIRM';

    return (
      <div className="flex h-full flex-col bg-background">
        <Header title="Review swap" onBack={backToForm} />
        <main className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-4 pb-6 pt-3">
          <div className="rounded-2xl bg-surface-container p-5 text-center shadow-layer-1">
            <p className="text-label-sm uppercase tracking-wide text-on-surface-variant">You’re swapping</p>
            <p className={`mt-2 text-headline-lg ${isHigh ? 'text-on-surface-variant' : 'text-primary glow-amber-text'}`}>
              {formatAmount(review.sendAmount)} {review.sendCode}
            </p>
            <p className="mt-1 flex items-center justify-center gap-1 text-title-sm text-on-surface-variant">
              <Icon name="arrow_downward" size={16} />
              ~{formatAmount(review.quoted)} {review.destCode}
            </p>
          </div>

          <div aria-live="polite" aria-atomic="true">
            {verdict.action === 'allow' ? (
              <div className="flex items-center justify-between rounded-2xl border border-tertiary-container/20 bg-surface-container p-3.5">
                <p className="pr-2 text-label-md text-on-surface">{verdict.explanation}</p>
                <ScanBadge risk="low" latencyMs={verdict.latencyMs} />
              </div>
            ) : (
              <RiskCallout
                risk={verdict.risk}
                reasons={verdict.reasons}
                explanation={verdict.explanation}
                whatToDo={isHigh ? 'Only continue if you set up this swap yourself. Signing cannot be reversed.' : undefined}
              />
            )}
          </div>

          <Card className="space-y-3">
            <Row label="You send" value={`${formatAmount(review.sendAmount)} ${review.sendCode}`} />
            <Row label="Expected" value={`~${formatAmount(review.quoted)} ${review.destCode}`} />
            <Row label={`Minimum received (${(SLIPPAGE * 100).toFixed(1)}% slippage)`} value={`${formatAmount(review.destMin)} ${review.destCode}`} />
            <Row label="Route" value={review.engine === 'soroswap' ? 'Soroswap — best price' : 'Stellar DEX'} />
            <Row label="Network" value={network.label} />
          </Card>

          {isHigh && !native && (
            <div className="space-y-2">
              <p className="text-label-sm text-error">
                To proceed anyway, type <span className="font-mono font-semibold">CONFIRM</span> below.
              </p>
              <input
                className="w-full rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 font-mono text-on-surface focus:border-primary-container focus:outline-none"
                placeholder="CONFIRM"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
              />
            </div>
          )}

          {error && <p role="alert" className="text-center text-label-md text-error">{error}</p>}

          {isHigh && native ? (
            <HoldToConfirm label={submitting ? 'Swapping…' : 'Hold to Swap Anyway'} danger onConfirm={confirm} disabled={submitting} />
          ) : (
            <Button
              fullWidth
              onClick={confirm}
              loading={submitting}
              disabled={!acknowledged}
              variant={isHigh ? 'secondary' : 'primary'}
              trailingIcon="swap_horiz"
              className={isHigh ? '!border-error/50 !text-error' : ''}
            >
              {isHigh ? 'Swap Anyway' : 'Confirm & Swap'}
            </Button>
          )}
        </main>
      </div>
    );
  }

  // ── Form ──
  const canSwap = balances.length >= 2 && destOptions.length > 0;
  return (
    <div className="flex h-full flex-col bg-background">
      <Header title="Swap" onBack={onBack} />
      <main className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-4 pb-6 pt-3">
        <p className="text-body-md text-on-surface-variant">
          Convert between assets you hold at the best available rate on the Stellar DEX.
        </p>

        {!canSwap ? (
          <Card className="p-4 text-center text-body-md text-on-surface-variant">
            You need a trustline to at least one other asset to swap. Add one, then come back.
          </Card>
        ) : (
          <>
            <AssetSelect
              label="From"
              value={sendKey}
              options={balances}
              onChange={setSendKey}
              hint={`Spendable: ${formatAmount(spendable)} ${sendBal?.code ?? 'XLM'}`}
            />

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="swap-amount" className="text-label-sm uppercase tracking-wide text-on-surface-variant">
                  Amount
                </label>
                <button onClick={() => setAmount(spendable)} className="text-label-md font-semibold text-primary-container">
                  MAX
                </button>
              </div>
              <input
                id="swap-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                className="w-full rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 text-right font-mono text-headline-lg text-on-surface placeholder:text-outline focus-within:border-primary-container focus:border-primary-container focus:outline-none"
              />
            </div>

            <AssetSelect label="To" value={destKey} options={destOptions} onChange={setDestKey} />

            {error && <p role="alert" className="text-center text-label-md text-error">{error}</p>}

            <Button fullWidth onClick={toReview} loading={busy} trailingIcon="arrow_forward">
              Get Quote
            </Button>
          </>
        )}
      </main>
    </div>
  );
}

function AssetSelect({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  options: AssetBalance[];
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="text-label-sm uppercase tracking-wide text-on-surface-variant">{label}</label>
        {hint && <span className="text-label-sm text-on-surface-variant">{hint}</span>}
      </div>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-full border border-outline-variant bg-surface-variant px-4 py-2.5 font-mono text-label-md text-on-surface focus:border-primary-container focus:outline-none"
        >
          {options.map((b) => {
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
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-label-md text-on-surface-variant">{label}</span>
      <span className="text-right text-label-md text-on-surface">{value}</span>
    </div>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 bg-surface-container-low px-2">
      <button
        onClick={onBack}
        aria-label="Back"
        className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-variant active:scale-95"
      >
        <Icon name="arrow_back" size={22} />
      </button>
      <h1 className="truncate text-title-md text-on-surface">{title}</h1>
    </header>
  );
}
