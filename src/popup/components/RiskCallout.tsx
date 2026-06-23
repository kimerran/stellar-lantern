import type { RiskLevel, ScanReason } from '@core/scan/types';
import { Icon } from './Icon';

// Renders a risk verdict's reasons + explanation as a coloured callout. Shared by
// the pre-sign approval scan and paste-to-check. One focal element per view
// (BRAND §7): the highest-risk callout becomes the focus, not the amount glow.

const THEME: Record<RiskLevel, { icon: string; border: string; bg: string; text: string }> = {
  low: {
    icon: 'verified_user',
    border: 'border-tertiary-container/30',
    bg: 'bg-tertiary-container/10',
    text: 'text-tertiary',
  },
  medium: {
    icon: 'warning',
    border: 'border-secondary/30',
    bg: 'bg-secondary-container/10',
    text: 'text-secondary',
  },
  high: {
    icon: 'gpp_bad',
    border: 'border-error/30',
    bg: 'bg-error-container/15',
    text: 'text-error',
  },
};

interface Props {
  risk: RiskLevel;
  reasons: ScanReason[];
  explanation?: string;
  whatToDo?: string;
}

export function RiskCallout({ risk, reasons, explanation, whatToDo }: Props) {
  const t = THEME[risk];
  return (
    <div className={`rounded-2xl border ${t.border} ${t.bg} p-3.5`}>
      <div className="flex items-start gap-2.5">
        <Icon name={t.icon} filled size={20} className={`mt-0.5 shrink-0 ${t.text}`} />
        <div className="min-w-0 flex-1 space-y-2">
          {explanation && <p className="text-label-md leading-relaxed text-on-surface">{explanation}</p>}

          {reasons.length > 0 && (
            <ul className="space-y-2">
              {reasons.map((r) => (
                <li key={r.code} className="flex items-start gap-2">
                  <Icon
                    name={r.severity === 'high' ? 'priority_high' : 'info'}
                    size={14}
                    className={`mt-0.5 shrink-0 ${THEME[r.severity].text}`}
                  />
                  <div>
                    <p className={`text-label-md font-semibold ${THEME[r.severity].text}`}>{r.title}</p>
                    <p className="text-label-sm text-on-surface-variant">{r.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {whatToDo && (
            <p className="rounded-lg bg-surface-container-high/60 p-2 text-label-sm text-on-surface">
              {whatToDo}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
