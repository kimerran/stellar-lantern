import { useEffect, useState } from 'react';
import {
  currentInstallEnv,
  installPrompt,
  needsHomeScreenStep,
  onInstallPromptChange,
  promptInstall,
} from '@shared/web/install';
import { Icon } from '../components/Icon';
import { Onboarding } from '../screens/Onboarding';
import { AddToHomeScreen } from './AddToHomeScreen';

// Onboarding in the web app (#238). On iOS in a browser tab, the Home Screen
// step comes first. Elsewhere, the browser's own install prompt is offered
// when it has one, never blocking.
export function WebOnboarding({ onDone }: { onDone: () => void }) {
  const [continued, setContinued] = useState(false);
  const [canPrompt, setCanPrompt] = useState(() => installPrompt() !== null);
  useEffect(() => onInstallPromptChange(() => setCanPrompt(installPrompt() !== null)), []);

  if (!continued && needsHomeScreenStep(currentInstallEnv())) {
    return <AddToHomeScreen onContinueAnyway={() => setContinued(true)} />;
  }

  return (
    <div className="flex h-full flex-col">
      {canPrompt && (
        <button
          onClick={() => void promptInstall()}
          className="flex items-center gap-2 bg-surface-container-highest px-4 py-2 text-label-md text-on-surface"
        >
          <Icon name="install_mobile" size={18} className="text-primary-container" />
          Install Lantern as an app
        </button>
      )}
      <div className="flex-1 overflow-hidden">
        <Onboarding onDone={onDone} />
      </div>
    </div>
  );
}
