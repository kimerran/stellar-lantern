// Passkey onboarding (#53): create a seed-phrase-free smart account. No
// mnemonic is generated, displayed, or stored anywhere on this path — the
// device passkey IS the signer, and the on-chain smart account verifies its
// WebAuthn assertions. Testnet-only (friendbot pays the deploy fees).
import { useState } from 'react';
import { NETWORKS } from '@shared/constants';
import { sendMessage } from '@shared/messages';
import { setPasskeyAccount } from '@shared/storage';
import { createPasskeyAccount, type OnboardStep } from '@core/passkey/onboard';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';

interface Props {
  onBack: () => void;
  onDone: () => void;
}

const STEPS: { key: OnboardStep; label: string }[] = [
  { key: 'register', label: 'Create your passkey' },
  { key: 'fund', label: 'Prepare account funding' },
  { key: 'upload', label: 'Publish the account contract' },
  { key: 'deploy', label: 'Deploy your smart account' },
];

export function PasskeyOnboarding({ onBack, onDone }: Props) {
  const [progress, setProgress] = useState<OnboardStep | 'done' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null && progress !== 'done';

  async function create() {
    setError(null);
    setProgress('register');
    const network = NETWORKS.TESTNET;
    const res = await createPasskeyAccount({
      network,
      rpId: window.location.hostname,
      userName: 'Lantern',
      onProgress: setProgress,
      submit: async (signedXdr) => {
        const r = await sendMessage({
          type: 'SUBMIT_ONLY',
          xdr: signedXdr,
          networkPassphrase: network.passphrase,
          horizonUrl: network.horizonUrl,
        });
        if (!r.ok) throw new Error(r.error);
        return { hash: r.data.hash };
      },
    });
    if (!res.ok) {
      setProgress(null);
      setError(res.error);
      return;
    }
    await setPasskeyAccount(res.record);
    setProgress('done');
    onDone();
  }

  const reachedIndex =
    progress === 'done' ? STEPS.length : STEPS.findIndex((s) => s.key === progress);

  return (
    <div className="flex h-full flex-col">
      <button
        onClick={onBack}
        disabled={busy}
        className="flex items-center gap-1 text-label-md text-on-surface-variant hover:text-on-surface disabled:opacity-40"
      >
        <Icon name="arrow_back" size={18} /> Back
      </button>

      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary-container/15">
          <Icon name="fingerprint" filled size={36} className="text-primary-container" />
        </div>
        <h2 className="text-title-md text-on-surface">No seed phrase. Just you.</h2>
        <p className="mt-2 max-w-[280px] text-body-md text-on-surface-variant">
          Your device passkey becomes the account's signing key — a Stellar smart account verifies
          it on-chain. Nothing to write down, nothing to lose.
        </p>
        <p className="mt-2 text-label-sm uppercase tracking-wide text-on-surface-variant">
          Testnet · experimental
        </p>

        {progress !== null && (
          <ul className="mt-6 w-full max-w-[280px] space-y-2 text-left" aria-live="polite">
            {STEPS.map((s, i) => {
              const state = i < reachedIndex || progress === 'done' ? 'done' : i === reachedIndex ? 'active' : 'todo';
              return (
                <li key={s.key} className="flex items-center gap-2 text-label-md">
                  {state === 'done' ? (
                    <Icon name="check_circle" filled size={18} className="text-primary-container" />
                  ) : state === 'active' ? (
                    <Icon name="progress_activity" size={18} className="animate-spin text-primary-container" />
                  ) : (
                    <Icon name="circle" size={18} className="text-outline" />
                  )}
                  <span className={state === 'todo' ? 'text-on-surface-variant' : 'text-on-surface'}>
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <p role="alert" className="mt-4 text-label-md text-error">
            {error}
          </p>
        )}
      </div>

      <Button fullWidth onClick={create} loading={busy} trailingIcon="fingerprint">
        {error ? 'Try Again' : 'Create with Passkey'}
      </Button>
    </div>
  );
}
