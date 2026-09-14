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
  Footprint,
  IngestFailure,
  RestorePreamble,
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
import { RpcError } from './rpc';

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
// Each failure mode keeps its own `failure` code (#52) so the verdict can tell
// the user what actually happened.
const EMPTY_FOOTPRINT: Footprint = { readOnly: [], readWrite: [] };

function failed(
  failure: IngestFailure,
  decoded: DecodedTx | null,
  simulated: boolean,
  error: string,
): SimulationResult {
  return {
    ok: false,
    outcome: 'failed',
    failure,
    decoded,
    simulated,
    error,
    auth: [],
    footprint: EMPTY_FOOTPRINT,
    events: [],
  };
}

export async function ingest(
  request: ScanRequest,
  deps: Pick<PipelineDeps, 'simulate'> = {},
): Promise<SimulationResult> {
  const decoded = decodeTransaction(request.xdr, request.networkPassphrase);
  if (!decoded) return failed('undecodable', null, false, 'undecodable');
  if (!decoded.isSoroban) {
    return {
      ok: true,
      outcome: 'ok',
      decoded,
      simulated: false,
      auth: [],
      footprint: EMPTY_FOOTPRINT,
      events: [],
    };
  }
  if (!deps.simulate) {
    return failed('simulation_unavailable', decoded, false, 'simulation_unavailable');
  }
  let raw: RawSimulation;
  try {
    raw = await deps.simulate(request.xdr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'simulation failed';
    if (e instanceof RpcError) {
      const failure: IngestFailure =
        e.kind === 'timeout'
          ? 'rpc_timeout'
          : e.kind === 'malformed'
            ? 'simulation_malformed'
            : 'rpc_transport';
      return failed(failure, decoded, true, msg);
    }
    return failed('rpc_transport', decoded, true, msg);
  }
  return parseSimulation(raw, decoded);
}

// Shape-check the raw RPC body and normalise it into one SimulationResult:
// return value, auth, footprint (decoded from transactionData), events,
// latestLedger, restorePreamble. Nothing in the body is trusted until checked.
function parseSimulation(raw: RawSimulation, decoded: DecodedTx): SimulationResult {
  const malformed = (why: string) => failed('simulation_malformed', decoded, true, why);
  if (!raw || typeof raw !== 'object') return malformed('unreadable simulation');
  if (raw.error) {
    // The RPC was reached and answered; it just could not give a simulation.
    const msg = raw.error.message;
    return malformed(typeof msg === 'string' && msg ? msg : 'rpc error');
  }
  const result = raw.result;
  if (!result || typeof result !== 'object') return malformed('unreadable simulation');
  if (typeof result.error === 'string' && result.error) {
    return failed('simulation_reverted', decoded, true, result.error);
  }
  if (typeof result.minResourceFee !== 'string' || !result.minResourceFee) {
    return malformed('simulation has no minResourceFee');
  }

  const auth: string[] = [];
  let returnValue: string | undefined;
  if (Array.isArray(result.results) && result.results.length > 0) {
    const first = result.results[0] as { auth?: unknown; xdr?: unknown } | null;
    if (first && Array.isArray(first.auth)) {
      for (const a of first.auth) if (typeof a === 'string') auth.push(a);
    }
    if (first && typeof first.xdr === 'string' && first.xdr) returnValue = first.xdr;
  }

  let footprint: Footprint = EMPTY_FOOTPRINT;
  if (typeof result.transactionData === 'string' && result.transactionData) {
    try {
      footprint = decodeFootprint(result.transactionData);
    } catch {
      return malformed('transactionData is not SorobanTransactionData XDR');
    }
  }

  const events: string[] = [];
  if (Array.isArray(result.events)) {
    for (const ev of result.events) if (typeof ev === 'string') events.push(ev);
  }

  const latestLedger =
    typeof result.latestLedger === 'number' && Number.isFinite(result.latestLedger)
      ? result.latestLedger
      : undefined;

  let restorePreamble: RestorePreamble | undefined;
  if (result.restorePreamble && typeof result.restorePreamble === 'object') {
    const rp = result.restorePreamble as { minResourceFee?: unknown; transactionData?: unknown };
    if (typeof rp.minResourceFee === 'string' && typeof rp.transactionData === 'string') {
      restorePreamble = { minResourceFee: rp.minResourceFee, transactionData: rp.transactionData };
    } else {
      return malformed('restorePreamble is present but unreadable');
    }
  }

  return {
    ok: restorePreamble === undefined,
    outcome: restorePreamble === undefined ? 'ok' : 'unknown',
    decoded,
    simulated: true,
    auth,
    ...(returnValue !== undefined ? { returnValue } : {}),
    footprint,
    events,
    ...(latestLedger !== undefined ? { latestLedger } : {}),
    ...(restorePreamble !== undefined ? { restorePreamble } : {}),
  };
}

// The footprint's ledger keys, as base64 LedgerKey XDR, split by access.
function decodeFootprint(transactionData: string): Footprint {
  const td = XDR.SorobanTransactionData.fromXDR(transactionData, 'base64');
  const fp = td.resources().footprint();
  return {
    readOnly: fp.readOnly().map((k) => k.toXDR('base64')),
    readWrite: fp.readWrite().map((k) => k.toXDR('base64')),
  };
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

// One high-severity reason per ingest failure mode (#52). Distinguishable on
// purpose: "the network was down" and "this contract would fail" call for
// different next steps, and neither may ever read as a clean scan.
const CONFIRM_TAIL = ' — do not sign unless you’re certain.';
function ingestReason(simulation: SimulationResult): ScanReason {
  if (simulation.outcome === 'unknown') {
    return {
      code: 'state_archived',
      severity: 'high',
      title: 'Couldn’t verify — state needs restoring',
      detail:
        'Some of the ledger state this contract call touches is archived, so what it would do can’t be verified until that state is restored' +
        CONFIRM_TAIL,
    };
  }
  switch (simulation.failure) {
    case 'undecodable':
      return {
        code: 'undecodable',
        severity: 'high',
        title: 'Couldn’t read this transaction',
        detail:
          'Lantern couldn’t decode this transaction and can’t verify it’s safe' + CONFIRM_TAIL,
      };
    case 'rpc_timeout':
      return {
        code: 'rpc_timeout',
        severity: 'high',
        title: 'The network didn’t answer in time',
        detail:
          'Soroban RPC didn’t respond before the deadline, so this contract call is unverified. Try again in a moment' +
          CONFIRM_TAIL,
      };
    case 'rpc_transport':
      return {
        code: 'rpc_unreachable',
        severity: 'high',
        title: 'Couldn’t reach the network',
        detail:
          'Soroban RPC couldn’t be reached, so this contract call is unverified — this is a connection problem, not a verdict on the transaction' +
          CONFIRM_TAIL,
      };
    case 'simulation_malformed':
      return {
        code: 'simulation_malformed',
        severity: 'high',
        title: 'The network’s answer couldn’t be read',
        detail:
          'Soroban RPC returned a response Lantern couldn’t interpret, so this contract call is unverified' +
          CONFIRM_TAIL,
      };
    case 'simulation_reverted':
      return {
        code: 'simulation_reverted',
        severity: 'high',
        title: 'This transaction would fail',
        detail:
          'Simulating this contract call reports it would fail on-chain, so Lantern can’t tell what it does' +
          CONFIRM_TAIL,
      };
    case 'simulation_unavailable':
    default:
      return {
        code: 'simulation_unavailable',
        severity: 'high',
        title: 'Couldn’t simulate this transaction',
        detail:
          'Lantern couldn’t simulate this contract call and can’t verify what it does' +
          CONFIRM_TAIL,
      };
  }
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
    reasons.push(ingestReason(simulation));
    signals.push({
      stage: 'ingest',
      code: simulation.outcome === 'unknown' ? 'unknown' : 'fail_closed',
      detail: `${simulation.failure ?? 'state_archived'}: ${simulation.error ?? 'archived state needs restoring'}`,
    });
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
