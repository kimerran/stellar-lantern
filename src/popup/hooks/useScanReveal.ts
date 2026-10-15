import { useEffect, useRef, useState } from 'react';
import type { ScanVerdict } from '@core/scan';

// The review screens reveal the scan verdict after a short, latency-shaped
// delay so it reads as "checked just now" (low risk resolves fast). That reveal
// belongs to a REVIEW, not to a verdict object: the re-check before submit
// (#121) hands back a fresh verdict for the same transaction, and replaying the
// reveal then collapsed the review for up to 600 ms (verdict, report card and
// CONFIRM box hidden), which threw the scroll position to the top and back.
//
// `key` identifies the review: the WalletScanInput built for it, which a
// re-check reuses and a new review replaces (even for an identical XDR). The
// timer is cleared only on unmount, so a verdict update mid-reveal can't strand
// `scanning` at true.
export function useScanReveal(active: boolean, verdict: ScanVerdict | null, key: unknown): boolean {
  const [scanning, setScanning] = useState(false);
  const revealedFor = useRef<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!active || !verdict || key == null || revealedFor.current === key) return;
    revealedFor.current = key;
    setScanning(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setScanning(false), Math.min(verdict.latencyMs, 600));
  }, [active, verdict, key]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return scanning;
}
