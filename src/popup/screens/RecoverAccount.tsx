import { useState } from 'react';
import { BASE_FEE } from '@stellar/stellar-sdk';
import type { NetworkConfig } from '@shared/constants';
import { sendMessage } from '@shared/messages';
import { getServer, loadAccountSigners } from '@core/stellar/client';
import {
  buildRecoveryXdr,
  classifyGuardianConfig,
  collectedSignatureWeight,
  mergeGuardianSignatures,
  type GuardianConfig,
} from '@core/recovery/guardians';
import { isValidPublicKey } from '@core/wallet/wallet';
import { truncateAddress } from '@shared/format';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';

interface Props {
  address: string; // this (new) device's key — becomes the account's new signer
  network: NetworkConfig;
  onBack: () => void;
}

type Step = 'enter' | 'collect' | 'success';

// Recovering device: you've set up a fresh wallet on a new device and want to
// regain access to an account whose key you lost. Enter the account, build the
// recovery request (adds THIS device's key), share it with the account's
// guardians, collect their co-signatures, and submit once enough are gathered.
// Composes buildRecoveryXdr (#42), mergeGuardianSignatures (#47),
// collectedSignatureWeight (#43) and the SUBMIT_ONLY broadcast (#50).
export function RecoverAccount({ address, network, onBack }: Props) {
  const [step, setStep] = useState<Step>('enter');
  const [recoverAddr, setRecoverAddr] = useState('');
  const [config, setConfig] = useState<GuardianConfig | null>(null);

  const [baseXdr, setBaseXdr] = useState(''); // the request to share
  const [mergedXdr, setMergedXdr] = useState(''); // request + collected signatures
  const [collected, setCollected] = useState(0); // signature weight gathered
  const [pasteSig, setPasteSig] = useState(''); // a signed copy pasted back

  const [building, setBuilding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const threshold = config?.recoveryThreshold ?? 0;
  const enough = threshold > 0 && collected >= threshold;

  async function toCollect() {
    const acct = recoverAddr.trim();
    if (!isValidPublicKey(acct)) {
      setError('Enter a valid Stellar account address (starts with G).');
      return;
    }
    if (acct === address) {
      setError('That’s this device’s own account. Enter the account you lost access to.');
      return;
    }
    setBuilding(true);
    setError(null);
    try {
      const state = await loadAccountSigners(network, acct);
      const cfg = state && classifyGuardianConfig(acct, state.signers, state.thresholds);
      if (!cfg || !cfg.isRecoveryEnabled) {
        setError('This account doesn’t have guardian recovery set up, so it can’t be recovered here.');
        setBuilding(false);
        return;
      }

      const server = getServer(network);
      const sourceAccount = await server.loadAccount(acct);
      let baseFee = BASE_FEE;
      try {
        const fetched = await server.fetchBaseFee();
        baseFee = String(Math.min(Math.max(fetched, Number(BASE_FEE)), 100_000));
      } catch {
        /* keep BASE_FEE fallback */
      }

      const xdr = buildRecoveryXdr({
        sourceAccountId: acct,
        sourceSequence: sourceAccount.sequenceNumber(),
        networkPassphrase: network.passphrase,
        baseFee,
        newSignerKey: address,
        guardianCount: cfg.guardians.length,
      });

      setConfig(cfg);
      setBaseXdr(xdr);
      setMergedXdr(xdr);
      setCollected(0);
      setStep('collect');
    } catch {
      setError('Couldn’t prepare the recovery. Check the address and your connection, then try again.');
    } finally {
      setBuilding(false);
    }
  }

  function addSignature() {
    if (!config) return;
    const copy = pasteSig.trim();
    if (!copy) return;
    try {
      const merged = mergeGuardianSignatures(mergedXdr, [copy], network.passphrase);
      setMergedXdr(merged);
      setCollected(collectedSignatureWeight(merged, network.passphrase, config.guardians));
      setPasteSig('');
      setError(null);
    } catch {
      setError('That signed request doesn’t match this recovery — make sure it’s a co-signature of the request above.');
    }
  }

  function copyRequest() {
    navigator.clipboard.writeText(baseXdr).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setError('Couldn’t copy — select the text and copy manually.'),
    );
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const res = await sendMessage({
      type: 'SUBMIT_ONLY',
      xdr: mergedXdr,
      networkPassphrase: network.passphrase,
      horizonUrl: network.horizonUrl,
    });
    setSubmitting(false);
    if (res.ok) {
      setTxHash(res.data.hash);
      setStep('success');
    } else {
      setError(res.error);
    }
  }

  // ── Success ──
  if (step === 'success' && txHash) {
    return (
      <div className="flex h-full flex-col bg-background">
        <Header title="Recovery submitted" onBack={onBack} />
        <div className="flex flex-1 flex-col items-center px-4 pt-10 text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-primary-container/15">
            <Icon name="check_circle" filled size={48} className="text-primary-container drop-shadow-glow-amber" />
          </div>
          <h2 className="text-title-md text-on-surface">You’re back in</h2>
          <p className="mt-1 px-2 text-label-md text-on-surface-variant">
            This device is now a signer on {truncateAddress(recoverAddr.trim(), 4, 4)}.
          </p>
          <p className="mt-4 break-all px-2 font-mono text-label-sm text-on-surface-variant">{txHash}</p>
          <div className="mt-6 w-full space-y-3">
            <Button fullWidth variant="secondary" trailingIcon="open_in_new" onClick={() => window.open(network.explorerTxUrl(txHash), '_blank')}>
              View on Explorer
            </Button>
            <Button fullWidth onClick={onBack}>
              Done
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Collect ──
  if (step === 'collect' && config) {
    return (
      <div className="flex h-full flex-col bg-background">
        <Header title="Collect Signatures" onBack={() => { setStep('enter'); setError(null); }} />
        <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          <p className="text-label-md leading-relaxed text-on-surface-variant">
            Send this request to your guardians. Each opens Lantern → Guardians → <span className="text-on-surface">Co-sign a recovery</span>, then sends the signed request back to you.
          </p>
          <textarea
            readOnly
            value={baseXdr}
            rows={4}
            className="w-full break-all rounded-lg border border-outline-variant bg-surface-container-high px-3 py-3 font-mono text-label-sm text-on-surface focus:outline-none"
          />
          <Button fullWidth variant="secondary" leadingIcon={copied ? 'check' : 'content_copy'} onClick={copyRequest}>
            {copied ? 'Copied' : 'Copy request to share'}
          </Button>

          <Card className="flex items-center justify-between">
            <span className="text-label-md text-on-surface">Signatures collected</span>
            <span className={`font-mono text-title-md ${enough ? 'text-primary-container' : 'text-on-surface-variant'}`}>
              {collected} / {threshold}
            </span>
          </Card>

          <div className="space-y-2">
            <label className="block text-label-sm uppercase tracking-wide text-on-surface-variant">Paste a signed request</label>
            <textarea
              value={pasteSig}
              onChange={(e) => { setPasteSig(e.target.value); setError(null); }}
              rows={3}
              placeholder="Paste a guardian’s signed request…"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full break-all rounded-lg border border-outline-variant bg-surface-container-high px-3 py-3 font-mono text-label-sm text-on-surface placeholder:text-outline focus:border-primary-container focus:shadow-focus-amber focus:outline-none"
            />
            <Button fullWidth variant="secondary" onClick={addSignature} disabled={!pasteSig.trim()} leadingIcon="add">
              Add signature
            </Button>
          </div>

          {error && (
            <p role="alert" className="text-center text-label-md text-error">
              {error}
            </p>
          )}

          <Button fullWidth onClick={submit} loading={submitting} disabled={!enough} trailingIcon="lock">
            {enough ? 'Submit recovery' : `Need ${threshold - collected} more`}
          </Button>
        </div>
      </div>
    );
  }

  // ── Enter ──
  return (
    <div className="flex h-full flex-col bg-background">
      <Header title="Recover an Account" onBack={onBack} />
      <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <p className="text-label-md leading-relaxed text-on-surface-variant">
          Lost access to an account that has <span className="text-on-surface">guardian recovery</span>? Enter it below.
          This device will be added as a new signer once enough of its guardians co-sign.
        </p>
        <Input
          label="Account to recover"
          mono
          placeholder="G…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={recoverAddr}
          onChange={(e) => { setRecoverAddr(e.target.value); setError(null); }}
        />
        {error && (
          <p role="alert" className="text-center text-label-md text-error">
            {error}
          </p>
        )}
        <Button fullWidth onClick={toCollect} loading={building} disabled={!recoverAddr.trim()} trailingIcon="arrow_forward">
          Continue
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
