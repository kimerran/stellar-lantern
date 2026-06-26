import { useEffect, useRef, useState } from 'react';
import {
  MINI_APPS,
  miniAppSrc,
  normalizeUrl,
  displayOrigin,
  type MiniApp,
} from '@core/miniapps/directory';
import { Icon } from '../components/Icon';
import { Card } from '../components/Card';

// In-app mini-app browser (README "Mini-app browser for Stellar dApps").
//
// MOCK: bundled apps are self-contained static pages; the URL bar is best-effort
// (most real sites refuse framing via X-Frame-Options). No real wallet bridge —
// the wallet address is passed to bundled apps as a URL param so they can look
// connected. The "Checked by Lantern" chip is visual only for now.

type Open =
  | { kind: 'app'; app: MiniApp; src: string; title: string; origin: string }
  | { kind: 'url'; src: string; title: string; origin: string };

export function Apps({ address }: { address: string }) {
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
    return <Browser open={open} onClose={() => setOpen(null)} />;
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

function Browser({ open, onClose }: { open: Open; onClose: () => void }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [phase, setPhase] = useState<Phase>(open.kind === 'url' ? 'loading' : 'shown');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const isRemote = open.kind === 'url';

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
    </div>
  );
}
