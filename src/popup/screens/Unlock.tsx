import { useEffect, useRef, useState } from 'react';
import { sendMessage } from '@shared/messages';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Icon } from '../components/Icon';

interface Props {
  onUnlocked: () => void;
  onReset: () => void;
  /** Biometric unlock has been enrolled on this device (from GET_STATUS). */
  biometricEnabled?: boolean;
  /** The platform offers a biometric-gated store (from GET_STATUS). */
  biometricAvailable?: boolean;
}

export function Unlock({ onUnlocked, onReset, biometricEnabled = false, biometricAvailable = false }: Props) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  // Offer to turn biometric unlock on after this password unlock (shown only when
  // the device supports it and it isn't already enrolled).
  const [enableBio, setEnableBio] = useState(true);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioError, setBioError] = useState<string | null>(null);

  async function tryBiometric() {
    setBioError(null);
    setBioBusy(true);
    const res = await sendMessage({ type: 'BIOMETRIC_UNLOCK' });
    setBioBusy(false);
    if (res.ok) {
      onUnlocked();
    } else if (res.code !== 'BIOMETRIC_CANCELLED') {
      // A cancel is silent — the user just types their password instead.
      setBioError(res.error);
    }
  }

  // Auto-present the biometric prompt on open when it's enrolled. Runs once.
  const attempted = useRef(false);
  useEffect(() => {
    if (biometricEnabled && !attempted.current) {
      attempted.current = true;
      void tryBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometricEnabled]);

  async function unlock() {
    setBusy(true);
    setError(null);
    const res = await sendMessage({ type: 'UNLOCK', password });
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      return;
    }
    // Enrol biometrics with the password we just verified, if opted in. Best
    // effort — a failure here never blocks the (already successful) unlock.
    if (biometricAvailable && !biometricEnabled && enableBio) {
      try {
        await sendMessage({ type: 'ENABLE_BIOMETRIC', password });
      } catch {
        /* leave biometrics off; the user can enable later */
      }
    }
    setBusy(false);
    onUnlocked();
  }

  async function reset() {
    await sendMessage({ type: 'RESET_WALLET' });
    onReset();
  }

  const showEnableOptIn = biometricAvailable && !biometricEnabled;

  return (
    <div className="grid-bg flex h-full flex-col bg-background px-5 py-6">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-6 h-24 w-24 overflow-hidden rounded-[26px] shadow-[0_0_28px_rgba(255,193,7,0.18)]">
          {/* Scaled slightly to crop the logo's white margin onto the navy field. */}
          <img src="logo.jpg" alt="Lantern" className="h-full w-full scale-[1.12] object-cover" />
        </div>
        <h1 className="text-title-md text-on-surface">Welcome back</h1>
        <p className="mt-1 text-label-md text-on-surface-variant">Enter your password to unlock.</p>

        {biometricEnabled && (
          <div className="mt-5 w-full">
            <Button
              variant="secondary"
              fullWidth
              loading={bioBusy}
              onClick={tryBiometric}
              leadingIcon="fingerprint"
            >
              Unlock with biometrics
            </Button>
            {bioError && <p className="mt-2 text-label-sm text-error">{bioError}</p>}
            <div className="mt-4 flex items-center gap-3 text-label-sm text-on-surface-variant">
              <span className="h-px flex-1 bg-outline-variant/40" />
              or use your password
              <span className="h-px flex-1 bg-outline-variant/40" />
            </div>
          </div>
        )}

        <form
          className="mt-4 w-full"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) void unlock();
          }}
        >
          <Input
            label="Password"
            type="password"
            autoFocus={!biometricEnabled}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error ?? undefined}
          />

          {showEnableOptIn && (
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-left text-label-md text-on-surface-variant">
              <input
                type="checkbox"
                checked={enableBio}
                onChange={(e) => setEnableBio(e.target.checked)}
                className="h-4 w-4 accent-primary-container"
              />
              <Icon name="fingerprint" size={16} className="text-primary-container" />
              Enable biometric unlock on this device
            </label>
          )}

          <div className="mt-5">
            <Button type="submit" fullWidth loading={busy} disabled={!password} trailingIcon="lock_open">
              Unlock
            </Button>
          </div>
        </form>
      </div>

      <div className="text-center">
        {!confirmReset ? (
          <button onClick={() => setConfirmReset(true)} className="text-label-md text-on-surface-variant hover:text-on-surface">
            Forgot password? Reset wallet
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-label-sm text-error">
              Resetting erases this wallet. You can only restore it with your recovery phrase.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" fullWidth onClick={() => setConfirmReset(false)}>
                Cancel
              </Button>
              <Button variant="secondary" fullWidth onClick={reset} className="!text-error !border-error/40">
                Reset
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
