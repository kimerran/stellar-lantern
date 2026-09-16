import { useState } from 'react';
import type { NetworkId } from '@shared/constants';
import { NETWORKS } from '@shared/constants';
import type { Settings as SettingsType } from '@shared/types';
import { truncateAddress } from '@shared/format';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Input } from '../components/Input';
import { NetworkBadge } from '../components/NetworkBadge';
import { useToast } from '../components/Toast';
import { CONSENT_COPY } from '@core/telemetry';

interface Props {
  address: string;
  settings: SettingsType;
  /** Overlay mode: back header returns here. Omitted when embedded as a tab. */
  onBack?: () => void;
  /** Rendered inline inside a bottom-nav tab (no full-screen chrome). */
  embedded?: boolean;
  onCopyAddress: () => void;
  onOpenReceive: () => void;
  onOpenGuardians: () => void;
  onOpenScan: () => void;
  onOpenCashInOut: () => void;
  onLock: () => void;
  setNetwork: (network: NetworkId) => void;
  setAutoLock: (minutes: number) => void;
  setHorizonOverrides: (o: SettingsType['horizonOverrides']) => void;
  setRpcOverrides: (o: SettingsType['rpcOverrides']) => void;
  // Analytics consent (#86); rendered only under __FEATURE_TELEMETRY__.
  setAnalyticsConsent?: (on: boolean) => Promise<void>;
  deleteAnalytics?: () => Promise<void>;
}

const APP_VERSION = '0.1.0'; // package.json — Lantern is pre-1.0.

// Auto-lock presets (minutes). 0 = never (armAutoLock leaves the timer disarmed).
const AUTO_LOCK_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '1 min' },
  { value: 5, label: '5 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 0, label: 'Never' },
];

// The Settings / account hub (#110): the single home for everything advanced or
// occasional — account, security, cash, network — grouped with progressive
// disclosure, so the top app bar stays down to identity + network + this gear.
// No capability is removed; each row re-homes an action that used to live in the
// app bar's six-icon row (see the PR's before/after entry-point table).
export function Settings({
  address,
  settings,
  onBack,
  embedded,
  onCopyAddress,
  onOpenReceive,
  onOpenGuardians,
  onOpenScan,
  onOpenCashInOut,
  onLock,
  setNetwork,
  setAutoLock,
  setHorizonOverrides,
  setRpcOverrides,
  setAnalyticsConsent,
  deleteAnalytics,
}: Props) {
  const toast = useToast();
  const content = (
    <>
      <Section title="Account">
        <button
          onClick={onCopyAddress}
          className="flex w-full min-h-[52px] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-variant active:scale-[0.99]"
        >
          <Icon name="account_circle" size={22} className="shrink-0 text-on-surface-variant" />
          <span className="min-w-0 flex-1">
            <span className="block text-body-md text-on-surface">Your address</span>
            <span className="block truncate font-mono text-label-md text-on-surface-variant">
              {truncateAddress(address, 6, 6)}
            </span>
          </span>
          <Icon name="content_copy" size={18} className="shrink-0 text-on-surface-variant" />
        </button>
        <Divider />
        <NavRow icon="qr_code_2" label="Receive" hint="Address & QR code" onClick={onOpenReceive} />
      </Section>

      <Section title="Security">
        <NavRow icon="shield_person" label="Guardians & recovery" onClick={onOpenGuardians} />
        <Divider />
        <NavRow icon="security" label="Security & scam check" onClick={onOpenScan} />
        <Divider />
        <AutoLockRow value={settings.autoLockMinutes} onChange={setAutoLock} />
      </Section>

      <Section title="Cash">
        <NavRow
          icon="currency_exchange"
          label="Cash in / Cash out"
          hint="Deposit & withdraw via anchors"
          onClick={onOpenCashInOut}
        />
      </Section>

      {__FEATURE_TELEMETRY__ && setAnalyticsConsent && deleteAnalytics && (
        <Section title="Privacy">
          <PrivacyRows
            consent={settings.analyticsConsent === true}
            setAnalyticsConsent={setAnalyticsConsent}
            deleteAnalytics={deleteAnalytics}
            toast={toast}
          />
        </Section>
      )}

      <Section title="Network">
        <NetworkRow current={settings.network} onSelect={setNetwork} />
        <Divider />
        <AdvancedEndpoints
          settings={settings}
          setHorizonOverrides={setHorizonOverrides}
          setRpcOverrides={setRpcOverrides}
        />
      </Section>

      <Section title="About">
        <div className="flex min-h-[52px] items-center gap-3 px-4 py-3">
          <Icon name="info" size={22} className="shrink-0 text-on-surface-variant" />
          <span className="flex-1 text-body-md text-on-surface">Version</span>
          <span className="font-mono text-label-md text-on-surface-variant">{APP_VERSION}</span>
        </div>
        <Divider />
        <button
          onClick={onLock}
          className="flex w-full min-h-[52px] items-center gap-3 px-4 py-3 text-left text-error transition-colors hover:bg-error/10 active:scale-[0.99]"
        >
          <Icon name="lock" size={22} className="shrink-0" />
          <span className="flex-1 text-body-md">Lock wallet</span>
        </button>
      </Section>
    </>
  );

  // Embedded as a bottom-nav tab: App provides the app bar + scroll container.
  if (embedded) {
    return (
      <div className="pb-4">
        <h1 className="px-1 pt-1 text-title-md text-on-surface">Settings</h1>
        {content}
      </div>
    );
  }

  // Overlay mode: full-screen with a back header.
  return (
    <div className="flex h-full flex-col bg-background">
      <ScreenHeader title="Settings" onBack={onBack} />
      <main className="no-scrollbar flex-1 overflow-y-auto px-4 pb-8">{content}</main>
    </div>
  );
}

// The analytics toggle + "delete my data" (#86). Copy comes from
// core/telemetry/consent.ts so it can be asserted against docs/telemetry.md.
function PrivacyRows({
  consent,
  setAnalyticsConsent,
  deleteAnalytics,
  toast,
}: {
  consent: boolean;
  setAnalyticsConsent: (on: boolean) => Promise<void>;
  deleteAnalytics: () => Promise<void>;
  toast: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    try {
      await action();
      toast(done);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }
  return (
    <>
      <button
        role="switch"
        aria-checked={consent}
        disabled={busy}
        onClick={() =>
          void run(
            () => setAnalyticsConsent(!consent),
            consent ? 'Usage data sharing is off.' : 'Thanks — sharing anonymous usage data.',
          )
        }
        className="flex w-full min-h-[52px] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-variant active:scale-[0.99] disabled:opacity-60"
      >
        <Icon name="insights" size={22} className="shrink-0 text-on-surface-variant" />
        <span className="min-w-0 flex-1">
          <span className="block text-body-md text-on-surface">{CONSENT_COPY.title}</span>
          <span className="block text-label-md text-on-surface-variant">
            {CONSENT_COPY.summary}
          </span>
        </span>
        <span
          aria-hidden
          className={`ml-2 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${consent ? 'bg-primary' : 'bg-outline-variant'}`}
        >
          <span
            className={`h-5 w-5 rounded-full bg-surface transition-transform ${consent ? 'translate-x-5' : ''}`}
          />
        </span>
      </button>
      <div className="px-4 pb-3 text-label-md text-on-surface-variant">
        <p className="mt-1 font-medium text-on-surface">What we collect</p>
        <ul className="list-disc pl-5">
          {CONSENT_COPY.collected.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-2 font-medium text-on-surface">What we never collect</p>
        <ul className="list-disc pl-5">
          {CONSENT_COPY.neverCollected.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <Divider />
      {confirmDelete ? (
        <div className="flex min-h-[52px] items-center gap-2 px-4 py-3">
          <span className="flex-1 text-body-md text-on-surface">
            Delete everything sent from this install?
          </span>
          <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
            Keep
          </Button>
          <Button
            onClick={() => void run(deleteAnalytics, 'Deletion requested. Sharing is off.')}
            loading={busy}
          >
            Delete
          </Button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          disabled={busy}
          className="flex w-full min-h-[52px] items-center gap-3 px-4 py-3 text-left text-error transition-colors hover:bg-error/10 active:scale-[0.99] disabled:opacity-60"
        >
          <Icon name="delete" size={22} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-body-md">{CONSENT_COPY.deleteTitle}</span>
            <span className="block text-label-md text-on-surface-variant">
              {CONSENT_COPY.deleteHint}
            </span>
          </span>
        </button>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 px-1 text-label-sm uppercase tracking-wide text-on-surface-variant">
        {title}
      </h2>
      <div className="overflow-hidden rounded-2xl bg-surface-container">{children}</div>
    </section>
  );
}

function Divider() {
  return <div className="mx-4 h-px bg-outline-variant/30" />;
}

function NavRow({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: string;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full min-h-[52px] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-variant active:scale-[0.99]"
    >
      <Icon name={icon} size={22} className="shrink-0 text-on-surface-variant" />
      <span className="min-w-0 flex-1">
        <span className="block text-body-md text-on-surface">{label}</span>
        {hint && (
          <span className="block truncate text-label-md text-on-surface-variant">{hint}</span>
        )}
      </span>
      <Icon name="chevron_right" size={20} className="shrink-0 text-on-surface-variant" />
    </button>
  );
}

function AutoLockRow({ value, onChange }: { value: number; onChange: (m: number) => void }) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-3">
      <Icon name="timer" size={22} className="shrink-0 text-on-surface-variant" />
      <span className="flex-1 text-body-md text-on-surface">Auto-lock</span>
      <select
        aria-label="Auto-lock timer"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 text-body-md text-on-surface focus:border-primary-container focus:shadow-focus-amber focus:outline-none"
      >
        {AUTO_LOCK_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function NetworkRow({
  current,
  onSelect,
}: {
  current: NetworkId;
  onSelect: (n: NetworkId) => void;
}) {
  const ids: NetworkId[] = ['TESTNET', 'PUBLIC'];
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-3">
      <Icon name="lan" size={22} className="shrink-0 text-on-surface-variant" />
      <span className="flex-1 text-body-md text-on-surface">Network</span>
      <div className="flex gap-1 rounded-lg bg-surface-container-high p-0.5">
        {ids.map((id) => {
          const active = current === id;
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              aria-pressed={active}
              className={`rounded-md px-3 py-1.5 text-label-md transition-colors ${
                active
                  ? 'bg-primary-container text-on-primary-container shadow-nav-active'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {NETWORKS[id].label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Progressive-disclosure "Advanced" section: per-network Horizon / Soroban-RPC
// endpoint overrides. Blank = use the pinned public default. Applied centrally
// by resolveNetworkConfig (shared/network.ts), so a saved override reaches every
// read and the sign/submit path alike.
function AdvancedEndpoints({
  settings,
  setHorizonOverrides,
  setRpcOverrides,
}: {
  settings: SettingsType;
  setHorizonOverrides: (o: SettingsType['horizonOverrides']) => void;
  setRpcOverrides: (o: SettingsType['rpcOverrides']) => void;
}) {
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const net = settings.network;
  const key = net === 'TESTNET' ? 'testnet' : 'public';
  const base = NETWORKS[net];
  const supportsRpc = Boolean(base.sorobanRpcUrl);

  const [horizon, setHorizon] = useState(settings.horizonOverrides?.[key] ?? '');
  const [rpc, setRpc] = useState(settings.rpcOverrides?.[key] ?? '');

  const invalid = (v: string) => v.trim() !== '' && !/^https?:\/\//i.test(v.trim());

  const save = () => {
    const h = horizon.trim();
    const r = rpc.trim();
    if (invalid(h) || invalid(r)) {
      showToast('Endpoint must be an http(s) URL', 'error');
      return;
    }
    setHorizonOverrides({ ...settings.horizonOverrides, [key]: h || undefined });
    if (supportsRpc) setRpcOverrides({ ...settings.rpcOverrides, [key]: r || undefined });
    showToast(`Saved ${base.label} endpoints`);
  };

  return (
    <div className="px-4 py-3">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-h-[44px] items-center gap-3 text-left transition-colors active:scale-[0.99]"
      >
        <Icon name="tune" size={22} className="shrink-0 text-on-surface-variant" />
        <span className="flex-1 text-body-md text-on-surface">Advanced</span>
        <Icon
          name={open ? 'expand_less' : 'expand_more'}
          size={20}
          className="shrink-0 text-on-surface-variant"
        />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="flex items-center gap-2 text-label-md text-on-surface-variant">
            Custom endpoints for <NetworkBadge network={net} />
          </p>
          <Input
            label="Horizon URL"
            mono
            inputMode="url"
            placeholder={base.horizonUrl}
            value={horizon}
            error={invalid(horizon) ? 'Must start with http(s)://' : undefined}
            onChange={(e) => setHorizon(e.target.value)}
          />
          {supportsRpc && (
            <Input
              label="Soroban RPC URL"
              mono
              inputMode="url"
              placeholder={base.sorobanRpcUrl}
              value={rpc}
              error={invalid(rpc) ? 'Must start with http(s)://' : undefined}
              onChange={(e) => setRpc(e.target.value)}
            />
          )}
          <p className="text-label-sm text-on-surface-variant">
            Leave blank to use Lantern’s default {base.label} endpoints.
          </p>
          <Button variant="secondary" fullWidth onClick={save}>
            Save endpoints
          </Button>
        </div>
      )}
    </div>
  );
}

function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 bg-surface-container-low px-2">
      <button
        onClick={onBack}
        aria-label="Back"
        className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-variant active:scale-95"
      >
        <Icon name="arrow_back" size={22} />
      </button>
      <h1 className="truncate text-title-md text-on-surface">{title}</h1>
    </header>
  );
}
