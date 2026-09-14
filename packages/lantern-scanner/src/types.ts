// Mirrors the host wallet's `NetworkId` (src/shared/constants.ts). Declared here
// so the package has no import back into the app — the two stay structurally
// identical, so verdicts flow across the boundary without a cast.
export type NetworkId = 'TESTNET' | 'PUBLIC';

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
  type: string; // 'payment' | 'createAccount' | 'invokeHostFunction' | 'setOptions' | …
  destination?: string;
  assetCode?: string;
  amount?: string;
  // setOptions — account-control changes (signers / thresholds). Present only
  // for the fields the op actually sets; a value of 0 is meaningful (e.g.
  // masterWeight 0 = the account gives up its own key), so these use
  // `undefined` for "unset", never 0.
  signerKey?: string; // the signer being added/removed (weight 0 = removed)
  signerWeight?: number;
  masterWeight?: number;
  lowThreshold?: number;
  medThreshold?: number;
  highThreshold?: number;
  // invokeHostFunction — Soroban contract call. Present only when the host
  // function is a contract invocation (not upload-wasm / create-contract).
  contractId?: string; // the C… contract address being invoked
  contractFunction?: string; // the invoked function name
  // pathPayment (swap) — the "from" side + slippage bound the primary
  // amount/assetCode (the dest side) don't capture. Strict-send: `sendAmount` is
  // exact, `destMin` is the received floor. Strict-receive: `sendAmount` is the
  // max spent, `amount` (dest) is exact so `destMin` is unset.
  sendAssetCode?: string;
  sendAmount?: string;
  destAssetCode?: string;
  destMin?: string;
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

// ── D2 pipeline (#51) ────────────────────────────────────────────────────────
// Six stages, one request in, one result out:
//   ScanRequest → ingest → auth → effects → screen → verdict → explain → ScanResult
// The types below are the contract between stages. The load-bearing one is
// `Verdict`: deeply readonly, frozen by the verdict stage, and the explain stage
// can only ever return a string — so the AI layer is structurally incapable of
// changing risk (one-pager D2; SOW §3.9 "prevented by types, not policy").

// Recursive readonly. Arrays become ReadonlyArray, objects get readonly keys,
// primitives pass through. Used for `Verdict` so no stage after 5 can assign.
export type DeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export interface ScanRequest {
  xdr: string;
  networkPassphrase: string;
  context: ScanContext;
}

// The raw `simulateTransaction` JSON-RPC body, exactly as the RPC returned it
// (or as recorded in fixtures/). Shape-checked by `ingest`, never trusted.
export interface RawSimulation {
  jsonrpc?: string;
  id?: unknown;
  error?: { code?: unknown; message?: unknown };
  result?: {
    error?: unknown;
    minResourceFee?: unknown;
    transactionData?: unknown;
    results?: unknown;
    latestLedger?: unknown;
    events?: unknown;
    restorePreamble?: unknown;
    stateChanges?: unknown;
  };
}

export type StageName = 'ingest' | 'auth' | 'effects' | 'screen' | 'verdict' | 'explain';

// Stage 1 — Ingest (#52). Every way the pipeline can fail to establish what a
// transaction does, kept distinguishable so the verdict can say *which* — a
// network that was down and a contract that would revert are different
// conversations with the user. All of them fail closed.
export type IngestFailure =
  | 'undecodable' // the XDR is not a transaction envelope
  | 'simulation_unavailable' // Soroban tx, but no simulate dependency was injected
  | 'rpc_timeout' // the RPC did not answer within the deadline (after retries)
  | 'rpc_transport' // network error / non-2xx / JSON-RPC-level error (after retries)
  | 'simulation_malformed' // 2xx, but the body is not a simulateTransaction result
  | 'simulation_reverted'; // the contract itself would fail (`result.error`)

// The footprint a simulation says the transaction touches, as base64 LedgerKey
// XDR. `readWrite` is what the call may change.
export interface Footprint {
  readOnly: string[];
  readWrite: string[];
}

export interface RestorePreamble {
  minResourceFee: string;
  transactionData: string;
}

// `ok: true` + `outcome: 'ok'` is the only state later stages may treat as a
// verified simulation. `outcome: 'unknown'` is the third answer: the RPC ran
// the call but reports archived state (`restorePreamble`), so the effects it
// would have are not knowable until a restore — never a clean scan (the same
// posture docs/blacklist-registry.md documents for the hot read).
export interface SimulationResult {
  ok: boolean;
  outcome: 'ok' | 'unknown' | 'failed';
  failure?: IngestFailure;
  decoded: DecodedTx | null;
  // Whether a simulation was attempted; classic (non-Soroban) txs don't need one.
  simulated: boolean;
  error?: string;
  // Base64 SorobanAuthorizationEntry list from `results[0].auth` ([] if none).
  auth: string[];
  // Base64 ScVal the host function returned (`results[0].xdr`), if any.
  returnValue?: string;
  footprint: Footprint;
  // Base64 DiagnosticEvent XDR the simulation emitted, in order.
  events: string[];
  latestLedger?: number;
  restorePreamble?: RestorePreamble;
}

// Stage 2 — Auth. One node per invocation in a SorobanAuthorizationEntry tree.
export interface AuthNode {
  contractId?: string; // C… address; absent for create-contract nodes
  functionName?: string;
  children: AuthNode[];
}
export interface AuthTree {
  roots: AuthNode[];
  // Number of invocations at depth ≥ 1 — a nested call the top-level op
  // never shows. The product thesis: these must never be invisible.
  nestedCount: number;
  // Entries the simulation returned that could not be parsed. Any value > 0
  // means the tree is incomplete and the verdict must fail closed: an
  // authorisation the scanner cannot read is one it cannot vouch for.
  unparseable: number;
  // False until #53 attaches semantics (which nodes move money, whose auth
  // they need). The skeleton only parses structure.
  analyzed: boolean;
}

// Stage 3 — Effects. What the transaction does to the signer's assets.
export type EffectKind =
  | 'payment' // classic payment / createAccount / pathPayment
  | 'token_transfer' // SEP-41 / SAC transfer (3b)
  | 'token_approve' // SEP-41 / SAC approve (3b)
  | 'contract_call' // invokeHostFunction not otherwise decoded (3c)
  | 'account_control' // setOptions signer / threshold change
  | 'account_merge'
  | 'unknown';
export interface Effect {
  kind: EffectKind;
  opIndex: number;
  counterparty?: string; // destination / spender / contract id
  assetCode?: string;
  amount?: string;
  functionName?: string;
}
export interface EffectSet {
  // The decoded tx the effects were derived from; the explainer reads it.
  source: DecodedTx | null;
  effects: Effect[];
  // 'full' once stages 3a–3c cover every op type present; the skeleton
  // reports 'partial' whenever any op is `unknown`/`contract_call`.
  coverage: 'none' | 'partial' | 'full';
}

// Stage 4 — Screen. Three outcomes, never two: a registry that could not be
// reached is not the same as a clean result.
export type ScreenOutcome = 'clean' | 'flagged' | 'unavailable';
export interface ScreenHit {
  address: string;
  source: string; // 'demo-list' | 'registry' | …
}
export interface ScreenResult {
  outcome: ScreenOutcome;
  checked: string[];
  hits: ScreenHit[];
}

// Audit trail: one line per thing a stage evaluated, whether or not it
// produced a reason. Lets a reviewer see *why* a verdict is `low`.
export interface Signal {
  stage: StageName;
  code: string;
  detail: string;
}

// Stage 5 — Verdict. Deeply readonly and frozen by `buildVerdict`; the only
// constructor. Stage 6 receives it and cannot change it.
export type Verdict = DeepReadonly<{
  risk: RiskLevel;
  action: ScanAction;
  reasons: ScanReason[];
  signals: Signal[];
}>;

// Stage 6 — Explain. Prose. Nothing else.
export type Explanation = string;
// Both inputs are deep-frozen by the orchestrator before stage 6 runs, so
// the explainer can neither change the verdict nor corrupt the stage-3 output
// that `ScanResult` carries.
export interface ExplainInput {
  verdict: Readonly<Verdict>;
  effects: DeepReadonly<EffectSet>;
}
export type Explainer = (input: ExplainInput) => Promise<Explanation>;

export interface ScanResult {
  risk: RiskLevel;
  action: ScanAction;
  reasons: ReadonlyArray<ScanReason>;
  signals: ReadonlyArray<Signal>;
  explanation: Explanation;
  // 'explainer' when stage 6 returned a usable string; 'fallback' when it
  // threw, timed out or returned a non-string and the rules-based prose was
  // used instead. The verdict is identical either way.
  explanationSource: 'explainer' | 'fallback';
  verdict: Verdict;
  simulation: SimulationResult;
  auth: AuthTree;
  effects: DeepReadonly<EffectSet>;
  screen: ScreenResult;
}
