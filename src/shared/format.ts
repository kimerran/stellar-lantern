// Pure display helpers. No secrets, no chrome/react.

// Truncate a Stellar address middle-style: GBK4...X9V2 (BRAND §3).
export function truncateAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail + 3) return address;
  return `${address.slice(0, lead)}...${address.slice(-tail)}`;
}

// Format a Stellar amount string to a human display with up to 7 decimals,
// trimming trailing zeros. Operates on strings to avoid float precision loss.
export function formatAmount(amount: string, maxDecimals = 7): string {
  if (amount === '' || amount == null) return '0';
  const neg = amount.startsWith('-');
  const raw = neg ? amount.slice(1) : amount;
  const [intPartRaw = '0', fracRaw = ''] = raw.split('.');
  const intPart = intPartRaw.replace(/^0+(?=\d)/, '') || '0';
  const frac = fracRaw.slice(0, maxDecimals).replace(/0+$/, '');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = frac ? `${grouped}.${frac}` : grouped;
  return neg ? `-${body}` : body;
}

// Signed display for history rows: "+12.5" / "-3.0".
export function signedAmount(direction: 'in' | 'out', amount: string): string {
  const sign = direction === 'in' ? '+' : '-';
  return `${sign}${formatAmount(amount)}`;
}

// Map an ISO timestamp to a date-group key used by the Activity screen.
export function dateGroupLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayMs = 86_400_000;
  const diff = Math.round((startOf(now) - startOf(d)) / dayMs);
  if (diff <= 0) return 'TODAY';
  if (diff === 1) return 'YESTERDAY';
  const month = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
