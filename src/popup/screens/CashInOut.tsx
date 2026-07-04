import { useEffect, useState } from 'react';
import type { NetworkConfig } from '@shared/constants';
import { anchorsForNetwork, type AnchorEntry } from '@core/anchor/directory';
import { discoverAnchor } from '@core/anchor/toml';
import { fetchSep24Info, type TransferKind } from '@core/anchor/sep24';
import { summarizeAssetSupport, formatTransferLimits, type AssetSupport } from '@core/anchor/transfer';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';

interface Props {
  address: string;
  network: NetworkConfig;
  onBack: () => void;
}

// XLM is the SEP-24 `native` asset code; show the familiar ticker.
const displayCode = (code: string) => (code === 'native' ? 'XLM' : code);

type Pending = { asset: string; direction: TransferKind };

export function CashInOut({ network, onBack }: Props) {
  const kind = network.id === 'TESTNET' ? 'testnet' : 'public';
  const anchors = anchorsForNetwork(kind);

  const [selected, setSelected] = useState<AnchorEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [support, setSupport] = useState<AssetSupport[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  // Discover the selected anchor's stellar.toml (SEP-1) then its supported
  // deposit/withdraw assets (SEP-24 /info — a public endpoint, no auth needed).
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setLoading(true);
    setError(null);
    setSupport(null);
    (async () => {
      try {
        const info = await discoverAnchor(selected.homeDomain);
        if (!info.transferServerSep24) {
          throw new Error('This anchor doesn’t offer SEP-24 deposits or withdrawals.');
        }
        const sep24 = await fetchSep24Info(info.transferServerSep24);
        const assets = summarizeAssetSupport(sep24);
        if (!live) return;
        if (assets.length === 0) throw new Error('This anchor has no assets available right now.');
        setSupport(assets);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Couldn’t reach this anchor.');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [selected]);

  const backToAnchors = () => {
    setSelected(null);
    setSupport(null);
    setError(null);
    setPending(null);
  };

  // --- Slice-2 handoff: authenticate (SEP-10) + complete at the anchor. ---
  if (pending && selected) {
    const verb = pending.direction === 'deposit' ? 'Cash in' : 'Cash out';
    return (
      <div className="flex h-full flex-col bg-background">
        <ScreenHeader title={`${verb} — ${displayCode(pending.asset)}`} onBack={() => setPending(null)} />
        <main className="no-scrollbar flex-1 overflow-y-auto px-4 pb-6">
          <Card className="mt-2 space-y-3 p-4">
            <div className="flex items-center gap-2 text-on-surface">
              <Icon name="lock" size={20} className="text-primary-container" />
              <span className="text-title-sm">Next: verify it’s you</span>
            </div>
            <p className="text-body-md text-on-surface-variant">
              To {verb.toLowerCase()} {displayCode(pending.asset)} with{' '}
              <span className="text-on-surface">{selected.name}</span>, you’ll sign a one-time
              authentication challenge (never submitted on-chain), then complete the transfer in a
              secure window hosted by the anchor. Any transaction it asks you to sign is scanned
              first, like everywhere else in Lantern.
            </p>
            <p className="text-label-md text-on-surface-variant">
              Authentication and the interactive transfer arrive in the next update.
            </p>
          </Card>
          <Button fullWidth disabled className="mt-4" trailingIcon="open_in_new">
            Continue at {selected.name}
          </Button>
        </main>
      </div>
    );
  }

  // --- Anchor picker ---
  if (!selected) {
    return (
      <div className="flex h-full flex-col bg-background">
        <ScreenHeader title="Cash in / Cash out" onBack={onBack} />
        <main className="no-scrollbar flex-1 overflow-y-auto px-4 pb-6">
          <p className="mb-3 mt-2 text-body-md text-on-surface-variant">
            Move between {network.label} and your bank or card through a regulated anchor.
          </p>
          {anchors.length === 0 ? (
            <Card className="mt-2 p-4 text-center text-body-md text-on-surface-variant">
              No anchors are available on {network.label} yet.
            </Card>
          ) : (
            <ul className="space-y-2">
              {anchors.map((a) => (
                <li key={a.id}>
                  <Card onClick={() => setSelected(a)} className="flex items-center gap-3 p-4 text-left">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container/20">
                      <Icon name="account_balance" size={20} className="text-primary-container" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-title-sm text-on-surface">{a.name}</span>
                        {a.verified && (
                          <Icon name="verified" size={16} className="shrink-0 text-primary-container" />
                        )}
                      </div>
                      <span className="text-label-md text-on-surface-variant">{a.homeDomain}</span>
                    </div>
                    <Icon name="chevron_right" size={20} className="shrink-0 text-on-surface-variant" />
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
    );
  }

  // --- Selected anchor: discovered assets ---
  return (
    <div className="flex h-full flex-col bg-background">
      <ScreenHeader title={selected.name} onBack={backToAnchors} />
      <main className="no-scrollbar flex-1 overflow-y-auto px-4 pb-6">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-12 text-on-surface-variant">
            <Icon name="progress_activity" size={32} className="animate-spin text-primary-container" />
            <span className="text-label-md">Checking supported assets…</span>
          </div>
        )}

        {error && !loading && (
          <Card className="mt-2 space-y-3 p-4">
            <p role="alert" className="text-body-md text-error">
              {error}
            </p>
            <Button variant="secondary" fullWidth onClick={backToAnchors}>
              Choose another anchor
            </Button>
          </Card>
        )}

        {support && !loading && (
          <>
            <p className="mb-3 mt-2 text-body-md text-on-surface-variant">
              Supported at <span className="text-on-surface">{selected.name}</span>:
            </p>
            <ul className="space-y-2">
              {support.map((s) => (
                <li key={s.assetCode}>
                  <Card className="space-y-3 p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-title-sm text-on-surface">{displayCode(s.assetCode)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <DirectionButton
                        label="Cash in"
                        icon="south_west"
                        enabled={s.canDeposit}
                        limits={s.deposit ? formatTransferLimits(s.deposit) : null}
                        onClick={() => setPending({ asset: s.assetCode, direction: 'deposit' })}
                      />
                      <DirectionButton
                        label="Cash out"
                        icon="north_east"
                        enabled={s.canWithdraw}
                        limits={s.withdraw ? formatTransferLimits(s.withdraw) : null}
                        onClick={() => setPending({ asset: s.assetCode, direction: 'withdraw' })}
                      />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}

function DirectionButton({
  label,
  icon,
  enabled,
  limits,
  onClick,
}: {
  label: string;
  icon: string;
  enabled: boolean;
  limits: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      className="flex flex-col items-start gap-0.5 rounded-lg border border-outline-variant px-3 py-2.5 text-left transition-colors hover:bg-surface-variant active:scale-95 disabled:opacity-40 disabled:active:scale-100 disabled:cursor-not-allowed"
    >
      <span className="flex items-center gap-1.5 text-label-lg text-on-surface">
        <Icon name={icon} size={16} className="text-primary-container" />
        {label}
      </span>
      <span className="text-label-md text-on-surface-variant">
        {enabled ? (limits ?? 'No limits') : 'Unavailable'}
      </span>
    </button>
  );
}

function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
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
