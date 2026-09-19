// Exact decimal arithmetic for classic Stellar amounts (#54).
//
// Classic amounts are 7-decimal fixed-point values; the SDK renders them as
// strings like "25.0000000". Everything here goes through bigint stroops so
// there is no float anywhere in the effect path — adding "0.1" and "0.2"
// must give "0.3000000", not 0.30000000000000004.

export const STROOPS_PER_UNIT = 10_000_000n;
const DECIMALS = 7;

// "25.5" | "25.5000000" | "-0.0000001" → stroops. Throws on anything that is
// not a plain decimal with ≤ 7 fraction digits.
export function toStroops(amount: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d{1,7}))?$/.exec(amount.trim());
  if (!m) throw new Error(`not a classic amount: "${amount}"`);
  const sign = m[1];
  const whole = m[2] ?? '0';
  const frac = m[3] ?? '';
  const stroops = BigInt(whole) * STROOPS_PER_UNIT + BigInt(frac.padEnd(DECIMALS, '0'));
  return sign === '-' ? -stroops : stroops;
}

// stroops → canonical 7-decimal string, the SDK's own rendering.
export function fromStroops(stroops: bigint): string {
  const neg = stroops < 0n;
  const abs = neg ? -stroops : stroops;
  const whole = abs / STROOPS_PER_UNIT;
  const frac = (abs % STROOPS_PER_UNIT).toString().padStart(DECIMALS, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

export function addAmounts(a: string, b: string): string {
  return fromStroops(toStroops(a) + toStroops(b));
}
