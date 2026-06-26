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
  /** When provided (popup mode), shows an "open in full tab" button. */
  onExpand?: () => void;
}

// Top app bar (BRAND §4.3): avatar, truncated mono address, network/status icon.
export function AppBar({
  address,
  network,
  onToggleNetwork,
  onLock,
  onCopyAddress,
  onOpenScan,
  onExpand,
}: AppBarProps) {
  const actions = [
    ...(onExpand
      ? [{ onClick: onExpand, icon: 'open_in_full', label: 'Open in full tab', hover: 'hover:text-on-surface' }]
      : []),
    { onClick: onOpenScan, icon: 'security', label: 'Security & scam check', hover: 'hover:text-primary-container' },
    { onClick: onLock, icon: 'lock', label: 'Lock wallet', hover: 'hover:text-on-surface' },
  ];

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 bg-surface-container-low px-2">
      <div className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-container/20">
        <Icon name="lightbulb" filled className="text-primary-container" size={20} />
      </div>

      <button
        onClick={onCopyAddress}
        className="flex min-w-0 min-h-[44px] shrink items-center gap-1.5 rounded-lg px-2 text-on-surface transition-colors hover:bg-surface-variant active:scale-95"
        aria-label={`Copy address ${truncateAddress(address, 4, 4)}`}
        title="Copy address"
      >
        <span className="truncate font-mono text-label-md">{truncateAddress(address, 4, 4)}</span>
        <Icon name="content_copy" size={16} className="shrink-0 text-on-surface-variant" />
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {/* The network badge is itself the toggle (was duplicated with a sensors icon). */}
        <button
          onClick={onToggleNetwork}
          aria-label={`Network: ${network}. Switch network`}
          title="Switch network"
          className="flex min-h-[44px] items-center rounded-lg px-1.5 transition-colors hover:bg-surface-variant active:scale-95"
        >
          <NetworkBadge network={network} />
        </button>
        {actions.map(({ onClick, icon, label, hover }) => (
          <button
            key={icon}
            onClick={onClick}
            aria-label={label}
            title={label}
            className={`flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-variant active:scale-95 ${hover}`}
          >
            <Icon name={icon} size={20} />
          </button>
        ))}
      </div>
    </header>
  );
}
