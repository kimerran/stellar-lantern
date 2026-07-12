import { forwardRef, useId } from 'react';

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
  const reactId = useId();
  const errorId = `${reactId}-error`;
  // Preserve any caller-provided aria-describedby and append the error id when present.
  const { 'aria-describedby': ariaDescribedBy, ...inputRest } = rest;
  const describedBy = [ariaDescribedBy, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <label className="block">
      {label && (
        <span className="mb-2 block text-label-sm uppercase tracking-wide text-on-surface-variant">
          {label}
        </span>
      )}
      <input
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full rounded-lg border bg-surface-container-high px-3 py-3 text-body-md text-on-surface placeholder:text-outline transition-colors focus:outline-none focus:border-primary-container focus:shadow-focus-amber ${
          error ? 'border-error' : 'border-outline-variant'
        } ${mono ? 'font-mono' : ''} ${className}`}
        {...inputRest}
      />
      {error && (
        <span id={errorId} role="alert" className="mt-1.5 block text-label-sm text-error">
          {error}
        </span>
      )}
    </label>
  );
});
