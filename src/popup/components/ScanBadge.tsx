import type { RiskLevel, ScanVerdict } from '@core/scan';
import { Icon } from './Icon';

// "Checked by Lantern" badge (spec §4.1, §7 Phase 4). Calm by default; the colour
// shifts with risk but stays within BRAND tokens (cool=safe, amber=caution,
// error=danger) so it never competes with the amber value glow.
const STYLES: Record<RiskLevel, { icon: string; cls: string; label: string }> = {
  low: {
    icon: 'verified_user',
    cls: 'text-tertiary border-tertiary-container/40 bg-tertiary-container/10',
    label: 'Checked by Lantern',
  },
  medium: {
    icon: 'gpp_maybe',
    cls: 'text-secondary border-secondary/40 bg-secondary-container/10',
    label: 'Caution — review below',
  },
  high: {
    icon: 'gpp_bad',
    cls: 'text-error border-error/40 bg-error-container/15',
    label: 'High risk — action needed',
  },
};

// A low verdict with no registry behind it (Mainnet today) must not read as
// "checked": the wallet claims only the review it made (D3 QA plan §10.1).
const NO_REGISTRY = {
  icon: 'info',
  cls: 'text-on-surface-variant border-outline-variant/60 bg-surface-container',
  label: 'Reviewed — registry not available on Mainnet',
};

export function badgeStyle(risk: RiskLevel, registry?: ScanVerdict['registry']) {
  return risk === 'low' && registry === 'unavailable' ? NO_REGISTRY : STYLES[risk];
}

export function ScanBadge({
  risk,
  latencyMs,
  registry,
}: {
  risk: RiskLevel;
  latencyMs?: number;
  registry?: ScanVerdict['registry'];
}) {
  const s = badgeStyle(risk, registry);
  const timed = risk === 'low' && registry !== 'unavailable' && latencyMs != null;
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${s.cls}`}>
      <Icon name={s.icon} filled size={15} />
      <span className="text-label-sm font-semibold">{s.label}</span>
      {timed && <span className="text-label-sm opacity-70">· {latencyMs}ms</span>}
    </div>
  );
}
