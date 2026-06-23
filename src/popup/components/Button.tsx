import { Icon } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  trailingIcon?: string;
  leadingIcon?: string;
  fullWidth?: boolean;
  loading?: boolean;
}

// BRAND §6.1 / §6.2: amber primary with glow, outline secondary.
export function Button({
  variant = 'primary',
  trailingIcon,
  leadingIcon,
  fullWidth,
  loading,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg text-title-md transition-colors active:scale-95 disabled:opacity-40 disabled:active:scale-100 disabled:cursor-not-allowed';
  const sizing = 'px-5 py-3.5';
  const variants: Record<Variant, string> = {
    primary:
      'bg-primary-container text-on-primary-container shadow-primary hover:bg-[#ffb300] font-semibold',
    secondary:
      'border border-outline-variant text-on-surface hover:bg-surface-variant bg-transparent',
    ghost: 'text-on-surface-variant hover:text-on-surface bg-transparent',
  };

  return (
    <button
      className={`${base} ${sizing} ${variants[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <Icon name="progress_activity" className="animate-spin" size={20} />
      ) : (
        <>
          {leadingIcon && <Icon name={leadingIcon} size={20} />}
          {children}
          {trailingIcon && <Icon name={trailingIcon} size={20} />}
        </>
      )}
    </button>
  );
}
