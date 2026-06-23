import type { NetworkId } from '@shared/constants';

// ── The scan contract (spec §4.1 / §7 Phase 0) ───────────────────────────────
// Lantern only ADVISES and gates the UI. It never signs and never sends. The
// verdict is surface-agnostic so the same engine can back the wallet's own
// Send/Review flow today and a dApp signing-request handler later.

export type RiskLevel = 'low' | 'medium' | 'high';
export type ScanAction = 'allow' | 'warn' | 'block_confirm';

export interface ScanReason {
  code: string;
  severity: RiskLevel;
  title: string;
  detail: string;
}

// What `scan()` learns from decoding the transaction XDR.
export interface DecodedOp {
  type: string; // 'payment' | 'createAccount' | 'invokeHostFunction' | …
  destination?: string;
  assetCode?: string;
  amount?: string;
}

export interface DecodedTx {
  operations: DecodedOp[];
  primaryDestination?: string;
  primaryAmount?: string;
  primaryAssetCode?: string;
  memo?: string;
  isSoroban: boolean;
}

// Context the XDR can't tell us (comes from the wallet / chain lookups).
export interface ScanContext {
  network: NetworkId;
  fromAddress: string;
  destinationFunded?: boolean;
  spendableXlm?: string;
  origin?: string; // dApp origin, when initiated by a site
  // Demo affordance only — force a verdict so reviewers can see each UI state.
  forceScenario?: RiskLevel;
}

export interface ScanVerdict {
  risk: RiskLevel;
  action: ScanAction;
  reasons: ScanReason[];
  explanation: string; // one plain-language sentence (spec §4.4)
  checkedBy: 'Lantern';
  tier: 0 | 1 | 2; // which (mocked) tier produced the verdict
  latencyMs: number; // mocked timing, for the "checked in Nms" affordance
}

// ── Paste-to-check (spec §4.5) ───────────────────────────────────────────────
export interface MessageVerdict {
  risk: RiskLevel;
  reasons: ScanReason[];
  whatToDo: string;
  tier: 1 | 2;
}

export const ACTION_FOR: Record<RiskLevel, ScanAction> = {
  low: 'allow',
  medium: 'warn',
  high: 'block_confirm',
};
