import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '@core/telemetry';
import type { ScanVerdict } from '@core/scan';
import type { WalletScanInput } from '@core/scan/wallet';
import {
  decideRecheck,
  recheckTelemetry,
  recheckTx,
  type RecheckDecision,
  type RecheckState,
} from '@core/scan/recheck';

// The re-check before submit (#121), as the one hook every confirm handler
// calls between the user's gesture and SIGN_AND_SUBMIT:
//
//   const rc = await recheck.guard(verdict, scanInput);
//   if (!rc.proceed) { setVerdict(rc.verdict); setConfirmText(''); return; }
//   setVerdict(rc.verdict);   // the receipt matches what was signed
//   …sign…
//
// The "couldn't re-check" branch needs an explicit second confirm: the first
// call returns `proceed: false` with `state.kind === 'failed'`. The next call
// on the SAME xdr re-runs the re-check regardless — the RPC may well be back,
// and a fresh result is decided as normal (an escalation still aborts). Only
// if it fails AGAIN does the acknowledgement let it proceed, and never when
// the reviewed verdict was already high, which refuses every time. Any other
// xdr resets that acknowledgement — it never carries across transactions.
export function useRecheck() {
  const [state, setState] = useState<RecheckState>({ kind: 'idle' });
  const acknowledgedXdr = useRef<string | null>(null);

  const guard = useCallback(
    async (reviewed: ScanVerdict, input: WalletScanInput): Promise<RecheckDecision> => {
      const acknowledged = acknowledgedXdr.current === input.xdr;
      setState({ kind: 'checking' });
      const result = await recheckTx(reviewed, input);
      if (__FEATURE_TELEMETRY__) track.txRechecked(recheckTelemetry(result));
      const decision = decideRecheck(reviewed, result, acknowledged);
      acknowledgedXdr.current =
        decision.state.kind === 'failed' && !decision.state.refused ? input.xdr : null;
      setState(decision.state);
      return decision;
    },
    [],
  );

  const reset = useCallback(() => {
    acknowledgedXdr.current = null;
    setState({ kind: 'idle' });
  }, []);

  // Keep the confirm button on screen through a re-check (#152). The
  // <RecheckNotice> renders ABOVE the CTA, so every state it shows (checking,
  // escalated, failed, drifted) pushes the button down by the notice's height.
  // On a review already scrolled to the bottom that moves the CTA below the
  // scroll area's fold — on Android, behind the bottom nav, where the next tap
  // lands on a nav tab instead. Screens wrap their CTA in `ref={ctaRef}`; after
  // each non-idle state commits we scroll it back into view. `nearest` is a
  // no-op when it is already fully visible, so an unscrolled review never jumps.
  const ctaRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (state.kind === 'idle') return;
    ctaRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [state]);

  return { state, guard, reset, ctaRef };
}
