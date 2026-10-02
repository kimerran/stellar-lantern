import { useEffect, useState } from 'react';
import { persistedState, requestPersistentStorage, type PersistState } from '@shared/web/persist';
import { currentInstallEnv, isIos, isInstalled } from '@shared/web/install';
import { Icon } from '../components/Icon';

// Settings → Storage, web app only (#238). Whether this browser has promised to
// keep the wallet's data. When it hasn't, the reminder stays visible.
export function StorageStatus() {
  const [state, setState] = useState<PersistState | null>(null);
  useEffect(() => {
    void persistedState().then(setState);
  }, []);
  if (!state) return null;

  const env = currentInstallEnv();
  const iosTab = isIos(env) && !isInstalled(env);
  const kept = state === 'persisted' && !iosTab;

  return (
    <div className="flex min-h-[52px] items-start gap-3 px-4 py-3">
      <Icon
        name={kept ? 'verified_user' : 'warning'}
        size={22}
        className={`shrink-0 ${kept ? 'text-on-surface-variant' : 'text-error'}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-body-md text-on-surface">
          {kept ? 'Kept on this device' : 'This browser may erase your wallet'}
        </span>
        <span className="block text-label-md text-on-surface-variant">
          {kept
            ? 'Your encrypted wallet is stored in this browser. Keep your recovery phrase safe too.'
            : iosTab
              ? 'Safari erases a website’s data after 7 days without a visit. Add Lantern to your Home Screen, and keep your recovery phrase safe.'
              : 'Your browser hasn’t agreed to keep Lantern’s data, so it may clear it to free up space. Keep your recovery phrase safe.'}
        </span>
        {!kept && state !== 'unsupported' && (
          <button
            onClick={() => void requestPersistentStorage().then(setState)}
            className="mt-1 text-label-md text-primary hover:underline"
          >
            Ask the browser again
          </button>
        )}
      </span>
    </div>
  );
}
