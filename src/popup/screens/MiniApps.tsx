import { useState } from 'react';
import { BASE_FEE } from '@stellar/stellar-sdk';
import type { NetworkConfig } from '@shared/constants';
import { MINI_APPS, type MiniApp } from '@core/miniapps/directory';
import { buildTransferXdr } from '@core/stellar/tx';
import { scan, DEMO_FLAGGED_ADDRESSES } from '@core/scan/engine';
import type { ScanVerdict } from '@core/scan/types';
import { truncateAddress } from '@shared/format';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { ScanBadge } from '../components/ScanBadge';
import { RiskCallout } from '../components/RiskCallout';

// ─────────────────────────────────────────────────────────────────────────────
// MOCK mini-app browser (roadmap: "Mini-app browser for Stellar dApps").
//
// Demonstrates the brokered, capability-scoped flow end-to-end WITHOUT a real
// sandboxed runtime or live RPC:
//   1. launch a curated dApp (blockhub.academy is featured),
//   2. connect()  → grant scoped, revocable permissions → return public key,
//   3. signTransaction() → routed through the SAME Lantern scan engine used by
//      the wallet's own Send flow, so a malicious app can't slip an opaque tx
//      past the user.
//
// The "sandboxed frame" is simulated chrome — the real build would isolate the
// dApp in an iframe with no vault access and a postMessage broker. Comments mark
// where the real wiring goes.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  address: string;
  network: NetworkConfig;
}

type Demo = 'trusted' | 'malicious';
type RequestStep = 'idle' | 'review' | 'done';

const FLAGGED = [...DEMO_FLAGGED_ADDRESSES][0]!;
// A benign demo payee (e.g. the dApp's course-enrollment account).
const DEMO_PAYEE = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

export function MiniApps({ address, network }: Props) {
  const [app, setApp] = useState<MiniApp | null>(null);

  if (app) {
    return <MiniAppFrame app={app} address={address} network={network} onClose={() => setApp(null)} />;
  }

  const featured = MINI_APPS.filter((a) => a.featured);
  const rest = MINI_APPS.filter((a) => !a.featured);

  return (
    <div className="space-y-4 pt-2">
      <div>
        <h2 className="text-title-md text-on-surface">Mini-Apps</h2>
        <p className="text-label-md text-on-surface-variant">
          Run Stellar dApps in a sandboxed, permissioned container.
        </p>
      </div>

      {featured.map((a) => (
        <Card key={a.id} onClick={() => setApp(a)} className="!p-0 overflow-hidden">
          <div className="flex items-center gap-3 p-3.5">
            <AppIcon app={a} size={48} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-body-md font-semibold text-on-surface">{a.name}</span>
                {a.verified && <Verified />}
              </div>
              <p className="truncate text-label-sm text-on-surface-variant">{a.tagline}</p>
            </div>
            <Icon name="arrow_forward" size={20} className="text-on-surface-variant" />
          </div>
        </Card>
      ))}

      <div>
        <span className="mb-2 block text-label-sm uppercase tracking-wide text-on-surface-variant">
          Verified directory
        </span>
        <div className="grid grid-cols-2 gap-2.5">
          {rest.map((a) => (
            <button
              key={a.id}
              onClick={() => setApp(a)}
              className="flex flex-col items-center gap-1.5 rounded-2xl bg-surface-container p-3 text-center shadow-layer-1 transition-colors hover:bg-surface-variant active:scale-[0.98]"
            >
              <AppIcon app={a} size={40} />
              <span className="text-label-md font-medium text-on-surface">{a.name}</span>
              {a.verified && (
                <span className="flex items-center gap-0.5 text-label-sm text-tertiary">
                  <Icon name="verified" filled size={12} /> Verified
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <p className="flex items-start gap-1.5 px-1 text-label-sm text-on-surface-variant">
        <Icon name="shield" size={14} className="mt-0.5 shrink-0" />
        Apps run isolated from your keys. Every signature request is scanned by Lantern first.
      </p>
    </div>
  );
}

// ── Opened mini-app: simulated sandboxed frame + brokered wallet API ──────────
function MiniAppFrame({
  app,
  address,
  network,
  onClose,
}: {
  app: MiniApp;
  address: string;
  network: NetworkConfig;
  onClose: () => void;
}) {
  const [connected, setConnected] = useState(false);
  const [connectPrompt, setConnectPrompt] = useState(false);

  const [step, setStep] = useState<RequestStep>('idle');
  const [verdict, setVerdict] = useState<ScanVerdict | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const isHigh = verdict?.action === 'block_confirm';
  const acknowledged = !isHigh || confirmText.trim().toUpperCase() === 'CONFIRM';

  // Broker: the dApp asks to connect; user grants scoped, revocable permission.
  function approveConnect() {
    setConnectPrompt(false);
    setConnected(true); // real build: broker returns the public key over postMessage
  }

  // Broker: the dApp requests a signature. We build the unsigned XDR it would
  // hand us and run it through the SAME scan engine as the Send flow before any
  // signing prompt. Nothing is ever signed in this mock.
  function requestSignature(which: Demo) {
    const destination = which === 'malicious' ? FLAGGED : DEMO_PAYEE;
    const xdr = buildTransferXdr({
      sourceAccountId: address,
      sourceSequence: '0', // placeholder — real build loads the live sequence
      networkPassphrase: network.passphrase,
      baseFee: BASE_FEE,
      destination,
      destinationFunded: true,
      asset: { isNative: true },
      amount: which === 'malicious' ? '4500' : '25',
      memo: which === 'malicious' ? 'Claim airdrop' : 'Course: Stellar 101',
    });
    const v = scan({
      xdr,
      networkPassphrase: network.passphrase,
      context: {
        network: network.id,
        fromAddress: address,
        destinationFunded: true,
        origin: app.origin,
      },
    });
    setVerdict(v);
    setConfirmText('');
    setStep('review');
  }

  return (
    <div className="space-y-3 pt-2">
      {/* Frame chrome: origin + sandbox indicator */}
      <div className="flex items-center gap-2">
        <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface active:scale-95">
          <Icon name="arrow_back" size={22} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-high px-3 py-1.5">
          <Icon name="lock" size={13} className="shrink-0 text-tertiary" />
          <span className="truncate font-mono text-label-sm text-on-surface-variant">{app.origin}</span>
        </div>
      </div>

      {/* The simulated sandboxed dApp surface */}
      <div className="overflow-hidden rounded-2xl border border-outline-variant/50 bg-surface-container-low">
        <div className="flex items-center justify-between border-b border-outline-variant/30 bg-surface-container px-3 py-1.5">
          <span className="flex items-center gap-1 text-label-sm text-on-surface-variant">
            <Icon name="responsive_layout" size={13} /> Sandboxed mini-app
          </span>
          <span className="flex items-center gap-1 text-label-sm text-tertiary">
            <Icon name="shield" filled size={12} /> No vault access
          </span>
        </div>

        <div className="flex flex-col items-center px-4 py-6 text-center">
          <AppIcon app={app} size={56} />
          <h3 className="mt-3 flex items-center gap-1.5 text-title-md text-on-surface">
            {app.name} {app.verified && <Verified />}
          </h3>
          <p className="mt-1 max-w-[16rem] text-label-md text-on-surface-variant">{app.tagline}</p>

          {!connected ? (
            <Button className="mt-5" leadingIcon="link" onClick={() => setConnectPrompt(true)}>
              Connect Lantern
            </Button>
          ) : (
            <div className="mt-5 w-full space-y-3">
              <div className="flex items-center justify-center gap-1.5 rounded-full bg-surface-container px-3 py-1.5 text-label-sm text-on-surface">
                <Icon name="check_circle" filled size={14} className="text-primary-container" />
                Connected as <span className="font-mono">{truncateAddress(address, 4, 4)}</span>
              </div>
              <p className="text-label-sm uppercase tracking-wide text-on-surface-variant">
                This app is requesting a signature
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" leadingIcon="school" onClick={() => requestSignature('trusted')}>
                  Enroll · 25 XLM
                </Button>
                <Button
                  variant="secondary"
                  leadingIcon="warning"
                  className="!border-error/40 !text-error"
                  onClick={() => requestSignature('malicious')}
                >
                  Simulate hijack
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Per-app permissions (scoped + revocable) */}
      {connected && step === 'idle' && (
        <Card className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-label-sm uppercase tracking-wide text-on-surface-variant">
              Permissions · {app.name}
            </span>
            <button onClick={() => setConnected(false)} className="text-label-sm text-error hover:underline">
              Revoke
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {app.permissions.networks.map((n) => (
              <Chip key={n}>{n === 'PUBLIC' ? 'Mainnet' : 'Testnet'}</Chip>
            ))}
            <Chip>{app.permissions.accounts} account</Chip>
            {app.permissions.spendCapXlm != null && <Chip>≤ {app.permissions.spendCapXlm} XLM</Chip>}
          </div>
        </Card>
      )}

      {/* Connect prompt (broker grant) */}
      {connectPrompt && (
        <ConnectPrompt app={app} onApprove={approveConnect} onCancel={() => setConnectPrompt(false)} />
      )}

      {/* Signature request review — runs through the Lantern scan engine */}
      {step === 'review' && verdict && (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-label-md text-on-surface">
            <Icon name="draw" size={16} className="text-primary-container" />
            {app.name} wants you to sign a transaction
          </div>

          {verdict.action === 'allow' ? (
            <div className="flex items-center justify-between rounded-2xl border border-tertiary-container/20 bg-surface-container p-3.5">
              <p className="pr-2 text-label-md text-on-surface">{verdict.explanation}</p>
              <ScanBadge risk="low" latencyMs={verdict.latencyMs} />
            </div>
          ) : (
            <RiskCallout
              risk={verdict.risk}
              reasons={verdict.reasons}
              explanation={verdict.explanation}
              whatToDo={
                isHigh
                  ? 'A connected app requested this. If you did not expect it, reject — signing cannot be reversed.'
                  : undefined
              }
            />
          )}

          {isHigh && (
            <div className="space-y-2">
              <p className="text-label-sm text-error">
                To sign anyway, type <span className="font-mono font-semibold">CONFIRM</span> below.
              </p>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="CONFIRM"
                className="w-full rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 font-mono text-label-md text-on-surface placeholder:text-outline focus:border-primary-container focus:outline-none"
              />
            </div>
          )}

          <div className="flex gap-2">
            <Button fullWidth variant="secondary" onClick={() => setStep('idle')}>
              Reject
            </Button>
            <Button
              fullWidth
              disabled={!acknowledged}
              variant={isHigh ? 'secondary' : 'primary'}
              trailingIcon="lock"
              className={isHigh ? '!border-error/50 !text-error' : ''}
              onClick={() => setStep('done')}
            >
              {isHigh ? 'Sign Anyway' : 'Approve'}
            </Button>
          </div>
        </div>
      )}

      {/* Result handed back to the dApp (mock — nothing was actually signed) */}
      {step === 'done' && (
        <Card className="flex items-center gap-3">
          <Icon name="check_circle" filled size={24} className="text-primary-container" />
          <div className="flex-1">
            <p className="text-label-md text-on-surface">Signed result returned to {app.name}.</p>
            <p className="text-label-sm text-on-surface-variant">Demo only — no transaction was submitted.</p>
          </div>
          <button onClick={() => setStep('idle')} className="text-label-md text-primary hover:underline">
            Done
          </button>
        </Card>
      )}
    </div>
  );
}

function ConnectPrompt({
  app,
  onApprove,
  onCancel,
}: {
  app: MiniApp;
  onApprove: () => void;
  onCancel: () => void;
}) {
  return (
    <Card className="space-y-3 !bg-surface-container-high">
      <div className="flex items-center gap-2">
        <Icon name="link" size={18} className="text-primary-container" />
        <span className="text-body-md font-semibold text-on-surface">Connect to {app.name}?</span>
      </div>
      <p className="text-label-md text-on-surface-variant">This app is requesting permission to:</p>
      <ul className="space-y-1.5 text-label-md text-on-surface">
        <Grant icon="visibility">See your public key</Grant>
        <Grant icon="hub">Use {app.permissions.networks.map((n) => (n === 'PUBLIC' ? 'Mainnet' : 'Testnet')).join(' · ')}</Grant>
        <Grant icon="draw">Request signatures (always scanned & confirmed)</Grant>
      </ul>
      <p className="text-label-sm text-on-surface-variant">
        Your secret key never leaves Lantern. You can revoke this anytime.
      </p>
      <div className="flex gap-2">
        <Button fullWidth variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button fullWidth onClick={onApprove}>
          Connect
        </Button>
      </div>
    </Card>
  );
}

function Grant({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <Icon name={icon} size={16} className="text-on-surface-variant" />
      {children}
    </li>
  );
}

function AppIcon({ app, size }: { app: MiniApp; size: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl border border-outline-variant bg-gradient-to-br from-surface-container-high to-surface-container-low text-primary-container"
      style={{ width: size, height: size }}
    >
      <Icon name={app.icon} size={Math.round(size * 0.5)} />
    </span>
  );
}

function Verified() {
  return <Icon name="verified" filled size={15} className="text-tertiary" />;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-outline-variant bg-surface-container-high px-2.5 py-1 text-label-sm text-on-surface-variant">
      {children}
    </span>
  );
}
