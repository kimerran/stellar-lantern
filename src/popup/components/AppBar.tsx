import type { NetworkId } from '@shared/constants';
import { truncateAddress } from '@shared/format';
import { Icon } from './Icon';
import { NetworkBadge } from './NetworkBadge';

interface AppBarProps {
  address: string;
  network: NetworkId;
  onCopyAddress: () => void;
  /** When provided (popup mode), shows an "open in full tab" button. */
  onExpand?: () => void;
}

// Top app bar (BRAND §4.3): decluttered to just identity + network badge (#110).
// The old six-icon action row (Receive · Activity · Cash · Guardians · Security ·
// Lock) is re-homed into the Settings hub, which is now a bottom-nav tab; the
// everyday actions lead the Home screen. The network badge stays always-visible
// for the BRAND §8 testnet/mainnet distinction, but is display-only — the toggle
// lives in Settings › Network.
export function AppBar({ address, network, onCopyAddress, onExpand }: AppBarProps) {
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

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <NetworkBadge network={network} />
        {onExpand && (
          <button
            onClick={onExpand}
            aria-label="Open in full tab"
            title="Open in full tab"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface active:scale-95"
          >
            <Icon name="open_in_full" size={20} />
          </button>
        )}
      </div>
    </header>
  );
}
