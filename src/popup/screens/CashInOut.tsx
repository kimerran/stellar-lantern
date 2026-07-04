import { useEffect, useRef, useState } from 'react';
import type { NetworkConfig } from '@shared/constants';
import { sendMessage } from '@shared/messages';
import { anchorsForNetwork, type AnchorEntry } from '@core/anchor/directory';
import { discoverAnchor, type AnchorInfo } from '@core/anchor/toml';
import { fetchSep24Info, startInteractive, type TransferKind } from '@core/anchor/sep24';
import { authenticateSep10 } from '@core/anchor/session';
import { pollTransferStatus } from '@core/anchor/poll';
import type { TransferStatusInfo } from '@core/anchor/status';
import {
  summarizeAssetSupport,
  formatTransferLimits,
  webAuthDomainFor,
  type AssetSupport,
} from '@core/anchor/transfer';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { SandboxedFrame } from '../components/SandboxedFrame';

interface Props {
  address: string;
  network: NetworkConfig;
  onBack: () => void;
}

// XLM is the SEP-24 `native` asset code; show the familiar ticker.
const displayCode = (code: string) => (code === 'native' ? 'XLM' : code);

interface TransferState {
  asset: string;
  direction: TransferKind;
  phase: 'authing' | 'interactive' | 'done' | 'error';
  url?: string; // interactive URL once authenticated
  id?: string; // SEP-24 transaction id (to poll)
  status?: TransferStatusInfo; // latest polled status
  error?: string;
}

export function CashInOut({ address, network, onBack }: Props) {
  const kind = network.id === 'TESTNET' ? 'testnet' : 'public';
  const anchors = anchorsForNetwork(kind);

  const [selected, setSelected] = useState<AnchorEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<AnchorInfo | null>(null);
  const [support, setSupport] = useState<AssetSupport[] | null>(null);
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const jwtRef = useRef<string | null>(null);

  // Discover the selected anchor's stellar.toml (SEP-1) then its supported
  // deposit/withdraw assets (SEP-24 /info — a public endpoint, no auth needed).
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setLoading(true);
    setError(null);
    setInfo(null);
    setSupport(null);
    (async () => {
      try {
        const anchorInfo = await discoverAnchor(selected.homeDomain);
        if (!anchorInfo.transferServerSep24) {
          throw new Error('This anchor doesn’t offer SEP-24 deposits or withdrawals.');
        }
        const sep24 = await fetchSep24Info(anchorInfo.transferServerSep24);
        const assets = summarizeAssetSupport(sep24);
        if (!live) return;
        if (assets.length === 0) throw new Error('This anchor has no assets available right now.');
        setInfo(anchorInfo);
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

  // Once authenticated + the interactive session is open, poll its status until a
  // terminal state (completed / refunded / …). Cancels on close/unmount.
  useEffect(() => {
    if (!transfer || transfer.phase !== 'interactive' || !transfer.id) return;
    const transferServer = info?.transferServerSep24;
    const jwt = jwtRef.current;
    if (!transferServer || !jwt) return;
    const activeId = transfer.id;
    let cancelled = false;
    void pollTransferStatus({
      transferServer,
      id: activeId,
      jwt,
      onUpdate: (u) =>
        setTransfer((t) => (t && t.id === activeId ? { ...t, status: u.info } : t)),
      isCancelled: () => cancelled,
    })
      .then((final) =>
        setTransfer((t) =>
          t && t.id === activeId
            ? { ...t, status: final.info, phase: final.info.terminal ? 'done' : t.phase }
            : t,
        ),
      )
      .catch(() => {
        // A polling failure is non-fatal — the anchor's own window still works and
        // the user can watch the result there; we just stop reflecting status.
      });
    return () => {
      cancelled = true;
    };
    // Re-run only when a new interactive session opens — not on every status tick
    // (which also mutates `transfer`), which would restart the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfer?.id, transfer?.phase, info]);

  const backToAnchors = () => {
    setSelected(null);
    setInfo(null);
    setSupport(null);
    setError(null);
    setTransfer(null);
  };

  // Authenticate (SEP-10, signing only) then open the anchor's SEP-24 interactive
  // deposit/withdraw window. The only thing signed is the auth challenge, which
  // `authenticateSep10` validates against the anchor's SIGNING_KEY before signing.
  async function startTransfer(asset: string, direction: TransferKind) {
    if (!selected || !info?.transferServerSep24 || !info.webAuthEndpoint || !info.signingKey) {
      setTransfer({
        asset,
        direction,
        phase: 'error',
        error: 'This anchor isn’t set up for interactive transfers (missing SEP-10 auth or transfer server).',
      });
      return;
    }
    setTransfer({ asset, direction, phase: 'authing' });
    try {
      const jwt = await authenticateSep10({
        webAuthEndpoint: info.webAuthEndpoint,
        signingKey: info.signingKey,
        homeDomain: selected.homeDomain,
        webAuthDomain: webAuthDomainFor(info.webAuthEndpoint, selected.homeDomain),
        account: address,
        networkPassphrase: network.passphrase,
        signChallenge: async (xdr, passphrase) => {
          const res = await sendMessage({ type: 'SIGN_ONLY', xdr, networkPassphrase: passphrase });
          if (!res.ok) {
            throw new Error(
              res.code === 'LOCKED'
                ? 'Your wallet is locked. Reopen it, unlock, and try again.'
                : res.error,
            );
          }
          return res.data.signedXdr;
        },
      });
      jwtRef.current = jwt;
      const { id, url } = await startInteractive(info.transferServerSep24, {
        kind: direction,
        assetCode: asset,
        account: address,
        jwt,
      });
      setTransfer({ asset, direction, phase: 'interactive', url, id });
    } catch (e) {
      setTransfer({
        asset,
        direction,
        phase: 'error',
        error: e instanceof Error ? e.message : 'Couldn’t start the transfer.',
      });
    }
  }

  // --- Active transfer: authenticating, interactive window, or error ---
  if (transfer) {
    const verb = transfer.direction === 'deposit' ? 'Cash in' : 'Cash out';
    const title = `${verb} — ${displayCode(transfer.asset)}`;

    if (transfer.phase === 'error') {
      return (
        <div className="flex h-full flex-col bg-background">
          <ScreenHeader title={title} onBack={() => setTransfer(null)} />
          <main className="no-scrollbar flex-1 overflow-y-auto px-4 pb-6">
            <Card className="mt-2 space-y-3 p-4">
              <p role="alert" className="text-body-md text-error">
                {transfer.error}
              </p>
              <Button variant="secondary" fullWidth onClick={() => setTransfer(null)}>
                Back
              </Button>
            </Card>
          </main>
        </div>
      );
    }

    if (transfer.phase === 'authing') {
      return (
        <div className="flex h-full flex-col bg-background">
          <ScreenHeader title={title} onBack={() => setTransfer(null)} />
          <main className="no-scrollbar flex-1 overflow-y-auto px-4 pb-6">
            <div className="flex flex-col items-center gap-3 py-12 text-on-surface-variant">
              <Icon name="progress_activity" size={32} className="animate-spin text-primary-container" />
              <span className="text-label-md">Verifying with {selected?.name}…</span>
              <span className="max-w-xs text-center text-label-sm">
                Signing a one-time authentication challenge (never submitted on-chain).
              </span>
            </div>
          </main>
        </div>
      );
    }

    // interactive | done — host the anchor's window with a status strip below it.
    if (transfer.url) {
      return (
        <SandboxedFrame
          title={title}
          origin={selected?.name ?? 'Anchor'}
          src={transfer.url}
          onClose={() => setTransfer(null)}
          footer={<StatusStrip transfer={transfer} onDone={() => setTransfer(null)} />}
        />
      );
    }
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
                        onClick={() => startTransfer(s.assetCode, 'deposit')}
                      />
                      <DirectionButton
                        label="Cash out"
                        icon="north_east"
                        enabled={s.canWithdraw}
                        limits={s.withdraw ? formatTransferLimits(s.withdraw) : null}
                        onClick={() => startTransfer(s.assetCode, 'withdraw')}
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

// The status strip shown below the anchor's interactive window while polling.
function StatusStrip({ transfer, onDone }: { transfer: TransferState; onDone: () => void }) {
  const status = transfer.status;
  const done = transfer.phase === 'done';
  const icon =
    status?.kind === 'done'
      ? { name: 'check_circle', className: 'text-tertiary-container' }
      : status?.kind === 'error'
        ? { name: 'error', className: 'text-error' }
        : status?.kind === 'action-needed'
          ? { name: 'touch_app', className: 'text-primary-container' }
          : { name: 'progress_activity', className: 'animate-spin text-on-surface-variant' };
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-t border-outline-variant/40 bg-surface-container px-4 py-3">
      <Icon name={icon.name} size={18} className={icon.className} />
      <span className="min-w-0 flex-1 text-label-md text-on-surface">
        {status?.label ?? 'Complete the transfer in the window above…'}
      </span>
      {done && (
        <Button className="shrink-0 px-4 py-2" onClick={onDone}>
          Done
        </Button>
      )}
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
