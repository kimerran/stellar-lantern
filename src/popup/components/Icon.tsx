interface IconProps {
  name: string;
  filled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  size?: number;
}

// Material Symbols Outlined wrapper (BRAND §5).
export function Icon({ name, filled, className = '', style, size = 24 }: IconProps) {
  return (
    <span
      className={`material-symbols-outlined${filled ? ' filled' : ''} ${className}`}
      style={{ fontSize: size, ...style }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
