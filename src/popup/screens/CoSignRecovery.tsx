import { useEffect, useState } from 'react';
import type { NetworkConfig } from '@shared/constants';
import { sendMessage } from '@shared/messages';
import { scan } from '@core/scan/engine';
import type { ScanVerdict } from '@core/scan/types';
import { recoveryCoSignError } from '@core/recovery/guardians';
import { isNativePlatform } from '@shared/kv';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { RiskCallout } from '../components/RiskCallout';
import { HoldToConfirm } from '../components/HoldToConfirm';

interface Props {
  address: string;
  network: NetworkConfig;
  onBack: () => void;
}

type Step = 'paste' | 'review' | 'signed';

// Guardian side of social recovery: paste the recovery request someone shared,
// review exactly what it changes, co-sign it (SIGN_ONLY — never submitted here),
// and hand the signed copy back. Refuses to sign anything that isn't a recovery
// (setOptions signer/threshold change), so it can't be used to trick a guardian
// into signing a payment.
export function CoSignRecovery({ address, network, onBack }: Props) {
  const [step, setStep] = useState<Step>('paste');
  const [xdr, setXdr] = useState('');
  const [verdict, setVerdict] = useState<ScanVerdict | null>(null);
  const [scanning, setScanning] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [signedXdr, setSignedXdr] = useState('');
  const [signing, setSigning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 'review' || !verdict) return;
    setScanning(true);
    const t = setTimeout(() => setScanning(false), Math.min(verdict.latencyMs, 600));
    return () => clearTimeout(t);
  }, [step, verdict]);

  function toReview() {
    // One guard covers: unreadable XDR, a tx that modifies the guardian's OWN
    // account (takeover attempt), and anything that isn't a recovery setOptions.
    const guardError = recoveryCoSignError(xdr, network.passphrase, address);
    if (guardError) {
      setError(guardError);
      return;
    }
    setError(null);
    setVerdict(scan({ xdr: xdr.trim(), networkPassphrase: network.passphrase, context: { network: network.id, fromAddress: address } }));
    setConfirmText('');
    setStep('review');
  }

  async function coSign() {
    setSigning(true);
    setError(null);
    const res = await sendMessage({ type: 'SIGN_ONLY', xdr: xdr.trim(), networkPassphrase: network.passphrase });
    setSigning(false);
    if (res.ok) {
      setSignedXdr(res.data.signedXdr);
      setStep('signed');
    } else if (res.code === 'LOCKED') {
      setError('Wallet locked. Close and reopen to unlock, then try again.');
    } else {
      setError(res.error);
    }
  }

  function copySigned() {
    navigator.clipboard.writeText(signedXdr).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setError('Couldn’t copy — select the text and copy manually.'),
    );
  }

  // ── Signed ──
  if (step === 'signed') {
    return (
      <div className="flex h-full flex-col bg-background">
        <Header title="Recovery co-signed" onBack={onBack} />
        <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          <div className="flex flex-col items-center pt-2 text-center">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-primary-container/15">
              <Icon name="verified_user" filled size={36} className="text-primary-container drop-shadow-glow-amber" />
            </div>
            <p className="text-label-md text-on-surface-variant">
              Send this signed request back to the person recovering their account.
            </p>
          </div>
          <textarea
            readOnly
            value={signedXdr}
            rows={5}
            className="w-full break-all rounded-lg border border-outline-variant bg-surface-container-high px-3 py-3 font-mono text-label-sm text-on-surface focus:outline-none"
          />
          <Button fullWidth leadingIcon={copied ? 'check' : 'content_copy'} onClick={copySigned} variant="secondary">
            {copied ? 'Copied' : 'Copy signed request'}
          </Button>
          <Button fullWidth onClick={onBack}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  // ── Review ──
  if (step === 'review') {
    const isHigh = verdict?.action === 'block_confirm';
    const native = isNativePlatform();
    const acknowledged = !isHigh || native || confirmText.trim().toUpperCase() === 'CONFIRM';
    return (
      <div className="flex h-full flex-col bg-background">
        <Header title="Review Request" onBack={() => { setStep('paste'); setVerdict(null); setError(null); }} />
        <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          <p className="text-label-md text-on-surface-variant">
            You’re co-signing someone’s account recovery. Only continue if you personally trust them and expected this.
          </p>
          <div aria-live="polite" aria-atomic="true">
            {scanning ? (
              <div className="flex items-center gap-2 rounded-2xl border border-outline-variant/40 bg-surface-container p-3.5">
                <Icon name="security" size={18} className="animate-pulse text-on-surface-variant" />
                <span className="text-label-md text-on-surface-variant">Lantern is checking this request…</span>
              </div>
            ) : verdict ? (
              <RiskCallout
                risk={verdict.risk}
                reasons={verdict.reasons}
                explanation={verdict.explanation}
                whatToDo="Your signature helps them regain access. It can’t move your own funds."
              />
            ) : null}
          </div>

          {isHigh && !scanning && !native && (
            <div className="space-y-2">
              <p className="text-label-sm text-error">
                To co-sign, type <span className="font-mono font-semibold">CONFIRM</span> below.
              </p>
              <Input mono placeholder="CONFIRM" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            </div>
          )}

          {error && (
            <p role="alert" className="text-center text-label-md text-error">
              {error}
            </p>
          )}

          {isHigh && native && !scanning ? (
            <HoldToConfirm label={signing ? 'Signing…' : 'Hold to Co-sign'} danger onConfirm={coSign} disabled={signing} />
          ) : (
            <Button
              fullWidth
              onClick={coSign}
              loading={signing}
              disabled={scanning || !acknowledged}
              variant={isHigh ? 'secondary' : 'primary'}
              trailingIcon="lock"
              className={isHigh ? '!border-error/50 !text-error' : ''}
            >
              Co-sign Recovery
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Paste ──
  return (
    <div className="flex h-full flex-col bg-background">
      <Header title="Co-sign a Recovery" onBack={onBack} />
      <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <p className="text-label-md leading-relaxed text-on-surface-variant">
          Helping someone recover their account? Paste the recovery request they shared. Lantern only co-signs guardian
          recovery here — it will refuse anything else.
        </p>
        <textarea
          value={xdr}
          onChange={(e) => {
            setXdr(e.target.value);
            setError(null);
          }}
          rows={5}
          placeholder="Paste the recovery request (a transaction envelope)…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full break-all rounded-lg border border-outline-variant bg-surface-container-high px-3 py-3 font-mono text-label-sm text-on-surface placeholder:text-outline focus:border-primary-container focus:shadow-focus-amber focus:outline-none"
        />
        {error && (
          <Card className="!bg-error-container/15 !border-error/30">
            <p role="alert" className="text-label-md text-error">
              {error}
            </p>
          </Card>
        )}
        <Button fullWidth onClick={toReview} disabled={!xdr.trim()} trailingIcon="arrow_forward">
          Review request
        </Button>
      </div>
    </div>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 bg-surface-container-low px-2">
      <button
        onClick={onBack}
        aria-label="Back"
        className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-variant active:scale-95"
      >
        <Icon name="arrow_back" size={22} />
      </button>
      <h1 className="text-title-md text-on-surface">{title}</h1>
    </header>
  );
}
