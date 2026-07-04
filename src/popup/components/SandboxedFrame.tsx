import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

// A sandboxed remote-page overlay: chrome bar + opaque-origin iframe + a
// framing-blocked fallback. Extracted from the mini-app Browser (Apps.tsx) so a
// third-party page (e.g. an anchor's SEP-24 interactive deposit/withdraw window,
// #24) can be hosted the same way — WITHOUT the mini-app wallet bridge. There is
// deliberately no `postMessage` listener here: a regulated anchor's hosted page
// has no business talking to the wallet connect/sign bridge, so this surface
// can't be prompted to. Callers layer their own bottom sheet via `footer`.
//
// Remote sites that send X-Frame-Options / CSP frame-ancestors can't be embedded
// in any iframe. We can't read their headers (no host permission, by design), so
// we detect the block heuristically: keep an overlay until a real cross-origin
// load is confirmed, otherwise show a clean "open in new tab" card.
type Phase = 'loading' | 'shown' | 'blocked';

export function SandboxedFrame({
  title,
  origin,
  src,
  onClose,
  footer,
}: {
  title: string;
  origin: string;
  src: string;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // If a remote frame never reports a load within the window, the site blocked
  // it before navigation committed (common with frame-ancestors 'none').
  useEffect(() => {
    setPhase('loading');
    timer.current = setTimeout(() => setPhase((p) => (p === 'loading' ? 'blocked' : p)), 4000);
    return () => clearTimeout(timer.current);
  }, [src, reloadKey]);

  // A load event fired — but it may be the blocked frame at about:blank. Treat a
  // readable about:blank as blocked; a cross-origin document (reading location
  // throws) means it really loaded.
  function onFrameLoad() {
    clearTimeout(timer.current);
    try {
      const href = frameRef.current?.contentWindow?.location?.href;
      setPhase(href === 'about:blank' ? 'blocked' : 'shown');
    } catch {
      setPhase('shown'); // cross-origin → the page committed
    }
  }

  const reload = () => setReloadKey((k) => k + 1);

  return (
    // Full-viewport overlay so the iframe gets a real height. Safe-area insets on
    // the box itself (Android edge-to-edge) — see the Browser overlay note.
    <div
      className="fixed z-50 flex flex-col bg-background"
      style={{
        top: 'env(safe-area-inset-top)',
        bottom: 'env(safe-area-inset-bottom)',
        left: 'env(safe-area-inset-left)',
        right: 'env(safe-area-inset-right)',
      }}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 bg-surface-container-low px-2">
        <button
          onClick={onClose}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface active:scale-95"
          aria-label="Close"
        >
          <Icon name="arrow_back" size={20} />
        </button>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-title-sm leading-tight text-on-surface">{title}</span>
          <span className="block truncate text-label-sm leading-tight text-on-surface-variant">{origin}</span>
        </span>
        <button
          onClick={reload}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface active:scale-95"
          aria-label="Reload"
        >
          <Icon name="refresh" size={18} />
        </button>
      </header>

      {phase === 'shown' && (
        <button
          onClick={() => window.open(src, '_blank', 'noopener')}
          className="flex shrink-0 items-center justify-center gap-1 bg-surface-container-high py-1.5 text-label-sm text-on-surface-variant hover:text-on-surface"
        >
          <Icon name="open_in_new" size={13} /> Not loading right? Open in a new tab
        </button>
      )}

      <div className="relative flex-1 overflow-hidden bg-white">
        <iframe
          ref={frameRef}
          key={`${src}#${reloadKey}`}
          src={src}
          title={title}
          sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
          className="h-full w-full border-0"
          onLoad={onFrameLoad}
        />

        {phase === 'loading' && (
          <div className="absolute inset-0 grid place-items-center bg-background">
            <Icon name="progress_activity" size={28} className="animate-spin text-on-surface-variant" />
          </div>
        )}

        {phase === 'blocked' && (
          <div className="absolute inset-0 grid place-items-center bg-background px-6 text-center">
            <div className="space-y-2">
              <Icon name="block" size={36} className="text-on-surface-variant" />
              <p className="text-title-sm text-on-surface">This page can’t be embedded</p>
              <p className="text-label-md text-on-surface-variant">
                {origin} blocks loading inside another app (a common anti-clickjacking protection).
              </p>
              <div className="flex flex-col items-center gap-1.5 pt-1">
                <button
                  onClick={() => window.open(src, '_blank', 'noopener')}
                  className="text-label-md text-primary hover:text-primary-container"
                >
                  Open in a new tab →
                </button>
                <button onClick={reload} className="text-label-sm text-on-surface-variant hover:text-on-surface">
                  Try again
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {footer}
    </div>
  );
}
