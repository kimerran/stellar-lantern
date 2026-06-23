import { useState } from 'react';
import { sendMessage } from '@shared/messages';
import { normalizeMnemonic } from '@core/wallet/wallet';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Icon } from '../components/Icon';
import { SeedGrid } from '../components/SeedGrid';
import { WarningCallout } from '../components/WarningCallout';

type Step =
  | 'welcome'
  | 'create-seed'
  | 'create-confirm'
  | 'create-password'
  | 'import-input'
  | 'import-password';

const MIN_PASSWORD = 8;

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('welcome');
  const [mnemonic, setMnemonic] = useState('');
  const [importInput, setImportInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const words = mnemonic ? mnemonic.split(' ') : [];

  async function startCreate() {
    setBusy(true);
    setError(null);
    const res = await sendMessage({ type: 'GENERATE_MNEMONIC', strength: 128 });
    setBusy(false);
    if (res.ok) {
      setMnemonic(res.data.mnemonic);
      setStep('create-seed');
    } else {
      setError(res.error);
    }
  }

  async function finishCreate(password: string) {
    setBusy(true);
    setError(null);
    const res = await sendMessage({ type: 'CREATE_WALLET', mnemonic, password });
    setBusy(false);
    if (res.ok) onDone();
    else setError(res.error);
  }

  async function finishImport(password: string) {
    setBusy(true);
    setError(null);
    const res = await sendMessage({ type: 'IMPORT_WALLET', input: importInput, password });
    setBusy(false);
    if (res.ok) onDone();
    else setError(res.error);
  }

  return (
    <div className="grid-bg flex h-full flex-col overflow-y-auto no-scrollbar bg-background px-5 py-6">
      {step === 'welcome' && <Welcome busy={busy} onCreate={startCreate} onImport={() => setStep('import-input')} />}

      {step === 'create-seed' && (
        <SeedReveal words={words} onBack={() => setStep('welcome')} onNext={() => setStep('create-confirm')} />
      )}

      {step === 'create-confirm' && (
        <SeedConfirm
          words={words}
          onBack={() => setStep('create-seed')}
          onConfirmed={() => setStep('create-password')}
        />
      )}

      {step === 'create-password' && (
        <PasswordSetup busy={busy} onBack={() => setStep('create-confirm')} onSubmit={finishCreate} />
      )}

      {step === 'import-input' && (
        <ImportInput
          value={importInput}
          onChange={setImportInput}
          onBack={() => setStep('welcome')}
          onNext={() => setStep('import-password')}
        />
      )}

      {step === 'import-password' && (
        <PasswordSetup busy={busy} onBack={() => setStep('import-input')} onSubmit={finishImport} />
      )}

      {error && <p className="mt-4 text-center text-label-md text-error">{error}</p>}
    </div>
  );
}

function Welcome({
  busy,
  onCreate,
  onImport,
}: {
  busy: boolean;
  onCreate: () => void;
  onImport: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary-container/15">
          <Icon name="lightbulb" filled size={44} className="animate-subtle-glow text-primary-container" />
        </div>
        <h1 className="text-headline-lg-mobile text-primary">Lantern</h1>
        <p className="mt-3 max-w-[260px] text-body-md text-on-surface-variant">
          Securely light your path to the decentralized web.
        </p>
      </div>
      <div className="space-y-3">
        <Button fullWidth onClick={onCreate} loading={busy} trailingIcon="arrow_forward">
          Create New Wallet
        </Button>
        <Button fullWidth variant="secondary" onClick={onImport} disabled={busy}>
          Import Wallet
        </Button>
      </div>
    </div>
  );
}

function StepHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <div className="mb-5">
      <button onClick={onBack} className="mb-3 flex items-center gap-1 text-label-md text-on-surface-variant hover:text-on-surface">
        <Icon name="arrow_back" size={18} /> Back
      </button>
      <h2 className="text-title-md text-on-surface">{title}</h2>
      {subtitle && <p className="mt-1 text-label-md text-on-surface-variant">{subtitle}</p>}
    </div>
  );
}

function SeedReveal({ words, onBack, onNext }: { words: string[]; onBack: () => void; onNext: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <StepHeader title="Your Recovery Phrase" subtitle="Write these 12 words down in order and keep them safe." onBack={onBack} />
      <SeedGrid words={words} />
      <div className="mt-4">
        <WarningCallout>Never share your phrase. Anyone with these words can control your assets.</WarningCallout>
      </div>
      <label className="mt-4 flex items-center gap-2 text-label-md text-on-surface">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="h-4 w-4 accent-[#ffc107]"
        />
        I have written down my recovery phrase.
      </label>
      <div className="mt-auto pt-5">
        <Button fullWidth onClick={onNext} disabled={!acknowledged} trailingIcon="arrow_forward">
          Continue
        </Button>
      </div>
    </div>
  );
}

// Word-position verification (SPEC §6.1, preferred path).
function SeedConfirm({ words, onBack, onConfirmed }: { words: string[]; onBack: () => void; onConfirmed: () => void }) {
  // Deterministic-but-spread positions; avoids needing a RNG in this component.
  const positions = [2, 7];
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const allCorrect = positions.every((p) => normalizeMnemonic(answers[p] ?? '') === words[p]);

  return (
    <div className="flex h-full flex-col">
      <StepHeader title="Confirm Your Phrase" subtitle="Enter the requested words to confirm you saved them." onBack={onBack} />
      <div className="space-y-4">
        {positions.map((p) => (
          <Input
            key={p}
            label={`Word #${p + 1}`}
            mono
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={answers[p] ?? ''}
            onChange={(e) => setAnswers((a) => ({ ...a, [p]: e.target.value }))}
          />
        ))}
      </div>
      <div className="mt-auto pt-5">
        <Button fullWidth onClick={onConfirmed} disabled={!allCorrect} trailingIcon="arrow_forward">
          Continue
        </Button>
      </div>
    </div>
  );
}

function ImportInput({
  value,
  onChange,
  onBack,
  onNext,
}: {
  value: string;
  onChange: (v: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <StepHeader
        title="Import Wallet"
        subtitle="Paste your 12/24-word recovery phrase or a Stellar secret key (starts with S)."
        onBack={onBack}
      />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="word1 word2 word3 …  or  S…"
        className="w-full rounded-lg border border-outline-variant bg-surface-container-high px-3 py-3 font-mono text-label-md text-on-surface placeholder:text-outline focus:border-primary-container focus:shadow-focus-amber focus:outline-none"
      />
      <div className="mt-4">
        <WarningCallout>Never share your phrase. Anyone with these words can control your assets.</WarningCallout>
      </div>
      <div className="mt-auto pt-5">
        <Button fullWidth onClick={onNext} disabled={value.trim().length === 0} trailingIcon="arrow_forward">
          Continue
        </Button>
      </div>
    </div>
  );
}

function PasswordSetup({
  busy,
  onBack,
  onSubmit,
}: {
  busy: boolean;
  onBack: () => void;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = password.length >= MIN_PASSWORD && confirm === password;

  return (
    <div className="flex h-full flex-col">
      <StepHeader title="Set a Password" subtitle="This encrypts your wallet on this device. You'll need it to unlock." onBack={onBack} />
      <div className="space-y-4">
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={tooShort ? `At least ${MIN_PASSWORD} characters.` : undefined}
        />
        <Input
          label="Confirm Password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch ? 'Passwords do not match.' : undefined}
        />
      </div>
      <div className="mt-auto pt-5">
        <Button fullWidth onClick={() => onSubmit(password)} disabled={!valid} loading={busy} trailingIcon="check">
          Create Wallet
        </Button>
      </div>
    </div>
  );
}
