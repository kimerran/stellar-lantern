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
}

export function Assets({ address, network, onSend }: Props) {
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
      <section className="rounded-2xl bg-surface-container px-4 py-5 text-center shadow-layer-1">
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
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={onSend} leadingIcon="send">
            Send
          </Button>
          <Button variant="secondary" onClick={() => load()} leadingIcon="refresh">
            Refresh
          </Button>
        </div>
      </section>

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
