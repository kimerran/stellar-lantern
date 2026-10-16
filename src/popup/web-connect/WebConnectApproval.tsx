import { useCallback, useEffect, useRef, useState } from 'react';
import { sendMessage, type WebConnectPending } from '@shared/messages';
import { listedApp } from '@core/webconnect/trust';
import { truncateAddress } from '@shared/format';
import { Icon } from '../components/Icon';

// Web connect (#249/#251): Lantern's approval window (index.html?approve=1).
//
// The background queues each request that needs the user and opens this
// window; it shows one request at a time (WC_NEXT) and sends the decision
// (WC_DECIDE). Closing the window rejects the request on screen. The window
// asks again every second: that picks up the next request, and keeps the
// background worker alive while the user reads.
//
// The page can't draw on, frame or script this window. Approve is disabled
// for a moment after the window gets focus, so a click aimed at the page
// can't land on it (spec: docs/superpowers/specs/2026-10-16-web-connect-
// threat-model.md, threat 3).

export const FOCUS_DELAY_MS = 600;
const POLL_MS = 1000;

export function WebConnectApproval({ noWallet = false }: { noWallet?: boolean }) {
  const [pending, setPending] = useState<WebConnectPending | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armedAt, setArmedAt] = useState(() => Date.now() + FOCUS_DELAY_MS);
  const [now, setNow] = useState(() => Date.now());
  const entryRef = useRef<string | null>(null);

  const poll = useCallback(async () => {
    const res = await sendMessage({ type: 'WC_NEXT' });
    if (!res.ok) return;
    if (res.data === null) {
      window.close();
      return;
    }
    if (res.data.entryId !== entryRef.current) {
      entryRef.current = res.data.entryId;
      setError(null);
      setArmedAt(Date.now() + FOCUS_DELAY_MS);
    }
    setPending(res.data);
  }, []);

  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  // Re-arm the delay whenever the window comes back into focus.
  useEffect(() => {
    const rearm = () => setArmedAt(Date.now() + FOCUS_DELAY_MS);
    window.addEventListener('focus', rearm);
    return () => window.removeEventListener('focus', rearm);
  }, []);
  useEffect(() => {
    if (now >= armedAt) return;
    const t = setTimeout(() => setNow(Date.now()), armedAt - now + 10);
    return () => clearTimeout(t);
  }, [armedAt, now]);

  async function decide(approve: boolean) {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const res = await sendMessage({ type: 'WC_DECIDE', entryId: pending.entryId, approve });
    setBusy(false);
    if (!res.ok) setError(res.error);
    await poll();
  }

  if (pending === undefined) return <div className="h-full bg-background" />;
  if (pending === null) return <div className="h-full bg-background" />;

  const listed = listedApp(pending.origin);
  const armed = now >= armedAt;

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="space-y-2 border-b border-outline-variant/30 p-4">
        <div className="flex items-center gap-2">
          <Icon name="public" size={20} className="shrink-0 text-on-surface-variant" />
          <span
            className="min-w-0 break-all font-mono text-label-md text-on-surface"
            title={pending.origin}
          >
            {pending.origin}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          {listed ? (
            <span className="rounded-full bg-tertiary-container/20 px-2 py-0.5 text-label-sm text-tertiary">
              Listed in Lantern · {listed.name}
            </span>
          ) : (
            <span className="rounded-full bg-error/10 px-2 py-0.5 text-label-sm text-error">
              Unverified site
            </span>
          )}
          {pending.pending > 1 && (
            <span className="text-label-sm text-on-surface-variant">
              {pending.pending} requests waiting
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 space-y-3 overflow-y-auto p-4">
        {noWallet || !pending.address ? (
          <p className="text-body-md text-on-surface">
            This site asked to connect, but Lantern has no wallet yet. Set one up first, then try
            again from the site.
          </p>
        ) : pending.kind === 'connect' ? (
          <>
            <h1 className="text-title-md text-on-surface">Connect this site to Lantern?</h1>
            <div className="rounded-xl bg-surface-container p-3 text-label-md text-on-surface">
              <p>
                Account <span className="font-mono">{truncateAddress(pending.address, 6, 6)}</span>{' '}
                · {pending.network === 'PUBLIC' ? 'Mainnet' : 'Testnet'}
              </p>
            </div>
            <ul className="space-y-1.5 text-label-md text-on-surface">
              <li className="flex gap-2">
                <Icon name="visibility" size={18} className="shrink-0 text-on-surface-variant" />
                It will see your address and which network Lantern is on.
              </li>
              <li className="flex gap-2">
                <Icon name="draw" size={18} className="shrink-0 text-on-surface-variant" />
                It can ask you to sign. Lantern shows every request here first, and you decide each
                one.
              </li>
              <li className="flex gap-2">
                <Icon name="block" size={18} className="shrink-0 text-on-surface-variant" />
                It can’t move funds or see your recovery phrase.
              </li>
            </ul>
            <p className="text-label-sm text-on-surface-variant">
              Only connect sites you trust. You can disconnect it any time in Settings, under
              Connected sites.
            </p>
          </>
        ) : (
          <p className="text-body-md text-on-surface">
            This version of Lantern can’t handle that request yet.
          </p>
        )}
        {error && <p className="text-center text-label-md text-error">{error}</p>}
      </main>

      <footer className="flex gap-2 border-t border-outline-variant/30 p-4">
        <button
          onClick={() => void decide(false)}
          disabled={busy}
          className="flex-1 rounded-full border border-outline px-4 py-2.5 text-label-md font-semibold text-on-surface-variant active:scale-95 disabled:opacity-50"
        >
          Reject
        </button>
        {pending.kind === 'connect' && pending.address && !noWallet && (
          <button
            onClick={() => void decide(true)}
            disabled={busy || !armed}
            className="flex-1 rounded-full bg-primary-container px-4 py-2.5 text-label-md font-semibold text-on-primary-container shadow-primary active:scale-95 disabled:opacity-50"
          >
            Connect
          </button>
        )}
      </footer>
    </div>
  );
}
