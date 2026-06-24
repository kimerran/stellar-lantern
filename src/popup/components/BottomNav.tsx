import { Icon } from './Icon';

export type Tab = 'assets' | 'activity' | 'apps' | 'send';

const ITEMS: { tab: Tab; label: string; icon: string }[] = [
  { tab: 'assets', label: 'Assets', icon: 'account_balance_wallet' },
  { tab: 'activity', label: 'Activity', icon: 'history' },
  { tab: 'apps', label: 'Apps', icon: 'apps' },
  { tab: 'send', label: 'Send', icon: 'send' },
];

// Bottom nav (BRAND §4.3 / §6.6). Active item = amber pill with glow + filled icon.
export function BottomNav({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="flex h-16 shrink-0 items-center justify-around border-t border-outline-variant/30 bg-surface-container px-2">
      {ITEMS.map(({ tab, label, icon }) => {
        const isActive = active === tab;
        return (
          <button
            key={tab}
            onClick={() => onChange(tab)}
            className={`flex flex-col items-center gap-0.5 rounded-xl px-4 py-1.5 transition-colors active:scale-95 ${
              isActive
                ? 'bg-primary-container text-on-primary-container shadow-nav-active'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <Icon name={icon} filled={isActive} size={22} />
            <span className="text-label-sm uppercase tracking-wide">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
