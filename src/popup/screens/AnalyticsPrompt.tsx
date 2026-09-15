import { CONSENT_COPY } from '@core/telemetry';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';

// The one-time analytics prompt (#86): shown once after onboarding has
// produced a wallet, never before, never blocking (both buttons dismiss it
// for good). Rendered only under __FEATURE_TELEMETRY__.
export function AnalyticsPrompt({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-scrim/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="analytics-prompt-title"
    >
      <div className="w-full max-w-md rounded-3xl bg-surface-container p-5 shadow-xl">
        <div className="mb-3 flex items-center gap-3">
          <Icon name="insights" size={24} className="text-primary" />
          <h2 id="analytics-prompt-title" className="text-title-md text-on-surface">
            {CONSENT_COPY.title}?
          </h2>
        </div>
        <p className="text-body-md text-on-surface-variant">{CONSENT_COPY.summary}</p>
        <p className="mt-3 text-label-md font-medium text-on-surface">We never collect</p>
        <ul className="list-disc pl-5 text-label-md text-on-surface-variant">
          {CONSENT_COPY.neverCollected.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-3 text-label-md text-on-surface-variant">
          You can change this any time in Settings → Privacy.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Button fullWidth onClick={onAccept}>
            {CONSENT_COPY.promptAccept}
          </Button>
          <Button fullWidth variant="secondary" onClick={onDecline}>
            {CONSENT_COPY.promptDecline}
          </Button>
        </div>
      </div>
    </div>
  );
}
