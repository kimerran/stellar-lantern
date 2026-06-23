import { Icon } from './Icon';

// Security / warning callout (BRAND §6.8).
export function WarningCallout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-error/20 bg-error-container/10 p-3">
      <Icon name="shield_lock" size={18} className="mt-0.5 shrink-0 text-error" />
      <p className="text-label-sm leading-relaxed text-error">{children}</p>
    </div>
  );
}
