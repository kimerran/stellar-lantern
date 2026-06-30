import { useEffect, useRef, useState } from 'react';
import {
  MINI_APPS,
  miniAppSrc,
  normalizeUrl,
  displayOrigin,
  type MiniApp,
} from '@core/miniapps/directory';
import { BASE_FEE } from '@stellar/stellar-sdk';
import { NETWORKS, type NetworkId } from '@shared/constants';
import { formatAmount, truncateAddress } from '@shared/format';
import { sendMessage } from '@shared/messages';
import { getServer, destinationFunded } from '@core/stellar/client';
import { buildTransferXdr } from '@core/stellar/tx';
import { isValidPublicKey } from '@core/wallet/wallet';
import { scan } from '@core/scan/engine';
import type { ScanVerdict } from '@core/scan/types';
import { Icon } from '../components/Icon';
import { Card } from '../components/Card';
import { RiskCallout } from '../components/RiskCallout';
import { ScanBadge } from '../components/ScanBadge';

// In-app mini-app browser (README "Mini-app browser for Stellar dApps").
//
// Bundled apps are self-contained static pages; the URL bar is best-effort (most
// real sites refuse framing via X-Frame-Options). A read-only wallet bridge lets
// an embedded app request the public key + network via postMessage (with user
// approval) — see Browser below. Signing is not yet exposed; the "Checked by
// Lantern" chip is still visual only.

type Open =
  | { kind: 'app'; app: MiniApp; src: string; title: string; origin: string }
  | { kind: 'url'; src: string; title: string; origin: string };

// A payment a mini-app asks Lantern to make on the user's behalf (XLM only for now).
interface PaymentIntent {
  destination: string;
  amount: string;
  memo?: string;
}

export function Apps({ address, network }: { address: string; network: NetworkId }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [urlText, setUrlText] = useState('');
  const [urlError, setUrlError] = useState(false);

  function launchApp(app: MiniApp) {
    setOpen({
      kind: 'app',
      app,
      src: miniAppSrc(app, address),
      title: app.name,
      origin: 'Bundled · Lantern',
    });
  }

  function go() {
    const normalized = normalizeUrl(urlText);
    if (!normalized) {
      setUrlError(true);
      return;
    }
    setUrlError(false);
    setOpen({ kind: 'url', src: normalized, title: displayOrigin(normalized), origin: displayOrigin(normalized) });
  }

  if (open) {
    return <Browser open={open} address={address} network={network} onClose={() => setOpen(null)} />;
  }

  return (
    <div className="space-y-5 pt-1">
      {/* URL bar */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 rounded-xl border border-outline-variant bg-surface-container-high px-3 py-2 focus-within:border-primary-container focus-within:shadow-focus-amber">
          <Icon name="public" size={18} className="text-on-surface-variant" />
          <input
            value={urlText}
            onChange={(e) => {
              setUrlText(e.target.value);
              if (urlError) setUrlError(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && go()}
            inputMode="url"
            placeholder="Enter a dApp URL…"
            className="min-w-0 flex-1 bg-transparent text-body-md text-on-surface placeholder:text-outline focus:outline-none"
          />
          <button
            onClick={go}
            disabled={!urlText.trim()}
            className="shrink-0 text-on-surface-variant hover:text-on-surface disabled:opacity-30"
            aria-label="Open URL"
          >
            <Icon name="arrow_forward" size={18} />
          </button>
        </div>
        {urlError && (
          <p className="px-1 text-label-sm text-error">That doesn’t look like a web address.</p>
        )}
      </section>

      {/* Curated directory */}
      <section className="space-y-3">
        <div>
          <h3 className="text-title-md text-on-surface">Discover apps</h3>
          <p className="text-label-md text-on-surface-variant">
            Curated Stellar mini-apps that run inside Lantern. Every action is screened by the
            security layer (demo).
          </p>
        </div>

        <div className="space-y-2">
          {MINI_APPS.map((app) => (
            <Card key={app.id} onClick={() => launchApp(app)} className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-container-high text-primary-container">
                <Icon name={app.icon} size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-title-sm text-on-surface">{app.name}</span>
                  {app.verified && (
                    <Icon name="verified" filled size={14} className="text-primary-container" />
                  )}
                </span>
                <span className="block truncate text-label-md text-on-surface-variant">
                  {app.tagline}
                </span>
              </span>
              <Icon name="chevron_right" size={20} className="shrink-0 text-on-surface-variant" />
            </Card>
          ))}
        </div>

        <p className="flex items-center gap-1.5 px-1 text-label-sm text-on-surface-variant">
          <Icon name="security" size={13} /> Mini-apps run sandboxed and can’t touch your keys.
        </p>
      </section>
    </div>
  );
}

// ── Browser surface: chrome bar + sandboxed iframe + framing fallback ──
//
// Remote sites that send X-Frame-Options / CSP frame-ancestors can't be embedded
// in any iframe. We can't read their headers (no host permission, by design), so
// we detect the block heuristically: keep an overlay until we confirm a real
// cross-origin load, otherwise show a clean "open in new tab" card. Bundled apps
// are first-party and always load, so they skip all of this.
type Phase = 'loading' | 'shown' | 'blocked';

function Browser({
  open,
  address,
  network,
  onClose,
}: {
  open: Open;
  address: string;
  network: NetworkId;
  onClose: () => void;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [phase, setPhase] = useState<Phase>(open.kind === 'url' ? 'loading' : 'shown');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const isRemote = open.kind === 'url';

  // ── Wallet bridge (read-only connect) ──
  // A mini-app posts { type: 'lantern:getPublicKey' }; we reply (after the user
  // approves) with { type: 'lantern:publicKey', publicKey, network }. Only the
  // public key + network are ever shared — never secrets, never signing. We only
  // trust messages from THIS app's frame (event.source check), and post back to
  // that same frame (targetOrigin '*' is required for the opaque-origin sandbox).
  const [connectReq, setConnectReq] = useState(false);
  const granted = useRef(false);

  // A pending payment request from the dApp, prepared + scanned and awaiting the
  // user's review. The dApp sends an *intent* (destination/amount/memo) — Lantern
  // builds, scans, signs and submits, so the secret never leaves and every send
  // goes through the same security review as the wallet's own Send flow.
  const [signReq, setSignReq] = useState<{ intent: PaymentIntent; xdr: string; verdict: ScanVerdict; fee: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signErr, setSignErr] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');

  function postToApp(message: unknown) {
    frameRef.current?.contentWindow?.postMessage(message, '*');
  }
  function sendPublicKey() {
    postToApp({ type: 'lantern:publicKey', publicKey: address, network });
  }

  // Build + scan a dApp payment intent, then surface it for review.
  async function prepareSign(intent: PaymentIntent) {
    if (!isValidPublicKey(intent.destination)) {
      postToApp({ type: 'lantern:txError', error: 'Invalid destination address.' });
      return;
    }
    const amt = Number(intent.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      postToApp({ type: 'lantern:txError', error: 'Invalid amount.' });
      return;
    }
    postToApp({ type: 'lantern:signing' }); // ack so the dApp waits for review
    try {
      const cfg = NETWORKS[network];
      const server = getServer(cfg);
      const destFunded = await destinationFunded(cfg, intent.destination);
      const source = await server.loadAccount(address);
      let baseFee = BASE_FEE;
      try {
        const fetched = await server.fetchBaseFee();
        baseFee = String(Math.min(Math.max(fetched, Number(BASE_FEE)), 100_000));
      } catch {
        /* keep BASE_FEE */
      }
      const xdr = buildTransferXdr({
        sourceAccountId: address,
        sourceSequence: source.sequenceNumber(),
        networkPassphrase: cfg.passphrase,
        baseFee,
        destination: intent.destination,
        destinationFunded: destFunded,
        asset: { isNative: true },
        amount: intent.amount,
        memo: intent.memo?.trim() || undefined,
      });
      const verdict = scan({
        xdr,
        networkPassphrase: cfg.passphrase,
        context: { network, fromAddress: address, destinationFunded: destFunded, origin: open.title },
      });
      setConfirmText('');
      setSignErr(null);
      setSignReq({ intent, xdr, verdict, fee: formatAmount(String(Number(baseFee) / 1e7)) });
    } catch {
      postToApp({ type: 'lantern:txError', error: 'Could not prepare the transaction.' });
    }
  }

  useEffect(() => {
    granted.current = false; // re-prompt per opened app
    function onMessage(e: MessageEvent) {
      const win = frameRef.current?.contentWindow;
      if (!win || e.source !== win) return; // only our embedded app
      const data = e.data as { type?: string; intent?: PaymentIntent } | null;
      if (data?.type === 'lantern:getPublicKey') {
        postToApp({ type: 'lantern:connecting' }); // ack → dApp waits for approval
        if (granted.current) sendPublicKey();
        else setConnectReq(true);
      } else if (data?.type === 'lantern:signAndSubmit') {
        if (!granted.current) {
          postToApp({ type: 'lantern:txError', error: 'Connect the wallet first.' });
          return;
        }
        if (data.intent) void prepareSign(data.intent);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open.src, address, network]);

  function approveConnect() {
    granted.current = true;
    sendPublicKey();
    setConnectReq(false);
  }
  function rejectConnect() {
    postToApp({ type: 'lantern:connectRejected' });
    setConnectReq(false);
  }

  async function approveSign() {
    if (!signReq) return;
    setSubmitting(true);
    setSignErr(null);
    const cfg = NETWORKS[network];
    const res = await sendMessage({
      type: 'SIGN_AND_SUBMIT',
      xdr: signReq.xdr,
      networkPassphrase: cfg.passphrase,
      horizonUrl: cfg.horizonUrl,
    });
    setSubmitting(false);
    if (res.ok) {
      postToApp({ type: 'lantern:txResult', hash: res.data.hash });
      setSignReq(null);
    } else {
      setSignErr(res.code === 'LOCKED' ? 'Wallet locked — reopen to unlock and retry.' : res.error);
    }
  }
  function rejectSign() {
    postToApp({ type: 'lantern:txRejected' });
    setSignReq(null);
    setSignErr(null);
  }

  // If a remote frame never reports a load within the window, the site blocked
  // it before navigation committed (common with frame-ancestors 'none').
  useEffect(() => {
    if (!isRemote) return;
    setPhase('loading');
    timer.current = setTimeout(() => setPhase((p) => (p === 'loading' ? 'blocked' : p)), 4000);
    return () => clearTimeout(timer.current);
  }, [open.src, reloadKey, isRemote]);

  // A load event fired — but it may be the blocked frame sitting at about:blank,
  // or a same-origin error page. Treat a readable about:blank as blocked; a
  // cross-origin document (reading location throws) means it really loaded.
  function onFrameLoad() {
    clearTimeout(timer.current);
    if (!isRemote) return;
    try {
      const href = frameRef.current?.contentWindow?.location?.href;
      setPhase(href === 'about:blank' ? 'blocked' : 'shown');
    } catch {
      setPhase('shown'); // cross-origin → the page committed
    }
  }

  function reload() {
    setReloadKey((k) => k + 1);
  }

  return (
    // Full-viewport overlay (like the Security screen) so the iframe gets a real
    // height to fill — nested in the padded tab area, h-full collapses and the
    // iframe falls back to its default 150px.
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 bg-surface-container-low px-2">
        <button
          onClick={onClose}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface active:scale-95"
          aria-label="Back to directory"
        >
          <Icon name="arrow_back" size={20} />
        </button>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-title-sm leading-tight text-on-surface">
            {open.title}
          </span>
          <span className="block truncate text-label-sm leading-tight text-on-surface-variant">
            {open.origin}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface-container-high px-2 py-1 text-label-sm text-on-surface-variant">
          <Icon name="security" filled size={13} className="text-primary-container" />
          Checked
        </span>
        <button
          onClick={reload}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface active:scale-95"
          aria-label="Reload"
        >
          <Icon name="refresh" size={18} />
        </button>
      </header>

      {/* Escape hatch — remote sites can render blank/error even after loading. */}
      {isRemote && phase === 'shown' && (
        <button
          onClick={() => window.open(open.src, '_blank', 'noopener')}
          className="flex shrink-0 items-center justify-center gap-1 bg-surface-container-high py-1.5 text-label-sm text-on-surface-variant hover:text-on-surface"
        >
          <Icon name="open_in_new" size={13} /> Not loading right? Open in a new tab
        </button>
      )}

      <div className="relative flex-1 overflow-hidden bg-white">
        <iframe
          ref={frameRef}
          key={`${open.src}#${reloadKey}`}
          src={open.src}
          title={open.title}
          // Bundled apps are first-party extension pages (loaded same-origin so
          // their relative app.js passes script-src 'self'); only remote URLs get
          // the opaque-origin sandbox.
          sandbox={isRemote ? 'allow-scripts allow-forms allow-popups' : undefined}
          className="h-full w-full border-0"
          onLoad={onFrameLoad}
        />

        {isRemote && phase === 'loading' && (
          <div className="absolute inset-0 grid place-items-center bg-background">
            <Icon name="progress_activity" size={28} className="animate-spin text-on-surface-variant" />
          </div>
        )}

        {isRemote && phase === 'blocked' && (
          <div className="absolute inset-0 grid place-items-center bg-background px-6 text-center">
            <div className="space-y-2">
              <Icon name="block" size={36} className="text-on-surface-variant" />
              <p className="text-title-sm text-on-surface">This site can’t be embedded</p>
              <p className="text-label-md text-on-surface-variant">
                {open.origin} blocks loading inside another app (a common anti-clickjacking
                protection). Bundled mini-apps always work.
              </p>
              <div className="flex flex-col items-center gap-1.5 pt-1">
                <button
                  onClick={() => window.open(open.src, '_blank', 'noopener')}
                  className="text-label-md text-primary hover:text-primary-container"
                >
                  Open in a new tab →
                </button>
                <button
                  onClick={reload}
                  className="text-label-sm text-on-surface-variant hover:text-on-surface"
                >
                  Try again
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Connect approval — a mini-app requested the wallet's public key. */}
      {connectReq && (
        <div className="absolute inset-x-0 bottom-0 z-20 space-y-3 rounded-t-2xl border-t border-outline-variant/40 bg-surface-container p-4 shadow-layer-1">
          <div className="flex items-center gap-2">
            <Icon name="link" size={18} className="text-primary-container" />
            <span className="text-title-sm text-on-surface">
              Connect to <span className="font-semibold">{open.title}</span>?
            </span>
          </div>
          <p className="text-label-md text-on-surface-variant">
            Share your public address (<span className="font-mono">{truncateAddress(address, 4, 4)}</span>) and
            network ({network === 'PUBLIC' ? 'Mainnet' : 'Testnet'}) so it can read your balance. It cannot move
            funds — signing always needs a separate prompt, and your secret key never leaves Lantern.
          </p>
          <div className="flex gap-2">
            <button
              onClick={rejectConnect}
              className="flex-1 rounded-full border border-outline px-4 py-2.5 text-label-md font-semibold text-on-surface-variant active:scale-95"
            >
              Reject
            </button>
            <button
              onClick={approveConnect}
              className="flex-1 rounded-full bg-primary-container px-4 py-2.5 text-label-md font-semibold text-on-primary-container shadow-primary active:scale-95"
            >
              Connect
            </button>
          </div>
        </div>
      )}

      {/* Sign & submit approval — a mini-app requested a payment; reviewed by the
          same Lantern scan as the wallet's own Send flow before any signing. */}
      {signReq && (() => {
        const isHigh = signReq.verdict.action === 'block_confirm';
        const acknowledged = !isHigh || confirmText.trim().toUpperCase() === 'CONFIRM';
        return (
          <div className="absolute inset-x-0 bottom-0 z-20 max-h-[80%] space-y-3 overflow-y-auto rounded-t-2xl border-t border-outline-variant/40 bg-surface-container p-4 shadow-layer-1">
            <div className="flex items-center gap-2">
              <Icon name="draw" size={18} className="text-primary-container" />
              <span className="text-title-sm text-on-surface">
                <span className="font-semibold">{open.title}</span> wants to send
              </span>
            </div>
            <div className="rounded-xl bg-surface-container-high p-3 text-center">
              <p className={`text-headline-lg-mobile ${isHigh ? 'text-on-surface-variant' : 'text-primary glow-amber-text'}`}>
                {formatAmount(signReq.intent.amount)} XLM
              </p>
              <p className="mt-1 font-mono text-label-sm text-on-surface-variant">
                to {truncateAddress(signReq.intent.destination, 5, 5)}
              </p>
            </div>

            {signReq.verdict.action === 'allow' ? (
              <div className="flex items-center justify-between rounded-xl border border-tertiary-container/20 bg-surface-container-high p-3">
                <p className="pr-2 text-label-md text-on-surface">{signReq.verdict.explanation}</p>
                <ScanBadge risk="low" latencyMs={signReq.verdict.latencyMs} />
              </div>
            ) : (
              <RiskCallout
                risk={signReq.verdict.risk}
                reasons={signReq.verdict.reasons}
                explanation={signReq.verdict.explanation}
                whatToDo={isHigh ? 'A dApp requested this. If you didn’t expect it, reject — signing can’t be undone.' : undefined}
              />
            )}

            <div className="flex items-center justify-between text-label-sm text-on-surface-variant">
              <span>Network fee</span>
              <span>~{signReq.fee} XLM · {network === 'PUBLIC' ? 'Mainnet' : 'Testnet'}</span>
            </div>

            {isHigh && (
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type CONFIRM to allow"
                className="w-full rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 font-mono text-label-md text-on-surface placeholder:text-outline focus:border-primary-container focus:outline-none"
              />
            )}
            {signErr && <p className="text-center text-label-md text-error">{signErr}</p>}

            <div className="flex gap-2">
              <button
                onClick={rejectSign}
                disabled={submitting}
                className="flex-1 rounded-full border border-outline px-4 py-2.5 text-label-md font-semibold text-on-surface-variant active:scale-95 disabled:opacity-50"
              >
                Reject
              </button>
              <button
                onClick={approveSign}
                disabled={submitting || !acknowledged}
                className={`flex-1 rounded-full px-4 py-2.5 text-label-md font-semibold active:scale-95 disabled:opacity-50 ${
                  isHigh
                    ? 'border border-error/50 text-error'
                    : 'bg-primary-container text-on-primary-container shadow-primary'
                }`}
              >
                {submitting ? 'Sending…' : isHigh ? 'Sign anyway' : 'Approve & send'}
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
