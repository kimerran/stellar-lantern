// @lantern/scanner — public surface.
//
// Everything a consumer (the Lantern wallet, a dApp, a CLI) needs is exported
// from here; the per-file modules are an implementation detail. Explicit names
// rather than `export *` so a new internal helper never leaks by accident.

export type {
  NetworkId,
  RiskLevel,
  ScanAction,
  ScanReason,
  DecodedOp,
  DecodedTx,
  ScanContext,
  ScanVerdict,
  MessageVerdict,
} from './types';
export { ACTION_FOR } from './types';

export { decodeTransaction } from './decode';
export { explainTransaction } from './explainer';
export { describeDefiFunction } from './defi';
export { analyzeMessage } from './paste';
export {
  scan,
  sampleVerdict,
  isReportedAddress,
  DEMO_FLAGGED_ADDRESSES,
  type ScanInput,
} from './engine';
