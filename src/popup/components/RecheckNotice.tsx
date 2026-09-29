import type { RecheckState } from '@core/scan/recheck';
import { Icon } from './Icon';

// What the re-check before submit (#121) tells the user. Rendered under the
// scan result on every review screen. Honest and brief: "checking" is a
// single simulate, not a spinner that implies more; an escalation says what
// changed in plain language and that a fresh confirm is needed; a failed
// re-check says so and asks for an explicit go-ahead — or refuses.

export function RecheckNotice({ state }: { state: RecheckState }) {
  switch (state.kind) {
    case 'idle':
      return null;
    case 'checking':
      return (
        <div
          role="status"
          className="flex items-center gap-2 rounded-2xl border border-outline-variant/40 bg-surface-container p-3"
        >
          <Icon name="sync" size={16} className="animate-spin text-on-surface-variant" />
          <span className="text-label-sm text-on-surface-variant">
            Re-checking just before you sign…
          </span>
        </div>
      );
    case 'passed':
      if (!state.drift.drifted) return null;
      return (
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container p-3">
          <p className="text-label-sm font-semibold text-on-surface">Re-checked before signing</p>
          <ul className="mt-1 space-y-0.5">
            {state.drift.changes.map((c, i) => (
              <li key={i} className="text-label-sm text-on-surface-variant">
                {c.detail}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'escalated':
      return (
        <div role="alert" className="rounded-2xl border border-error/30 bg-error-container/15 p-3">
          <div className="flex items-start gap-2">
            <Icon name="gpp_bad" filled size={18} className="mt-0.5 shrink-0 text-error" />
            <div className="min-w-0 flex-1">
              <p className="text-label-md font-semibold text-error">
                Something changed while you were reviewing
              </p>
              <ul className="mt-1 space-y-0.5">
                {state.changes.map((c, i) => (
                  <li key={i} className="text-label-sm text-on-surface">
                    {c.detail}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-label-sm text-on-surface-variant">
                Nothing was signed. Read the updated check below and confirm again if you still want
                to continue.
              </p>
            </div>
          </div>
        </div>
      );
    case 'failed':
      return (
        <div
          role="alert"
          className="rounded-2xl border border-secondary/30 bg-secondary-container/10 p-3"
        >
          <div className="flex items-start gap-2">
            <Icon name="warning" filled size={18} className="mt-0.5 shrink-0 text-secondary" />
            <div className="min-w-0 flex-1">
              <p className="text-label-md font-semibold text-secondary">
                {state.failure === 'unverified'
                  ? 'Recipient still unverified'
                  : "Couldn't re-check just now"}
              </p>
              <p className="mt-0.5 text-label-sm text-on-surface">
                {state.refused
                  ? 'This transaction was already high risk and Lantern could not confirm it is still the same. It will not be signed until a re-check succeeds — try again in a moment.'
                  : state.failure === 'unverified'
                    ? "Lantern still couldn't check who this goes to against the reported-address registry, so it would be signed unverified. Confirm again to sign anyway."
                    : state.failure === 'timeout'
                    ? 'The network did not answer in time, so the check you saw may be out of date. Confirm again to sign anyway.'
                    : 'The network could not be reached, so the check you saw may be out of date. Confirm again to sign anyway.'}
              </p>
            </div>
          </div>
        </div>
      );
  }
}
