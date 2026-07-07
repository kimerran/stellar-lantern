import { useEffect, useMemo, useState } from 'react';
import type { NetworkConfig } from '@shared/constants';
import { sendMessage } from '@shared/messages';
import { getServer } from '@core/stellar/client';
import { scan } from '@core/scan/engine';
import type { ScanVerdict } from '@core/scan/types';
import { isNativePlatform } from '@shared/kv';
import { formatAmount } from '@shared/format';
import {
  blendPoolsForNetwork,
  type BlendPool,
  type BlendReserve,
} from '@core/blend/directory';
import { toBaseUnits, prepareBlendSubmit } from '@core/blend/submit';
import { readSuppliedPositions, type SuppliedPosition } from '@core/blend/positions';
import type { BlendAction } from '@core/blend/pool';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
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

type Step = 'pick' | 'form' | 'review' | 'success';

interface Selection {
  pool: BlendPool;
  reserve: BlendReserve;
  action: BlendAction;
}

interface ReviewData {
  xdr: string;
  verdict: ScanVerdict;
}

const actionVerb = (a: BlendAction) => (a === 'supply' ? 'Supply' : 'Withdraw');

export function Earn({ address, network, onBack }: Props) {
  const kind = network.id === 'TESTNET' ? 'testnet' : 'public';
  // Memoized so it's a stable dependency for the positions effect (otherwise a
  // fresh array each render would re-trigger the fetch on every state update).
  const pools = useMemo(() => blendPoolsForNetwork(kind), [kind]);

  const [step, setStep] = useState<Step>('pick');
  const [sel, setSel] = useState<Selection | null>(null);
  const [amount, setAmount] = useState('');
  const [review, setReview] = useState<ReviewData | null>(null);

  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');

  // Supplied-position readout per pool (fail-soft: null/absent → no readout).
  const [positions, setPositions] = useState<Record<string, SuppliedPosition[]>>({});

  // Read the user's current supplied balances so each reserve row can show what
  // they've already got earning yield. Read-only + advisory — any failure just
  // omits the readout and never blocks supply/withdraw.
  useEffect(() => {
    const rpcUrl = network.sorobanRpcUrl;
    if (!rpcUrl || pools.length === 0) return;
    let live = true;
    (async () => {
      for (const pool of pools) {
        const supplied = await readSuppliedPositions(
          pool.poolId,
          address,
          pool.reserves.map((r) => ({ code: r.code, assetId: r.assetId })),
          { rpcUrl },
        );
        if (live && supplied) setPositions((prev) => ({ ...prev, [pool.id]: supplied }));
      }
    })();
    return () => {
      live = false;
    };
  }, [address, network.sorobanRpcUrl, pools]);

  function suppliedDisplay(poolId: string, reserve: BlendReserve): string | null {
    const found = positions[poolId]?.find((p) => p.code === reserve.code);
    if (!found || BigInt(found.suppliedBase) <= 0n) return null;
    return formatAmount((Number(found.suppliedBase) / 10 ** found.decimals).toString());
  }

  function choose(pool: BlendPool, reserve: BlendReserve, action: BlendAction) {
    setSel({ pool, reserve, action });
    setAmount('');
    setError(null);
    setStep('form');
  }

  function backToForm() {
    setStep('form');
    setReview(null);
    setConfirmText('');
    setError(null);
  }

  // Build → simulate → assemble the Blend submit, then scan it, before signing.
  async function toReview() {
    if (!sel) return;
    const amt = Number(amount);
    if (!amount || !Number.isFinite(amt) || amt <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (!network.sorobanRpcUrl) {
      setError('Soroban RPC isn’t configured for this network.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let base: string;
      try {
        base = toBaseUnits(amount, sel.reserve.decimals);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Invalid amount.');
        return;
      }

      const server = getServer(network);
      const sourceAccount = await server.loadAccount(address);

      const prepared = await prepareBlendSubmit({
        poolId: sel.pool.poolId,
        userAddress: address,
        reserveAssetId: sel.reserve.assetId,
        amount: base,
        action: sel.action,
        sourceSequence: sourceAccount.sequenceNumber(),
        networkPassphrase: network.passphrase,
        rpcUrl: network.sorobanRpcUrl,
      });
      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }

      // Lantern pre-sign scan — advisory, never signs or sends (spec §2).
      const verdict = scan({
        xdr: prepared.xdr,
        networkPassphrase: network.passphrase,
        context: { network: network.id, fromAddress: address },
      });
      setReview({ xdr: prepared.xdr, verdict });
      setConfirmText('');
      setStep('review');
    } catch {
      setError('Couldn’t prepare the transaction. Check your connection and try again.');
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
  if (step === 'success' && txHash && sel) {
    return (
      <div className="flex h-full flex-col bg-background">
        <Header title={`${actionVerb(sel.action)} — ${sel.reserve.code}`} onBack={onBack} />
        <main className="no-scrollbar flex-1 overflow-y-auto px-4 pb-6">
          <div className="flex flex-col items-center pt-8 text-center">
            <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-primary-container/15">
              <Icon name="check_circle" filled size={48} className="text-primary-container drop-shadow-glow-amber" />
            </div>
            <h2 className="text-title-md text-on-surface">
              {sel.action === 'supply' ? 'Supplied!' : 'Withdrawn!'}
            </h2>
            <p className="mt-1 text-label-md text-on-surface-variant">
              {formatAmount(amount)} {sel.reserve.code}{' '}
              {sel.action === 'supply' ? 'now earning yield in' : 'withdrawn from'} {sel.pool.name}.
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
  if (step === 'review' && review && sel) {
    const verdict = review.verdict;
    const isHigh = verdict.action === 'block_confirm';
    const native = isNativePlatform();
    const acknowledged = !isHigh || native || confirmText.trim().toUpperCase() === 'CONFIRM';

    return (
      <div className="flex h-full flex-col bg-background">
        <Header title={`${actionVerb(sel.action)} — ${sel.reserve.code}`} onBack={backToForm} />
        <main className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-4 pb-6 pt-3">
          <div className="rounded-2xl bg-surface-container p-5 text-center shadow-layer-1">
            <p className="text-label-sm uppercase tracking-wide text-on-surface-variant">
              You’re {sel.action === 'supply' ? 'supplying' : 'withdrawing'}
            </p>
            <p className={`mt-2 text-headline-lg ${isHigh ? 'text-on-surface-variant' : 'text-primary glow-amber-text'}`}>
              {formatAmount(amount)} {sel.reserve.code}
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
                whatToDo={isHigh ? 'Only continue if you trust this pool. Signing cannot be reversed.' : undefined}
              />
            )}
          </div>

          <Card className="space-y-3">
            <Row label="Action" value={`${actionVerb(sel.action)} to earn yield`} />
            <Row label="Pool" value={sel.pool.name} />
            <Row label="Asset" value={sel.reserve.code} />
            <Row label="Network" value={network.label} />
          </Card>

          {isHigh && !native && (
            <div className="space-y-2">
              <p className="text-label-sm text-error">
                To proceed anyway, type <span className="font-mono font-semibold">CONFIRM</span> below.
              </p>
              <Input mono placeholder="CONFIRM" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            </div>
          )}

          {error && <p role="alert" className="text-center text-label-md text-error">{error}</p>}

          {isHigh && native ? (
            <HoldToConfirm
              label={submitting ? 'Signing…' : 'Hold to Sign Anyway'}
              danger
              onConfirm={confirm}
              disabled={submitting}
            />
          ) : (
            <Button
              fullWidth
              onClick={confirm}
              loading={submitting}
              disabled={!acknowledged}
              variant={isHigh ? 'secondary' : 'primary'}
              trailingIcon="lock"
              className={isHigh ? '!border-error/50 !text-error' : ''}
            >
              {isHigh ? 'Sign Anyway' : `Confirm & ${actionVerb(sel.action)}`}
            </Button>
          )}
        </main>
      </div>
    );
  }

  // ── Amount form ──
  if (step === 'form' && sel) {
    return (
      <div className="flex h-full flex-col bg-background">
        <Header title={`${actionVerb(sel.action)} — ${sel.reserve.code}`} onBack={() => setStep('pick')} />
        <main className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-4 pb-6 pt-3">
          <p className="text-body-md text-on-surface-variant">
            {sel.action === 'supply'
              ? `Supply ${sel.reserve.code} into ${sel.pool.name} to earn lending yield. You can withdraw anytime.`
              : `Withdraw ${sel.reserve.code} you previously supplied to ${sel.pool.name}.`}
          </p>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="earn-amount" className="text-label-sm uppercase tracking-wide text-on-surface-variant">
                Amount
              </label>
              <span className="text-label-sm text-on-surface-variant">{sel.reserve.code}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 focus-within:border-primary-container focus-within:shadow-focus-amber">
              <input
                id="earn-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                className="w-full bg-transparent text-right font-mono text-headline-lg text-on-surface placeholder:text-outline focus:outline-none"
              />
            </div>
          </div>

          {error && <p role="alert" className="text-center text-label-md text-error">{error}</p>}

          <Button fullWidth onClick={toReview} loading={busy} trailingIcon="arrow_forward">
            Review
          </Button>
        </main>
      </div>
    );
  }

  // ── Pool / reserve picker ──
  return (
    <div className="flex h-full flex-col bg-background">
      <Header title="Earn yield" onBack={onBack} />
      <main className="no-scrollbar flex-1 overflow-y-auto px-4 pb-6">
        <p className="mb-3 mt-2 text-body-md text-on-surface-variant">
          Supply your assets to a Blend lending pool and earn yield — withdraw anytime.
        </p>
        {pools.length === 0 ? (
          <Card className="mt-2 p-4 text-center text-body-md text-on-surface-variant">
            Blend pools aren’t available on {network.label} yet. Switch to Testnet to try it.
          </Card>
        ) : (
          <ul className="space-y-3">
            {pools.map((pool) => (
              <li key={pool.id}>
                <Card className="space-y-3 p-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-container/20">
                      <Icon name="savings" size={18} className="text-primary-container" />
                    </div>
                    <span className="truncate text-title-sm text-on-surface">{pool.name}</span>
                    {pool.verified && <Icon name="verified" size={16} className="shrink-0 text-primary-container" />}
                  </div>
                  <ul className="space-y-2">
                    {pool.reserves.map((r) => {
                      const supplied = suppliedDisplay(pool.id, r);
                      return (
                        <li key={r.assetId} className="flex items-center gap-2">
                          <div className="w-16 shrink-0">
                            <div className="font-mono text-label-md text-on-surface">{r.code}</div>
                            {supplied && (
                              <div className="text-label-sm text-primary-container">{supplied} earning</div>
                            )}
                          </div>
                          <div className="grid flex-1 grid-cols-2 gap-2">
                            <ActionButton label="Supply" icon="south_west" onClick={() => choose(pool, r, 'supply')} />
                            <ActionButton label="Withdraw" icon="north_east" onClick={() => choose(pool, r, 'withdraw')} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function ActionButton({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center gap-1.5 rounded-lg border border-outline-variant px-3 py-2 text-label-lg text-on-surface transition-colors hover:bg-surface-variant active:scale-95"
    >
      <Icon name={icon} size={16} className="text-primary-container" />
      {label}
    </button>
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
