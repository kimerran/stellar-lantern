import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Icon } from './Icon';

type ShowToast = (message: string) => void;

const ToastContext = createContext<ShowToast>(() => {});

/**
 * Show a brief, auto-dismissing confirmation toast (e.g. "Address copied").
 * Returns a no-op if used outside a {@link ToastProvider}, so callers never
 * need to guard.
 */
export function useToast(): ShowToast {
  return useContext(ToastContext);
}

interface ToastState {
  id: number;
  message: string;
}

const VISIBLE_MS = 1600;

// App-wide toast host. A single toast is shown at a time; a newer one replaces
// the current one and restarts the timer. Kept dependency-free (no portal) —
// it renders as the last child of the app root and floats above via z-index.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const counter = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<ShowToast>((message) => {
    counter.current += 1;
    setToast({ id: counter.current, message });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), VISIBLE_MS);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {/* key restarts the entrance animation when the message changes */}
          <div
            key={toast.id}
            role="status"
            aria-live="polite"
            className="flex items-center gap-1.5 rounded-full bg-surface-container-high px-3.5 py-2 text-label-md text-on-surface shadow-lg animate-toast-in"
          >
            <Icon name="check_circle" filled size={16} className="text-primary-container" />
            {toast.message}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
