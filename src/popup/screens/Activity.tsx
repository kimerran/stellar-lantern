import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NetworkConfig } from '@shared/constants';
import type { HistoryItem } from '@shared/types';
import { fetchHistory } from '@core/history/history';
import { dateGroupLabel, formatTime, truncateAddress } from '@shared/format';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';
import { AmountText } from '../components/AmountText';
import { Shimmer } from '../components/Shimmer';
import { TxDetail } from './TxDetail';

interface Props {
  address: string;
  network: NetworkConfig;
}

const ICONS: Record<HistoryItem['direction'], { icon: string; cls: string }> = {
  received: { icon: 'arrow_downward', cls: 'text-primary-container drop-shadow-glow-amber' },
  sent: { icon: 'arrow_upward', cls: 'text-outline' },
  swap: { icon: 'swap_horiz', cls: 'text-secondary drop-shadow-glow-orange' },
  create: { icon: 'arrow_upward', cls: 'text-outline' },
};

export function Activity({ address, network }: Props) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<HistoryItem | null>(null);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchHistory(network, address);
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch {
      setError('Could not load transaction history.');
    } finally {
      setLoading(false);
    }
  }, [network, address]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchHistory(network, address, cursor);
      // de-dupe by id (SPEC §6.5 acceptance)
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...page.items.filter((i) => !seen.has(i.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setError('Could not load more.');
    } finally {
      setLoadingMore(false);
    }
  }

  const groups = useMemo(() => groupByDate(items), [items]);

  if (selected) {
    return <TxDetail item={selected} network={network} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="space-y-4 pt-2">
      <h2 className="px-1 text-title-md text-on-surface">Activity</h2>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl bg-surface-container p-3">
              <Shimmer className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Shimmer className="h-4 w-24" />
                <Shimmer className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      ) : error && items.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-label-md text-error">{error}</p>
          <Button variant="secondary" className="mt-3" onClick={loadFirst}>
            Retry
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center">
          <Icon name="history" size={40} className="mx-auto text-on-surface-variant" />
          <p className="mt-3 text-body-md text-on-surface-variant">No transactions yet.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(({ label, rows }) => (
            <div key={label} className="space-y-2">
              <p className="px-1 text-label-sm uppercase tracking-wide text-on-surface-variant">{label}</p>
              {rows.map((item) => (
                <Card key={item.id} onClick={() => setSelected(item)}>
                  <Row item={item} />
                </Card>
              ))}
            </div>
          ))}

          {cursor && (
            <div className="flex justify-center pt-1">
              <Button variant="secondary" className="!rounded-full" onClick={loadMore} loading={loadingMore}>
                Load More
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ item }: { item: HistoryItem }) {
  const { icon, cls } = ICONS[item.direction];
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-variant">
        <Icon name={icon} size={20} className={cls} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-body-md font-semibold text-on-surface">{item.title}</p>
        <p className="truncate font-mono text-label-md text-on-surface-variant">
          {item.counterparty ? truncateAddress(item.counterparty) : '—'}
        </p>
      </div>
      <div className="text-right">
        {item.signedAmount && <AmountText signedAmount={item.signedAmount} assetCode={item.assetCode} />}
        <p className="text-label-sm text-on-surface-variant">{formatTime(item.createdAt)}</p>
      </div>
    </div>
  );
}

function groupByDate(items: HistoryItem[]): { label: string; rows: HistoryItem[] }[] {
  const now = new Date();
  const order: string[] = [];
  const map = new Map<string, HistoryItem[]>();
  for (const item of items) {
    const label = dateGroupLabel(item.createdAt, now);
    if (!map.has(label)) {
      map.set(label, []);
      order.push(label);
    }
    map.get(label)!.push(item);
  }
  return order.map((label) => ({ label, rows: map.get(label)! }));
}
