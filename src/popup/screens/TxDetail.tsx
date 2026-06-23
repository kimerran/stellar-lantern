import type { NetworkConfig } from '@shared/constants';
import type { HistoryItem } from '@shared/types';
import { formatAmount, formatTime } from '@shared/format';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';
import { AmountText } from '../components/AmountText';

interface Props {
  item: HistoryItem;
  network: NetworkConfig;
  onBack: () => void;
}

export function TxDetail({ item, network, onBack }: Props) {
  return (
    <div className="space-y-4 pt-2">
      <button onClick={onBack} className="flex items-center gap-1 text-label-md text-on-surface-variant hover:text-on-surface">
        <Icon name="arrow_back" size={18} /> Activity
      </button>

      <div className="text-center">
        <p className="text-label-sm uppercase tracking-wide text-on-surface-variant">{item.title}</p>
        <div className="mt-2 text-display-lg">
          {item.signedAmount ? (
            <AmountText signedAmount={item.signedAmount} assetCode={item.assetCode} />
          ) : (
            <span className="text-on-surface">—</span>
          )}
        </div>
        <p className="mt-1 text-label-md text-on-surface-variant">
          {new Date(item.createdAt).toLocaleDateString()} · {formatTime(item.createdAt)}
        </p>
      </div>

      <Card className="space-y-3">
        <DetailRow label="Status" value={item.successful ? 'Succeeded' : 'Failed'} />
        {item.counterparty && <DetailRow label="Counterparty" value={item.counterparty} mono />}
        {item.amount && <DetailRow label="Amount" value={`${formatAmount(item.amount)} ${item.assetCode}`} />}
        {item.memo && <DetailRow label="Memo" value={item.memo} />}
        {item.fee && <DetailRow label="Fee" value={`${formatAmount(item.fee)} XLM`} />}
        {item.ledger != null && <DetailRow label="Ledger" value={String(item.ledger)} />}
        <DetailRow label="Tx Hash" value={item.hash} mono />
      </Card>

      <Button
        fullWidth
        variant="secondary"
        trailingIcon="open_in_new"
        onClick={() => window.open(network.explorerTxUrl(item.hash), '_blank')}
      >
        View on Explorer
      </Button>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-label-md text-on-surface-variant">{label}</span>
      <span className={`break-all text-right text-label-md text-on-surface ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}
