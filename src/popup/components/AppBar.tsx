import type { NetworkId } from '@shared/constants';
import { truncateAddress } from '@shared/format';
import { Icon } from './Icon';
import { NetworkBadge } from './NetworkBadge';

interface AppBarProps {
  address: string;
  network: NetworkId;
  onToggleNetwork: () => void;
  onLock: () => void;
  onCopyAddress: () => void;
  onOpenScan: () => void;
}

// Top app bar (BRAND §4.3): avatar, truncated mono address, network/status icon.
export function AppBar({
  address,
  network,
  onToggleNetwork,
  onLock,
  onCopyAddress,
  onOpenScan,
}: AppBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 bg-surface-container-low px-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-container/20">
        <Icon name="lightbulb" filled className="text-primary-container" size={20} />
      </div>

      <button
        onClick={onCopyAddress}
        className="flex items-center gap-1.5 text-on-surface transition-colors hover:text-primary"
        title="Copy address"
      >
        <span className="font-mono text-label-md">{truncateAddress(address, 4, 4)}</span>
        <Icon name="content_copy" size={16} className="text-on-surface-variant" />
      </button>

      <div className="ml-auto flex items-center gap-2">
        <button onClick={onToggleNetwork} title="Switch network" className="active:scale-95">
          <NetworkBadge network={network} />
        </button>
        <button
          onClick={onToggleNetwork}
          title="Switch network"
          className="text-on-surface-variant transition-colors hover:text-on-surface active:scale-95"
        >
          <Icon name="sensors" size={22} />
        </button>
        <button
          onClick={onOpenScan}
          title="Security & scam check"
          className="text-on-surface-variant transition-colors hover:text-primary-container active:scale-95"
        >
          <Icon name="security" size={20} />
        </button>
        <button
          onClick={onLock}
          title="Lock wallet"
          className="text-on-surface-variant transition-colors hover:text-on-surface active:scale-95"
        >
          <Icon name="lock" size={20} />
        </button>
      </div>
    </header>
  );
}
