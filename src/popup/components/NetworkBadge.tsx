import type { NetworkId } from '@shared/constants';

// BRAND §8: Testnet = cool blue badge; Mainnet = subtle amber dot. Never identical.
export function NetworkBadge({ network }: { network: NetworkId }) {
  if (network === 'TESTNET') {
    return (
      <span className="rounded-full border border-tertiary-container/40 bg-tertiary-container/15 px-2 py-0.5 text-label-sm font-semibold uppercase tracking-wide text-tertiary">
        Testnet
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">
      <span className="h-1.5 w-1.5 rounded-full bg-primary-container shadow-[0_0_6px_rgba(255,193,7,0.6)]" />
      Mainnet
    </span>
  );
}
