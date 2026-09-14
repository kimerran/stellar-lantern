// Display helpers the explainer and engine need for their prose. Copied from
// the host wallet's src/shared/format.ts (same signatures, same output) so the
// package has no import back into the app — a consumer outside Lantern gets
// identical wording.

// Truncate a Stellar address middle-style: GBK4...X9V2.
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
