import { useCallback, useEffect, useState } from 'react';
import type { NetworkConfig } from '@shared/constants';
import type { AccountState } from '@shared/types';
import { loadAccountState, fundWithFriendbot } from '@core/stellar/client';
import { formatAmount } from '@shared/format';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { AssetRowSkeleton, Shimmer } from '../components/Shimmer';

interface Props {
  address: string;
  network: NetworkConfig;
  onSend: () => void;
  onReceive: () => void;
  onSwap: () => void;
  onEarn: () => void;
}

export function Assets({ address, network, onSend, onReceive, onSwap, onEarn }: Props) {
  const [state, setState] = useState<AccountState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);

  const load = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      setError(null);
      try {
        setState(await loadAccountState(network, address));
      } catch {
        setError('Could not reach the network. Showing last known data.');
      } finally {
        setLoading(false);
      }
    },
    [network, address],
  );

  // Re-fetch on address or network change (SPEC §6.3).
  useEffect(() => {
    void load();
  }, [load]);

  async function friendbot() {
    setFunding(true);
    setError(null);
    try {
      await fundWithFriendbot(network, address);
      await load(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Funding failed.');
    } finally {
      setFunding(false);
    }
  }

  const native = state?.balances.find((b) => b.isNative);
  const others = state?.balances.filter((b) => !b.isNative) ?? [];

  return (
    <div className="space-y-4 pt-2">
      {/* Available balance block */}
      <section className="relative rounded-2xl bg-surface-container px-4 py-5 text-center shadow-layer-1">
        <button
          onClick={() => load()}
          aria-label="Refresh balances"
          title="Refresh"
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface active:scale-95"
        >
          <Icon name="refresh" size={18} />
        </button>
        <p className="text-label-sm uppercase tracking-wide text-on-surface-variant">Available Balance</p>
        {loading ? (
          <Shimmer className="mx-auto mt-3 h-12 w-40" />
        ) : (
          <p
            className={`mt-2 flex items-baseline justify-center gap-1.5 whitespace-nowrap font-bold tracking-tight text-primary glow-amber-text ${balanceSizeClass(
              native ? formatAmount(native.balance) : '0',
            )}`}
          >
            {native ? formatAmount(native.balance) : '0'}
            <span className="text-title-md font-semibold text-on-surface-variant">XLM</span>
          </p>
        )}
      </section>

      {/* Action-forward quick actions (#110): the primary surface leads with
          Send · Receive · Swap · Earn, each reachable in a single tap. */}
      <nav aria-label="Quick actions" className="grid grid-cols-4 gap-2">
        <QuickAction icon="send" label="Send" onClick={onSend} />
        <QuickAction icon="qr_code_2" label="Receive" onClick={onReceive} />
        <QuickAction icon="swap_horiz" label="Swap" onClick={onSwap} />
        <QuickAction icon="savings" label="Earn" onClick={onEarn} />
      </nav>

      {error && (
        <p role="alert" className="text-center text-label-md text-error">
          {error}
        </p>
      )}

      {/* Unfunded account states (SPEC §5) */}
      {!loading && state && !state.funded && (
        <Card className="space-y-3 text-center">
          <Icon name="account_balance_wallet" size={32} className="mx-auto text-on-surface-variant" />
          {network.id === 'TESTNET' ? (
            <>
              <p className="text-body-md text-on-surface">This account isn't funded yet.</p>
              <p className="text-label-md text-on-surface-variant">
                Fund it with Friendbot to start testing.
              </p>
              <Button fullWidth onClick={friendbot} loading={funding} leadingIcon="water_drop">
                Fund with Friendbot
              </Button>
            </>
          ) : (
            <>
              <p className="text-body-md text-on-surface">Account not funded.</p>
              <p className="text-label-md text-on-surface-variant">
                It needs at least the base reserve (1 XLM) before it appears on the network.
              </p>
            </>
          )}
        </Card>
      )}

      {/* Asset list */}
      {loading ? (
        <div className="space-y-2">
          <AssetRowSkeleton />
          <AssetRowSkeleton />
        </div>
      ) : (
        state?.funded && (
          <div className="space-y-2">
            <p className="px-1 text-label-sm uppercase tracking-wide text-on-surface-variant">Assets</p>
            {native && <AssetRow code="XLM" balance={native.balance} subtitle="Stellar Lumens" />}
            {others.map((a) => (
              <AssetRow
                key={`${a.code}:${a.issuer}`}
                code={a.code}
                balance={a.balance}
                subtitle={a.issuer ? `${a.issuer.slice(0, 4)}…${a.issuer.slice(-4)}` : ''}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}

// A single home quick-action: a tappable amber-tinted icon tile with a label.
function QuickAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-2xl bg-surface-container px-2 py-3 text-on-surface transition-colors hover:bg-surface-variant active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-container/20 text-primary-container">
        <Icon name={icon} size={22} />
      </span>
      <span className="text-label-md">{label}</span>
    </button>
  );
}

// Shrink the hero balance by length so long values (e.g. 9,998.99999 XLM) stay
// on one line within the popup width instead of overflowing.
function balanceSizeClass(formatted: string): string {
  const n = formatted.length;
  if (n <= 8) return 'text-[48px] leading-[54px]';
  if (n <= 11) return 'text-[38px] leading-[44px]';
  if (n <= 14) return 'text-[30px] leading-[36px]';
  return 'text-[24px] leading-[30px]';
}

function AssetRow({ code, balance, subtitle }: { code: string; balance: string; subtitle: string }) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-variant">
          <span className="font-mono text-label-md text-primary">{code.slice(0, 3)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-body-md font-semibold text-on-surface">{code}</p>
          <p className="truncate font-mono text-label-md text-on-surface-variant">{subtitle}</p>
        </div>
        <p className="font-mono text-body-md font-semibold text-on-surface">{formatAmount(balance)}</p>
      </div>
    </Card>
  );
}
