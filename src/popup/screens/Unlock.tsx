import { useState } from 'react';
import { sendMessage } from '@shared/messages';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Icon } from '../components/Icon';

export function Unlock({ onUnlocked, onReset }: { onUnlocked: () => void; onReset: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  async function unlock() {
    setBusy(true);
    setError(null);
    const res = await sendMessage({ type: 'UNLOCK', password });
    setBusy(false);
    if (res.ok) onUnlocked();
    else setError(res.error);
  }

  async function reset() {
    await sendMessage({ type: 'RESET_WALLET' });
    onReset();
  }

  return (
    <div className="grid-bg flex h-full flex-col bg-background px-5 py-6">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary-container/15">
          <Icon name="lightbulb" filled size={44} className="animate-subtle-glow text-primary-container" />
        </div>
        <h1 className="text-title-md text-on-surface">Welcome back</h1>
        <p className="mt-1 text-label-md text-on-surface-variant">Enter your password to unlock.</p>

        <form
          className="mt-6 w-full"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) void unlock();
          }}
        >
          <Input
            label="Password"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error ?? undefined}
          />
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
