// The six-stage scanner pipeline (#51, Deliverable 2 slice 2).
//
//   ScanRequest → ingest → auth → effects → screen → verdict → explain → ScanResult
//
// Each stage is an exported function, independently testable; `runPipeline`
// is the only thing that knows the order. The stage *bodies* here are the
// skeleton — enough to run the fixture corpus end-to-end and no more. The real
// work lands per stage: #52 ingest (RPC, timeout, backoff), #53 auth (semantic
// walk), #54–#56 effects, #57 screen against the D1 registry, #58 the risk
// core, #59 the AI explainer. What is NOT skeleton is the shape: the verdict
// is built once, deep-frozen, and stage 6 can only return a string.
//
// The wallet still calls the synchronous `scan()` in engine.ts; this async
// pipeline lands alongside it and D3 rewires the wallet onto it.

import { Address, xdr as XDR } from '@stellar/stellar-sdk';
import { ACTION_FOR, type ScanReason } from './types';
import type {
  AuthNode,
  AuthTree,
  DecodedTx,
  DeepReadonly,
  Effect,
  EffectSet,
  Explainer,
  ExplainInput,
  RawSimulation,
  RiskLevel,
  ScanRequest,
  ScanResult,
  ScreenResult,
  Signal,
  SimulationResult,
  Verdict,
} from './types';
import { decodeTransaction } from './decode';
import { explainTransaction } from './explainer';
import { isReportedAddress, scan } from './engine';

// Everything a stage needs from the outside world is injected, so the whole
// suite runs offline against fixtures/ and #52 / #57 / #59 plug in the live
// RPC, the registry read and the model without touching the orchestrator.
export interface PipelineDeps {
  // Stage 1: run `simulateTransaction` and return the raw JSON-RPC body.
  simulate?: (xdr: string) => Promise<RawSimulation>;
  // Stage 4: is this address flagged? `null` = the lookup could not be made.
  isFlagged?: (address: string) => Promise<boolean | null>;
  // Stage 6: prose from the frozen verdict. Defaults to the rules-based explainer.
  explain?: Explainer;
  // Deadline for stage 6. An explainer that has not settled by then is
  // abandoned for the rules-based prose (`explanationSource: 'fallback'`).
  explainTimeoutMs?: number;
}

export const DEFAULT_EXPLAIN_TIMEOUT_MS = 5_000;

const SEVERITY: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

// ── Stage 1: Ingest ──────────────────────────────────────────────────────────
// Fail-closed: a Soroban transaction that could not be simulated is `ok: false`
// — the pipeline never guesses what a contract call does from the XDR alone.
export async function ingest(
  request: ScanRequest,
  deps: Pick<PipelineDeps, 'simulate'> = {},
): Promise<SimulationResult> {
  const decoded = decodeTransaction(request.xdr, request.networkPassphrase);
  if (!decoded) {
    return { ok: false, decoded: null, simulated: false, auth: [], error: 'undecodable' };
  }
  if (!decoded.isSoroban) {
    return { ok: true, decoded, simulated: false, auth: [] };
  }
  if (!deps.simulate) {
    return { ok: false, decoded, simulated: false, auth: [], error: 'simulation_unavailable' };
  }
  let raw: RawSimulation;
  try {
    raw = await deps.simulate(request.xdr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'simulation failed';
    return { ok: false, decoded, simulated: true, auth: [], error: msg };
  }
  return { ...parseSimulation(raw), decoded, simulated: true };
}

// Shape-check the raw RPC body. Mirrors src/core/stellar/soroban.ts's
// normalisation (kept separate so the package has no import into the app).
function parseSimulation(
  raw: RawSimulation,
): Pick<SimulationResult, 'ok' | 'auth' | 'error' | 'latestLedger'> {
  if (!raw || typeof raw !== 'object')
    return { ok: false, auth: [], error: 'unreadable simulation' };
  if (raw.error) {
    const msg = raw.error.message;
    return { ok: false, auth: [], error: typeof msg === 'string' && msg ? msg : 'rpc error' };
  }
  const result = raw.result;
  if (!result || typeof result !== 'object')
    return { ok: false, auth: [], error: 'unreadable simulation' };
  if (typeof result.error === 'string' && result.error)
    return { ok: false, auth: [], error: result.error };
  if (typeof result.minResourceFee !== 'string' || !result.minResourceFee) {
    return { ok: false, auth: [], error: 'unreadable simulation' };
  }
  const auth: string[] = [];
  if (Array.isArray(result.results) && result.results.length > 0) {
    const first = result.results[0] as { auth?: unknown } | null;
    if (first && Array.isArray(first.auth)) {
      for (const a of first.auth) if (typeof a === 'string') auth.push(a);
    }
  }
  const latestLedger =
    typeof result.latestLedger === 'number' && Number.isFinite(result.latestLedger)
      ? result.latestLedger
      : undefined;
  return { ok: true, auth, ...(latestLedger !== undefined ? { latestLedger } : {}) };
}

// ── Stage 2: Auth ────────────────────────────────────────────────────────────
// Parses each SorobanAuthorizationEntry into a tree of invocations. Structure
// only — #53 attaches the semantics. An entry that fails to parse is counted
// in `unparseable` rather than silently dropped, and the verdict fails closed
// on it.
export function auth(simulation: SimulationResult): AuthTree {
  const roots: AuthNode[] = [];
  let nestedCount = 0;
  let unparseable = 0;
  const count = (node: AuthNode, depth: number): void => {
    if (depth >= 1) nestedCount += 1;
    for (const c of node.children) count(c, depth + 1);
  };
  for (const entry of simulation.auth) {
    try {
      const parsed = XDR.SorobanAuthorizationEntry.fromXDR(entry, 'base64');
      const root = toAuthNode(parsed.rootInvocation());
      count(root, 0);
      roots.push(root);
    } catch {
      unparseable += 1;
    }
  }
  return { roots, nestedCount, unparseable, analyzed: false };
}

function toAuthNode(inv: XDR.SorobanAuthorizedInvocation): AuthNode {
  const fn = inv.function();
  const node: AuthNode = { children: inv.subInvocations().map(toAuthNode) };
  if (fn.switch().name === 'sorobanAuthorizedFunctionTypeContractFn') {
    const call = fn.contractFn();
    const addr = call.contractAddress();
    if (addr.switch().name === 'scAddressTypeContract') {
      node.contractId = Address.fromScAddress(addr).toString();
    }
    node.functionName = call.functionName().toString();
  }
  return node;
}

// ── Stage 3: Effects ─────────────────────────────────────────────────────────
// Skeleton mapping from decoded ops. 3a/3b/3c replace the per-kind bodies.
export function effects(simulation: SimulationResult, _authTree: AuthTree): EffectSet {
  const decoded = simulation.decoded;
  if (!decoded) return { source: null, effects: [], coverage: 'none' };
  const out: Effect[] = decoded.operations.map((op, opIndex) => {
    switch (op.type) {
      case 'payment':
      case 'createAccount':
      case 'pathPaymentStrictSend':
      case 'pathPaymentStrictReceive':
        return {
          kind: 'payment',
          opIndex,
          ...(op.destination ? { counterparty: op.destination } : {}),
          ...(op.assetCode ? { assetCode: op.assetCode } : {}),
          ...(op.amount ? { amount: op.amount } : {}),
        };
      case 'accountMerge':
        return {
          kind: 'account_merge',
          opIndex,
          ...(op.destination ? { counterparty: op.destination } : {}),
        };
      case 'setOptions':
        return {
          kind: 'account_control',
          opIndex,
          ...(op.signerKey ? { counterparty: op.signerKey } : {}),
        };
      case 'invokeHostFunction':
        return {
          kind: 'contract_call',
          opIndex,
          ...(op.contractId ? { counterparty: op.contractId } : {}),
          ...(op.contractFunction ? { functionName: op.contractFunction } : {}),
        };
      default:
        return { kind: 'unknown', opIndex };
    }
  });
  const covered = out.every((e) => e.kind !== 'unknown' && e.kind !== 'contract_call');
  return { source: decoded, effects: out, coverage: covered ? 'full' : 'partial' };
}

// ── Stage 4: Screen ──────────────────────────────────────────────────────────
// Every counterparty the effects name, checked against the flag source. The
// default source is the demo deny-list; #57 injects the D1 registry read.
export async function screen(
  effectSet: EffectSet,
  request: ScanRequest,
  deps: Pick<PipelineDeps, 'isFlagged'> = {},
): Promise<ScreenResult> {
  const checked = Array.from(
    new Set(effectSet.effects.map((e) => e.counterparty).filter((c): c is string => !!c)),
  );
  const lookup =
    deps.isFlagged ??
    (async (address: string) =>
      isReportedAddress(address, request.networkPassphrase, __FEATURE_DEMO_AFFORDANCES__));
  const hits: ScreenResult['hits'] = [];
  let unavailable = false;
  for (const address of checked) {
    let flagged: boolean | null;
    try {
      flagged = await lookup(address);
    } catch {
      flagged = null;
    }
    if (flagged === null) unavailable = true;
    else if (flagged) hits.push({ address, source: deps.isFlagged ? 'registry' : 'demo-list' });
  }
  const outcome = hits.length > 0 ? 'flagged' : unavailable ? 'unavailable' : 'clean';
  return { outcome, checked, hits };
}

// ── Stage 5: Verdict ─────────────────────────────────────────────────────────
// The only constructor of a `Verdict`, and the last stage allowed to decide
// anything. Interim risk core: the shipped `scan()` heuristics (so the pipeline
// is never weaker than today's wallet) plus the fail-closed and screening
// reasons the pipeline itself establishes. #58 replaces the body; the freeze
// and the signature stay.
export function buildVerdict(input: {
  request: ScanRequest;
  simulation: SimulationResult;
  auth: AuthTree;
  effects: EffectSet;
  screen: ScreenResult;
}): Verdict {
  const { request, simulation, auth: authTree, effects: effectSet, screen: screenResult } = input;
  const reasons: ScanReason[] = [];
  const signals: Signal[] = [];

  if (!simulation.ok) {
    reasons.push({
      code: simulation.decoded ? 'simulation_failed' : 'undecodable',
      severity: 'high',
      title: simulation.decoded
        ? 'Couldn’t simulate this transaction'
        : 'Couldn’t read this transaction',
      detail: simulation.decoded
        ? 'Lantern couldn’t simulate this contract call and can’t verify what it does — do not sign unless you’re certain.'
        : 'Lantern couldn’t decode this transaction and can’t verify it’s safe — do not sign unless you’re certain.',
    });
    signals.push({ stage: 'ingest', code: 'fail_closed', detail: simulation.error ?? 'unknown' });
  } else {
    signals.push({
      stage: 'ingest',
      code: simulation.simulated ? 'simulated' : 'classic',
      detail: simulation.simulated
        ? `${simulation.auth.length} auth entries`
        : 'no simulation needed',
    });
  }

  if (authTree.unparseable > 0) {
    reasons.push({
      code: 'auth_unreadable',
      severity: 'high',
      title: 'Couldn’t read what this transaction authorises',
      detail:
        'Part of the authorisation this contract call requires couldn’t be decoded, so Lantern can’t tell what it permits — do not sign unless you’re certain.',
    });
    signals.push({
      stage: 'auth',
      code: 'fail_closed',
      detail: `${authTree.unparseable} of ${simulation.auth.length} auth entries unparseable`,
    });
  } else {
    signals.push({
      stage: 'auth',
      code: authTree.nestedCount > 0 ? 'nested_invocations' : 'flat',
      detail: `${authTree.roots.length} roots, ${authTree.nestedCount} nested`,
    });
  }
  signals.push({
    stage: 'effects',
    code: `coverage_${effectSet.coverage}`,
    detail: effectSet.effects.map((e) => e.kind).join(',') || 'none',
  });
  signals.push({
    stage: 'screen',
    code: screenResult.outcome,
    detail: `${screenResult.checked.length} checked, ${screenResult.hits.length} hits`,
  });

  // Today's heuristics, with the demo override stripped: the pipeline's verdict
  // is never forced, whatever the UI is allowed to do in a demo build.
  if (simulation.decoded) {
    const context = { ...request.context };
    delete context.forceScenario;
    const legacy = scan({
      xdr: request.xdr,
      networkPassphrase: request.networkPassphrase,
      context,
    });
    for (const r of legacy.reasons) reasons.push(r);
    signals.push({
      stage: 'verdict',
      code: 'legacy_heuristics',
      detail: `${legacy.reasons.length} reasons`,
    });
  }

  for (const hit of screenResult.hits) {
    if (reasons.some((r) => r.code === 'reported_address')) break;
    reasons.push({
      code: 'reported_address',
      severity: 'high',
      title: 'Reported address',
      detail: `${hit.address.slice(0, 4)}…${hit.address.slice(-4)} has been reported as a scam address (${hit.source}).`,
    });
  }
  if (screenResult.outcome === 'unavailable' && !reasons.some((r) => r.severity === 'high')) {
    reasons.push({
      code: 'screen_unavailable',
      severity: 'medium',
      title: 'Couldn’t check the recipient',
      detail: 'The reported-address registry couldn’t be reached, so this recipient is unverified.',
    });
  }

  const risk = reasons.reduce<RiskLevel>(
    (worst, r) => (SEVERITY[r.severity] > SEVERITY[worst] ? r.severity : worst),
    'low',
  );
  return deepFreeze({ risk, action: ACTION_FOR[risk], reasons, signals });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

// ── Stage 6: Explain ─────────────────────────────────────────────────────────
// Default explainer: the rules-based prose already shipped. #59 supplies a
// model-backed one with the same signature — string in, string out.
export const explainRulesBased: Explainer = async ({ effects: effectSet }: ExplainInput) =>
  // explainTransaction only reads its input; the cast drops the readonly
  // wrapper the shipped signature predates, nothing else.
  explainTransaction(effectSet.source as DecodedTx | null);

// ── Orchestrator ─────────────────────────────────────────────────────────────
export async function runPipeline(
  request: ScanRequest,
  deps: PipelineDeps = {},
): Promise<ScanResult> {
  const simulation = await ingest(request, deps);
  const authTree = auth(simulation);
  const effectSet = effects(simulation, authTree);
  const screenResult = await screen(effectSet, request, deps);
  const verdict = buildVerdict({
    request,
    simulation,
    auth: authTree,
    effects: effectSet,
    screen: screenResult,
  });

  // Stage 6 gets the frozen verdict and the frozen effects, and can only hand
  // back prose. Anything else — a throw, a non-string, an object masquerading
  // as a verdict, a promise that never settles — is discarded for the
  // rules-based sentence. Nothing it returns reaches any field but
  // `explanation`.
  const frozenEffects = deepFreeze(effectSet) as DeepReadonly<EffectSet>;
  const explainer = deps.explain ?? explainRulesBased;
  const timeoutMs = deps.explainTimeoutMs ?? DEFAULT_EXPLAIN_TIMEOUT_MS;
  let explanation: string;
  let explanationSource: ScanResult['explanationSource'] = 'explainer';
  try {
    const prose: unknown = await withDeadline(
      explainer({ verdict, effects: frozenEffects }),
      timeoutMs,
    );
    if (typeof prose === 'string' && prose.trim() !== '') {
      explanation = prose;
    } else {
      explanation = await explainRulesBased({ verdict, effects: frozenEffects });
      explanationSource = 'fallback';
    }
  } catch {
    explanation = await explainRulesBased({ verdict, effects: frozenEffects });
    explanationSource = 'fallback';
  }

  return {
    risk: verdict.risk,
    action: verdict.action,
    reasons: verdict.reasons,
    signals: verdict.signals,
    explanation,
    explanationSource,
    verdict,
    simulation,
    auth: authTree,
    effects: frozenEffects,
    screen: screenResult,
  };
}

// Rejects if `promise` has not settled within `ms`. The timer is cleared on
// settle so a fast explainer never leaves a dangling handle.
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`explainer exceeded ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
