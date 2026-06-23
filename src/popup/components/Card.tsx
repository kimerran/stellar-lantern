interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  as?: 'div' | 'button';
}

// layer-1 card (BRAND §6.3): surface-container, radius 2xl, soft shadow.
export function Card({ children, className = '', onClick, as = 'div' }: CardProps) {
  const cls = `rounded-2xl bg-surface-container p-3 shadow-layer-1 ${
    onClick ? 'w-full text-left transition-colors hover:bg-surface-variant' : ''
  } ${className}`;
  if (as === 'button' || onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {children}
      </button>
    );
  }
  return <div className={cls}>{children}</div>;
}
