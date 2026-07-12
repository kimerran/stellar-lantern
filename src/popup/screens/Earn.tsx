import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { readReserveApys } from '@core/blend/apr';
import { type BlendAction, BLEND_WITHDRAW_ALL_AMOUNT } from '@core/blend/pool';
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
  /** Overlay mode: closes the screen. Omitted when rendered inline as a tab. */
  onBack?: () => void;
  /** Render inline as a bottom-nav tab (no full-screen chrome / back header). */
  embedded?: boolean;
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

export function Earn({ address, network, onBack, embedded }: Props) {
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
  // True when the withdraw amount was prefilled via "Withdraw all" — submit sends the
  // full-balance sentinel (leaves no dust) instead of the displayed underlying, which
  // keeps accruing between quote and submit. Cleared the moment the user edits.
  const [withdrawAll, setWithdrawAll] = useState(false);

  // Supplied-position readout per pool (fail-soft: null/absent → no readout).
  const [positions, setPositions] = useState<Record<string, SuppliedPosition[]>>({});
  // Estimated supply APY per pool → asset code (fail-soft: null/absent → "—").
  const [apys, setApys] = useState<Record<string, Record<string, number | null>>>({});

  // Read the user's current supplied balances (per reserve) and each reserve's
  // estimated supply APY. Read-only + advisory — any failure just omits the readout
  // and never blocks supply/withdraw.
  useEffect(() => {
    const rpcUrl = network.sorobanRpcUrl;
    if (!rpcUrl || pools.length === 0) return;
    let live = true;
    (async () => {
      for (const pool of pools) {
        const refs = pool.reserves.map((r) => ({ code: r.code, assetId: r.assetId }));
        const supplied = await readSuppliedPositions(pool.poolId, address, refs, { rpcUrl });
        if (live && supplied) setPositions((prev) => ({ ...prev, [pool.id]: supplied }));
        const rates = await readReserveApys(pool.poolId, refs, { rpcUrl });
        if (live && rates) setApys((prev) => ({ ...prev, [pool.id]: rates }));
      }
    })();
    return () => {
      live = false;
    };
  }, [address, network.sorobanRpcUrl, pools]);

  function suppliedPosition(poolId: string, code: string): SuppliedPosition | null {
    const found = positions[poolId]?.find((p) => p.code === code);
    if (!found || BigInt(found.suppliedBase) <= 0n) return null;
    return found;
  }

  function suppliedDisplay(poolId: string, reserve: BlendReserve): string | null {
    const found = suppliedPosition(poolId, reserve.code);
    if (!found) return null;
    return formatAmount((Number(found.suppliedBase) / 10 ** found.decimals).toString());
  }

  function apyFor(poolId: string, code: string): number | null | undefined {
    return apys[poolId]?.[code];
  }

  function choose(pool: BlendPool, reserve: BlendReserve, action: BlendAction) {
    setSel({ pool, reserve, action });
    setAmount('');
    setWithdrawAll(false);
    setError(null);
    setStep('form');
  }

  function backToForm() {
    setStep('form');
    setReview(null);
    setConfirmText('');
    setError(null);
  }

  // "Done" / close. In overlay mode this closes the screen; embedded as a tab
  // there's nowhere to go back to, so reset the flow to the pool picker.
  function finish() {
    if (embedded) {
      setStep('pick');
      setSel(null);
      setAmount('');
      setReview(null);
      setConfirmText('');
      setTxHash(null);
      setError(null);
    } else {
      onBack?.();
    }
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
      if (sel.action === 'withdraw' && withdrawAll) {
        // Full-balance withdraw: send the sentinel so Blend burns the whole position
        // and leaves no dust (the displayed underlying keeps accruing and would round
        // short). Still simulated + scanned + gated below like any other amount.
        base = BLEND_WITHDRAW_ALL_AMOUNT;
      } else {
        try {
          base = toBaseUnits(amount, sel.reserve.decimals);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Invalid amount.');
          return;
        }
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
      <Shell title={`${actionVerb(sel.action)} — ${sel.reserve.code}`} onBack={finish} embedded={embedded}>
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
              <Button fullWidth onClick={finish}>
                Done
              </Button>
            </div>
          </div>
      </Shell>
    );
  }

  // ── Review (with Lantern scan) ──
  if (step === 'review' && review && sel) {
    const verdict = review.verdict;
    const isHigh = verdict.action === 'block_confirm';
    const native = isNativePlatform();
    const acknowledged = !isHigh || native || confirmText.trim().toUpperCase() === 'CONFIRM';

    return (
      <Shell
        title={`${actionVerb(sel.action)} — ${sel.reserve.code}`}
        onBack={backToForm}
        embedded={embedded}
        mainClass="space-y-4 pt-3"
      >
          <div className="rounded-2xl bg-surface-container p-5 text-center shadow-layer-1">
            <p className="text-label-sm uppercase tracking-wide text-on-surface-variant">
              You’re {sel.action === 'supply' ? 'supplying' : 'withdrawing'}
            </p>
            <p className={`mt-2 text-headline-lg ${isHigh ? 'text-on-surface-variant' : 'text-primary glow-amber-text'}`}>
              {formatAmount(amount)} {sel.reserve.code}
            </p>
            {sel.action === 'withdraw' && withdrawAll && (
              <p className="mt-1 text-label-sm text-on-surface-variant">
                Full balance — withdraws everything, no dust left.
              </p>
            )}
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
      </Shell>
    );
  }

  // ── Amount form ──
  if (step === 'form' && sel) {
    const position = suppliedPosition(sel.pool.id, sel.reserve.code);
    const maxDisplay =
      position && (Number(position.suppliedBase) / 10 ** position.decimals).toString();
    const estApy = apyFor(sel.pool.id, sel.reserve.code);
    return (
      <Shell
        title={`${actionVerb(sel.action)} — ${sel.reserve.code}`}
        onBack={() => setStep('pick')}
        embedded={embedded}
        mainClass="space-y-4 pt-3"
      >
          <p className="text-body-md text-on-surface-variant">
            {sel.action === 'supply'
              ? `Supply ${sel.reserve.code} into ${sel.pool.name} to earn lending yield. You can withdraw anytime.`
              : `Withdraw ${sel.reserve.code} you previously supplied to ${sel.pool.name}.`}
          </p>

          <div className="flex items-center justify-between rounded-2xl bg-surface-container p-3.5 shadow-layer-1">
            <span className="text-label-md text-on-surface-variant">Est. APY</span>
            <span className="font-mono text-title-sm text-primary glow-amber-text">{formatApy(estApy)}</span>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="earn-amount" className="text-label-sm uppercase tracking-wide text-on-surface-variant">
                Amount
              </label>
              {sel.action === 'withdraw' && maxDisplay ? (
                <button
                  type="button"
                  onClick={() => {
                    setAmount(maxDisplay);
                    setWithdrawAll(true);
                    setError(null);
                  }}
                  className="rounded-md border border-primary-container/40 px-2 py-0.5 text-label-sm font-semibold text-primary-container transition-colors hover:bg-primary-container/10 active:scale-95"
                >
                  MAX · {formatAmount(maxDisplay)} {sel.reserve.code}
                </button>
              ) : (
                <span className="text-label-sm text-on-surface-variant">{sel.reserve.code}</span>
              )}
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 focus-within:border-primary-container focus-within:shadow-focus-amber">
              <input
                id="earn-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value.replace(/[^0-9.]/g, ''));
                  setWithdrawAll(false);
                }}
                className="w-full bg-transparent text-right font-mono text-headline-lg text-on-surface placeholder:text-outline focus:outline-none"
              />
            </div>
            {sel.action === 'withdraw' && withdrawAll && (
              <p className="mt-1.5 text-right text-label-sm text-primary-container">
                Withdrawing your full balance — no dust left.
              </p>
            )}
          </div>

          {error && <p role="alert" className="text-center text-label-md text-error">{error}</p>}

          <Button fullWidth onClick={toReview} loading={busy} trailingIcon="arrow_forward">
            Review
          </Button>
      </Shell>
    );
  }

  // ── Pool / reserve picker ──
  // Collect every reserve the user is currently earning on, across pools, for the hero.
  const earning = pools.flatMap((pool) =>
    pool.reserves.flatMap((r) => {
      const supplied = suppliedDisplay(pool.id, r);
      return supplied
        ? [{ key: `${pool.id}:${r.code}`, code: r.code, poolName: pool.name, supplied, apy: apyFor(pool.id, r.code) }]
        : [];
    }),
  );

  return (
    <Shell title="Earn yield" onBack={embedded ? undefined : onBack} embedded={embedded}>
        <p className="mb-3 mt-2 text-body-md text-on-surface-variant">
          Supply your assets to a Blend lending pool and earn yield — withdraw anytime.
        </p>
        {pools.length === 0 ? (
          <Card className="mt-2 p-4 text-center text-body-md text-on-surface-variant">
            Blend pools aren’t available on {network.label} yet. Switch to Testnet to try it.
          </Card>
        ) : (
          <>
            {earning.length > 0 ? (
              <section className="mt-3 overflow-hidden rounded-3xl bg-surface-container shadow-layer-1 ring-1 ring-primary-container/25">
                <div className="bg-gradient-to-b from-primary-container/15 to-transparent px-4 pb-4 pt-4">
                  <div className="flex items-center gap-2">
                    <Icon name="savings" size={18} className="text-primary-container drop-shadow-glow-amber" />
                    <h2 className="text-label-sm uppercase tracking-wide text-on-surface-variant">Your positions</h2>
                  </div>
                  <p className="mt-1 text-title-md text-primary glow-amber-text">
                    Earning on {earning.length} {earning.length === 1 ? 'asset' : 'assets'}
                  </p>
                  <ul className="mt-3 space-y-2">
                    {earning.map((e) => (
                      <li
                        key={e.key}
                        className="flex items-center justify-between rounded-2xl bg-surface-container-high/60 px-3 py-2"
                      >
                        <div>
                          <div className="font-mono text-label-lg text-on-surface">
                            {e.supplied} {e.code}
                          </div>
                          <div className="text-label-sm text-on-surface-variant">{e.poolName}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-label-lg text-primary-container">{formatApy(e.apy)}</div>
                          <div className="text-label-sm text-on-surface-variant">est. APY</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            ) : (
              <Card className="mt-3 flex items-center gap-3 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-container/15">
                  <Icon name="savings" size={18} className="text-primary-container" />
                </div>
                <p className="text-body-md text-on-surface-variant">
                  Nothing earning yet — supply an asset to start.
                </p>
              </Card>
            )}

            <SectionLabel>Available pools</SectionLabel>
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
                      {pool.lantern && (
                        <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-primary-container/40 bg-primary-container/15 px-2 py-0.5 text-label-sm font-semibold text-primary-container">
                          <Icon name="lightbulb" filled size={12} />
                          Lantern
                        </span>
                      )}
                    </div>
                    <ul className="space-y-2">
                      {pool.reserves.map((r) => {
                        const supplied = suppliedDisplay(pool.id, r);
                        return (
                          <li key={r.assetId} className="space-y-2">
                            <div className="flex items-baseline gap-2">
                              <span className="font-mono text-label-md text-on-surface">{r.code}</span>
                              <span className="text-label-sm text-primary-container">
                                {formatApy(apyFor(pool.id, r.code))} est. APY
                              </span>
                              {supplied && (
                                <span className="ml-auto truncate text-label-sm text-on-surface-variant">
                                  {supplied} earning
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
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
          </>
        )}
    </Shell>
  );
}

// Format an estimated APY fraction (0.0432 → "4.32%") for display; "—" when the
// rate is unavailable (fail-soft), matching the position readout's honesty.
function formatApy(apy: number | null | undefined): string {
  if (apy == null || !Number.isFinite(apy)) return '—';
  return `${(apy * 100).toFixed(2)}%`;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2 mt-5 text-label-sm uppercase tracking-wide text-on-surface-variant">{children}</h2>
  );
}

function ActionButton({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-outline-variant px-3 py-2 text-label-lg text-on-surface transition-colors hover:bg-surface-variant active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container"
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

// Renders each step either as a full-screen overlay (with a back header) or,
// when `embedded`, inline inside the bottom-nav tab — no full-screen chrome, and
// a back affordance only for the deeper flow steps (form/review/success).
function Shell({
  title,
  onBack,
  embedded,
  mainClass,
  children,
}: {
  title: string;
  onBack?: () => void;
  embedded?: boolean;
  mainClass?: string;
  children: ReactNode;
}) {
  if (embedded) {
    return (
      <div className={`pt-2 ${mainClass ?? ''}`}>
        <div className="mb-2 flex items-center gap-1">
          {onBack && (
            <button
              onClick={onBack}
              aria-label="Back"
              className="-ml-2 flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-variant active:scale-95"
            >
              <Icon name="arrow_back" size={20} />
            </button>
          )}
          <h2 className="truncate text-title-md text-on-surface">{title}</h2>
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col bg-background">
      <Header title={title} onBack={onBack ?? (() => undefined)} />
      <main className={`no-scrollbar flex-1 overflow-y-auto px-4 pb-6 ${mainClass ?? ''}`}>{children}</main>
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
