// Cash-in / cash-out asset support, derived from a SEP-24 /info response (#24).
// The /info deposit + withdraw maps are keyed separately; the Cash-in/out screen
// wants one row per asset with both directions, so this merges them. Pure —
// no network, no side effects — so the screen's logic stays unit-testable.

import type { Sep24Info, AssetTransferInfo } from './sep24';

// One asset's cash-in/cash-out availability at an anchor.
export interface AssetSupport {
  assetCode: string;
  canDeposit: boolean; // deposit listed AND enabled
  canWithdraw: boolean; // withdraw listed AND enabled
  deposit?: AssetTransferInfo; // the raw deposit entry (limits/fees), if listed
  withdraw?: AssetTransferInfo;
}

/**
 * Merge the SEP-24 /info deposit + withdraw asset lists into one per-asset view.
 * `canDeposit`/`canWithdraw` require the side to be both listed AND `enabled`, so
 * a disabled or absent side is never offered. Assets with nothing usable are
 * dropped (the screen only lists what the user can actually do). Sorted by code.
 */
export function summarizeAssetSupport(info: Sep24Info): AssetSupport[] {
  const byCode = new Map<string, AssetSupport>();
  const ensure = (code: string): AssetSupport => {
    let s = byCode.get(code);
    if (!s) {
      s = { assetCode: code, canDeposit: false, canWithdraw: false };
      byCode.set(code, s);
    }
    return s;
  };
  for (const d of info.deposit) {
    const s = ensure(d.assetCode);
    s.deposit = d;
    s.canDeposit = d.enabled;
  }
  for (const w of info.withdraw) {
    const s = ensure(w.assetCode);
    s.withdraw = w;
    s.canWithdraw = w.enabled;
  }
  return [...byCode.values()]
    .filter((s) => s.canDeposit || s.canWithdraw)
    .sort((a, b) => a.assetCode.localeCompare(b.assetCode));
}

/**
 * The `web_auth_domain` to expect in a SEP-10 challenge: the host of the anchor's
 * WEB_AUTH_ENDPOINT, falling back to its home domain if the URL is unparseable.
 * (The challenge validator, `authenticateSep10`, must know this up front.)
 */
export function webAuthDomainFor(webAuthEndpoint: string, homeDomain: string): string {
  try {
    return new URL(webAuthEndpoint).host;
  } catch {
    return homeDomain;
  }
}

/** Human-readable amount limits for one side, or null if the anchor set none. */
export function formatTransferLimits(a: AssetTransferInfo): string | null {
  const fmt = (n: number) => n.toLocaleString('en-US');
  const { minAmount, maxAmount } = a;
  if (minAmount != null && maxAmount != null) return `${fmt(minAmount)}–${fmt(maxAmount)}`;
  if (minAmount != null) return `min ${fmt(minAmount)}`;
  if (maxAmount != null) return `max ${fmt(maxAmount)}`;
  return null;
}
