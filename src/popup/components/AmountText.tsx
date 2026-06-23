import { formatAmount } from '@shared/format';

// Semantic value coloring (BRAND §2.5). Incoming = amber glow; outgoing = muted.
export function AmountText({
  signedAmount,
  assetCode,
}: {
  signedAmount: string;
  assetCode: string;
}) {
  const incoming = signedAmount.startsWith('+');
  const sign = signedAmount.slice(0, 1);
  const value = formatAmount(signedAmount.replace(/^[+-]/, ''));
  return (
    <span
      className={`font-mono text-body-md font-semibold ${
        incoming ? 'text-primary-container glow-amber-text' : 'text-on-surface-variant'
      }`}
    >
      {sign}
      {value} {assetCode}
    </span>
  );
}
