import { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  mono?: boolean;
  error?: string;
}

// BRAND §6.4: surface-container-high bg, outline-variant border, amber focus glow.
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, mono, error, className = '', ...rest },
  ref,
) {
  return (
    <label className="block">
      {label && (
        <span className="mb-2 block text-label-sm uppercase tracking-wide text-on-surface-variant">
          {label}
        </span>
      )}
      <input
        ref={ref}
        className={`w-full rounded-lg border bg-surface-container-high px-3 py-3 text-body-md text-on-surface placeholder:text-outline transition-colors focus:outline-none focus:border-primary-container focus:shadow-focus-amber ${
          error ? 'border-error' : 'border-outline-variant'
        } ${mono ? 'font-mono' : ''} ${className}`}
        {...rest}
      />
      {error && <span className="mt-1.5 block text-label-sm text-error">{error}</span>}
    </label>
  );
});
