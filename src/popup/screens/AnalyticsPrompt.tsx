import { CONSENT_COPY } from '@core/telemetry';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';

// The one-time analytics prompt (#86): shown once after onboarding has
// produced a wallet, never before, and never blocking — it is a card
// anchored above the bottom nav with no backdrop and no modal semantics, so
// every wallet control stays reachable while it is up. Either button
// dismisses it for good. Rendered only under __FEATURE_TELEMETRY__.
export function AnalyticsPrompt({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <aside
      aria-labelledby="analytics-prompt-title"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center px-4"
    >
      <div className="pointer-events-auto w-full max-w-md rounded-3xl border border-outline-variant/40 bg-surface-container p-5 shadow-xl">
        <div className="mb-2 flex items-center gap-3">
          <Icon name="insights" size={22} className="text-primary" />
          <h2 id="analytics-prompt-title" className="text-title-md text-on-surface">
            {CONSENT_COPY.title}?
          </h2>
        </div>
        <p className="text-body-md text-on-surface-variant">{CONSENT_COPY.summary}</p>
        <p className="mt-2 text-label-md font-medium text-on-surface">We never collect</p>
        <ul className="list-disc pl-5 text-label-md text-on-surface-variant">
          {CONSENT_COPY.neverCollected.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-2 text-label-md text-on-surface-variant">
          You can change this any time in Settings → Privacy.
        </p>
        <div className="mt-3 flex gap-2">
          <Button fullWidth variant="secondary" onClick={onDecline}>
            {CONSENT_COPY.promptDecline}
          </Button>
          <Button fullWidth onClick={onAccept}>
            {CONSENT_COPY.promptAccept}
          </Button>
        </div>
      </div>
    </aside>
  );
}
