import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

interface Props {
  /** Idle label, e.g. "Hold to Sign Anyway". */
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  /** Hold duration before firing, ms. */
  holdMs?: number;
  /** High-risk (destructive) styling. */
  danger?: boolean;
  /** Width/layout class from the caller (e.g. "w-full" or "flex-1"). */
  className?: string;
}

// Press-and-hold confirmation for high-risk actions on touch (mobile). Holding
// the button fills a progress track and fires `onConfirm` exactly once at the
// end — preserving the "can't be an accidental tap" property of the typed-
// CONFIRM gate without summoning the on-screen keyboard. Releasing early resets
// without firing. (Touch-first by design; the extension build keeps the typed-
// CONFIRM gate, which remains the keyboard-accessible path.)
export function HoldToConfirm({ label, onConfirm, disabled, holdMs = 1200, danger, className = 'w-full' }: Props) {
  const [progress, setProgress] = useState(0); // 0..1
  const raf = useRef<number | null>(null);
  const startedAt = useRef(0);
  const fired = useRef(false);

  function cancel() {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (!fired.current) setProgress(0);
  }

  function begin() {
    if (disabled) return;
    fired.current = false;
    startedAt.current = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - startedAt.current) / holdMs);
      setProgress(p);
      if (p >= 1) {
        fired.current = true;
        raf.current = null;
        onConfirm();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  // Clean up a pending frame if unmounted mid-hold.
  useEffect(() => () => void (raf.current !== null && cancelAnimationFrame(raf.current)), []);

  const holding = progress > 0 && progress < 1;

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`${label} (press and hold to confirm)`}
      className={`relative select-none touch-none overflow-hidden rounded-full px-4 py-2.5 text-label-md font-semibold active:scale-95 disabled:opacity-50 ${
        danger ? 'border border-error/50 text-error' : 'bg-primary-container text-on-primary-container shadow-primary'
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 ${danger ? 'bg-error/15' : 'bg-black/15'}`}
        style={{ width: `${progress * 100}%` }}
      />
      <span className="relative flex items-center justify-center gap-1.5">
        <Icon name="touch_app" size={16} />
        {holding ? 'Keep holding…' : label}
      </span>
    </button>
  );
}
