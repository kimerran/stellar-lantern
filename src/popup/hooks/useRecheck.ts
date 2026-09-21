import { useCallback, useRef, useState } from 'react';
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
// call returns `proceed: false` with `state.kind === 'failed'`; the next call
// on the SAME xdr proceeds without re-running (unless the reviewed verdict
// was already high, which refuses every time). Any other xdr resets that
// acknowledgement — it never carries across transactions.
export function useRecheck() {
  const [state, setState] = useState<RecheckState>({ kind: 'idle' });
  const acknowledgedXdr = useRef<string | null>(null);

  const guard = useCallback(
    async (reviewed: ScanVerdict, input: WalletScanInput): Promise<RecheckDecision> => {
      const acknowledged = acknowledgedXdr.current === input.xdr;
      if (acknowledged && reviewed.action !== 'block_confirm') {
        // The user saw "couldn't re-check" and confirmed anyway.
        const state: RecheckState = { kind: 'failed', failure: 'rpc', refused: false };
        setState(state);
        return { proceed: true, verdict: reviewed, state };
      }
      setState({ kind: 'checking' });
      const result = await recheckTx(reviewed, input);
      if (__FEATURE_TELEMETRY__) track.txRechecked(recheckTelemetry(result));
      const decision = decideRecheck(reviewed, result, false);
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

  return { state, guard, reset };
}
