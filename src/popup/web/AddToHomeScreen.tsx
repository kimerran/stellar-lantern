import { useState } from 'react';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { WarningCallout } from '../components/WarningCallout';

// Home Screen first, on iOS (#238). Shown before onboarding in a browser tab:
// WebKit deletes a site's storage after 7 days without a visit, and a Home
// Screen app is exempt. Continuing in the browser is allowed, deliberately.
export function AddToHomeScreen({ onContinueAnyway }: { onContinueAnyway: () => void }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="grid-bg flex h-full flex-col overflow-y-auto no-scrollbar bg-background px-5 py-6">
      <div className="mb-5">
        <h2 className="text-title-md text-on-surface">Add Lantern to your Home Screen</h2>
        <p className="mt-1 text-label-md text-on-surface-variant">
          So your wallet isn’t erased after 7 days. Safari clears a website’s saved data when you
          don’t visit it for a week. Apps on your Home Screen are kept.
        </p>
      </div>

      <ol className="space-y-3">
        <Step n={1} icon="ios_share">
          Tap <strong className="text-on-surface">Share</strong> in Safari’s toolbar.
        </Step>
        <Step n={2} icon="add_box">
          Choose <strong className="text-on-surface">Add to Home Screen</strong>, then{' '}
          <strong className="text-on-surface">Add</strong>.
        </Step>
        <Step n={3} icon="home">
          Open <strong className="text-on-surface">Lantern</strong> from your Home Screen and create
          your wallet there.
        </Step>
      </ol>

      <div className="mt-auto space-y-3 pt-5">
        {confirming ? (
          <>
            <WarningCallout>
              In a Safari tab, your wallet can be erased if you don’t open it for 7 days. You’d need
              your recovery phrase to get it back.
            </WarningCallout>
            <Button fullWidth variant="secondary" onClick={onContinueAnyway}>
              I understand, continue in Safari
            </Button>
          </>
        ) : (
          <Button fullWidth variant="secondary" onClick={() => setConfirming(true)}>
            Continue in Safari anyway
          </Button>
        )}
      </div>
    </div>
  );
}

function Step({ n, icon, children }: { n: number; icon: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 rounded-lg bg-surface-container-highest px-3 py-3">
      <span className="text-label-sm text-outline">{n}.</span>
      <Icon name={icon} size={22} className="shrink-0 text-primary-container" />
      <span className="text-body-md text-on-surface-variant">{children}</span>
    </li>
  );
}
