import { useEffect, useMemo, useState } from 'react';
import { sendMessage } from '@shared/messages';
import type { NetworkConfig } from '@shared/constants';
import { formatAmount, truncateAddress } from '@shared/format';
import { isNativePlatform } from '@shared/kv';
import { signXdrScanInput, signXdrWith, validateSignXdr } from '@core/dapp/sign-xdr';
import { scanTx } from '@core/scan/wallet';
import type { ScanVerdict } from '@core/scan';
import { useRecheck } from '../hooks/useRecheck';
import { RecheckNotice } from '../components/RecheckNotice';
import { RiskCallout } from '../components/RiskCallout';
import { ScanBadge } from '../components/ScanBadge';
import { HoldToConfirm } from '../components/HoldToConfirm';
import { SignXdrSummary } from '../components/SignXdrSummary';
import { ReportCounterparties, counterpartiesOf } from '../components/ReportAddress';

// Web connect (#252): a connected site's transaction, reviewed in Lantern's
// approval window exactly as the Apps tab reviews a mini-app's (#262):
// scanned and explained, gated behind type-CONFIRM (desktop) when high risk,
// re-checked right before signing (#121), signed through SIGN_ONLY and never
// submitted. The signed envelope goes to the background, which checks it
// again before the site gets it.

interface Props {
  origin: string;
  entryId: string;
  params: Record<string, unknown>;
  address: string;
  network: NetworkConfig;
  armed: boolean;
  onDecided: () => void;
}

export function SignReview({ origin, entryId, params, address, network, armed, onDecided }: Props) {
  const validation = useMemo(
    () => validateSignXdr(params, { networkPassphrase: network.passphrase, address }),
    [params, network.passphrase, address],
  );
  const scanInput = useMemo(
    () =>
      validation.ok
        ? signXdrScanInput(validation.value, {
            network: network.id,
            address,
            rpcUrl: network.sorobanRpcUrl,
            origin,
          })
        : null,
    [validation, network.id, network.sorobanRpcUrl, address, origin],
  );
  const [verdict, setVerdict] = useState<ScanVerdict | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recheck = useRecheck();

  useEffect(() => {
    if (!scanInput) return;
    let live = true;
    setVerdict(null);
    void scanTx(scanInput).then((v) => live && setVerdict(v));
    return () => {
      live = false;
    };
  }, [scanInput]);

  async function reject() {
    setBusy(true);
    await sendMessage({ type: 'WC_DECIDE', entryId, approve: false });
    setBusy(false);
    onDecided();
  }

  async function approve() {
    if (!validation.ok || !verdict || !scanInput) return;
    setBusy(true);
    setError(null);
    const rc = await recheck.guard(verdict, scanInput);
    setVerdict(rc.verdict);
    if (!rc.proceed) {
      setConfirmText('');
      setBusy(false);
      return;
    }
    const signed = await signXdrWith(sendMessage, validation.value, address);
    if (!signed.ok) {
      setBusy(false);
      setError(
        signed.code === 'LOCKED' ? 'Lantern locked. Unlock it and try again.' : signed.error,
      );
      return;
    }
    const res = await sendMessage({
      type: 'WC_DECIDE',
      entryId,
      approve: true,
      result: { signedXdr: signed.data.signedXdr },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDecided();
  }

  if (!validation.ok) {
    return (
      <div className="space-y-3">
        <p className="text-body-md text-on-surface">
          Lantern can’t sign this request: {validation.error}
        </p>
        <button
          onClick={() => void reject()}
          disabled={busy}
          className="w-full rounded-full border border-outline px-4 py-2.5 text-label-md font-semibold text-on-surface-variant active:scale-95 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    );
  }

  const v = validation.value;
  const isHigh = verdict?.action === 'block_confirm';
  const native = isNativePlatform();
  const acknowledged = !isHigh || native || confirmText.trim().toUpperCase() === 'CONFIRM';
  const subjects =
    verdict && counterpartiesOf(verdict, address).length > 0
      ? counterpartiesOf(verdict, address)
      : v.signing.otherSigners.map((a) => ({ address: a }));

  return (
    <div className="space-y-3">
      <h1 className="text-title-md text-on-surface">This site wants you to sign a transaction</h1>
      <SignXdrSummary value={v} />

      {!verdict ? (
        <p className="rounded-xl bg-surface-container p-3 text-label-md text-on-surface-variant">
          Checking the transaction…
        </p>
      ) : verdict.action === 'allow' ? (
        <div className="flex items-center justify-between rounded-xl border border-tertiary-container/20 bg-surface-container-high p-3">
          <p className="pr-2 text-label-md text-on-surface">{verdict.explanation}</p>
          <ScanBadge risk="low" latencyMs={verdict.latencyMs} registry={verdict.registry} />
        </div>
      ) : (
        <RiskCallout
          risk={verdict.risk}
          reasons={verdict.reasons}
          explanation={verdict.explanation}
          whatToDo={
            isHigh
              ? 'A website asked for this. If you didn’t expect it, reject: signing can’t be undone.'
              : undefined
          }
        />
      )}

      <RecheckNotice state={recheck.state} />
      <ReportCounterparties reporter={address} network={network} subjects={subjects} />

      <div className="flex items-center justify-between text-label-sm text-on-surface-variant">
        <span>Network fee</span>
        <span>
          ~{formatAmount(String(Number(v.fee) / 1e7))} XLM
          {!v.signing.userIsTxSource
            ? ` · paid by ${truncateAddress(v.signing.txSource, 4, 4)}`
            : ''}{' '}
          · {network.id === 'PUBLIC' ? 'Mainnet' : 'Testnet'}
        </span>
      </div>

      {isHigh && !native && (
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="Type CONFIRM to allow"
          className="w-full rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 font-mono text-label-md text-on-surface placeholder:text-outline focus:border-primary-container focus:outline-none"
        />
      )}
      {error && <p className="text-center text-label-md text-error">{error}</p>}

      <div ref={recheck.ctaRef} className="flex scroll-mb-4 gap-2">
        <button
          onClick={() => void reject()}
          disabled={busy}
          className="flex-1 rounded-full border border-outline px-4 py-2.5 text-label-md font-semibold text-on-surface-variant active:scale-95 disabled:opacity-50"
        >
          Reject
        </button>
        {isHigh && native ? (
          <HoldToConfirm
            className="flex-1"
            label={busy ? 'Signing…' : 'Hold to Sign anyway'}
            danger
            onConfirm={() => void approve()}
            disabled={busy || !armed || !verdict}
          />
        ) : (
          <button
            onClick={() => void approve()}
            disabled={busy || !armed || !verdict || !acknowledged}
            className={`flex-1 rounded-full px-4 py-2.5 text-label-md font-semibold active:scale-95 disabled:opacity-50 ${
              isHigh
                ? 'border border-error/50 text-error'
                : 'bg-primary-container text-on-primary-container shadow-primary'
            }`}
          >
            {busy ? 'Signing…' : isHigh ? 'Sign anyway' : 'Approve & sign'}
          </button>
        )}
      </div>
    </div>
  );
}
