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

// D2 pipeline (#51). Async, six stages, verdict frozen before the explainer.
export type {
  DeepReadonly,
  ScanRequest,
  RawSimulation,
  StageName,
  IngestFailure,
  Footprint,
  RestorePreamble,
  SimulationResult,
  AuthCredentials,
  AuthNode,
  AuthEntry,
  AuthCall,
  AuthTree,
  EffectKind,
  Effect,
  EffectSet,
  ScreenOutcome,
  ScreenHit,
  ScreenResult,
  Signal,
  Verdict,
  Explanation,
  ExplainInput,
  Explainer,
  ScanResult,
} from './types';
export {
  ingest,
  auth,
  effects,
  screen,
  buildVerdict,
  explainRulesBased,
  runPipeline,
  DEFAULT_EXPLAIN_TIMEOUT_MS,
  type PipelineDeps,
} from './pipeline';
export {
  simulateWithRpc,
  createRpcSimulator,
  RpcError,
  DEFAULT_RPC_TIMEOUT_MS,
  DEFAULT_RPC_ATTEMPTS,
  DEFAULT_RPC_BACKOFF_MS,
  type RpcSimulateOptions,
  type RpcFailureKind,
} from './rpc';
export { decodeScVal, type DecodedScVal } from './scval';
