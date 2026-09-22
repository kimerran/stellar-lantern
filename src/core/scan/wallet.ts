// The wallet's entry point into the D2 scanner (#84, Deliverable 3 slice 1).
//
// Every review screen used to call the legacy synchronous `scan()` — an
// XDR-only heuristic with the demo deny-list and a rules-based sentence. This
// adapter runs the six-stage `runPipeline` instead (ingest → auth → effects →
// screen → verdict → explain) with the wallet's own network config, and maps
// the `ScanResult` back onto the `ScanVerdict` shape the screens already
// render, so no screen or component had to be rewritten. What the screens now
// get that they never did: a real simulation, D1's registry screening per
// counterparty, and the Lantern API's plain-English sentence — with a real
// `latencyMs`, not a mocked one.
//
// Two paths still go to the legacy `scan()`, deliberately:
//   - `PUBLIC`. The registry and the recorded token contracts are testnet-only
//     and mainnet has no `sorobanRpcUrl`, so the pipeline would answer
//     `unknown` for every counterparty and warn on every mainnet payment.
//     The verdict is the legacy one, marked `registry: 'unavailable'` with
//     the sentence saying so, so the review never claims a check it did not
//     make — no "Checked by Lantern" badge, no clean screening line (D3 QA
//     plan §10.1). TODO: drop this carve-out once a mainnet registry is
//     deployed and `NETWORKS.PUBLIC.sorobanRpcUrl` is set.
//   - `forceScenario` on a DEMO_AFFORDANCES build: the legacy engine owns the
//     forced verdicts, so demo builds keep working through the adapter rather
//     than the pipeline.
import {
  scan,
  runPipeline,
  createRpcSimulator,
  createRegistryScreener,
  createRpcTokenResolver,
  createTokenMetadataCache,
  TESTNET_REGISTRY_ID,
  type PipelineDeps,
  type ScanInput,
  type ScanResult,
  type ScanVerdict,
} from '@lantern/scanner';
import { hostedExplainer } from './ai';

export interface WalletScanInput extends ScanInput {
  // The network's Soroban RPC — `network.sorobanRpcUrl` after Settings
  // overrides have been applied (App resolves it once). Absent on mainnet.
  rpcUrl?: string;
}

// Latency budget (#84 §6). Typical testnet scan lands well under 2 s; the
// worst case — a dead RPC — is bounded by these and fails closed `high`
// (`rpc_unreachable`): 2 × 3.5 s simulate + 3 s screen + 3 s explain ≈ 13 s
// ceiling, ~10 s in practice because the screen and explain stages return
// early on transport errors.
export const SIMULATE_TIMEOUT_MS = 3_500;
export const SIMULATE_ATTEMPTS = 2;
export const SCREEN_TIMEOUT_MS = 3_000;
export const EXPLAIN_TIMEOUT_MS = 3_000;

// One dependency set per RPC URL, so the registry screener's TTL cache and the
// token-metadata cache survive across scans on the same network (and reset if
// the user switches networks or edits the RPC override).
const depsByRpc = new Map<string, PipelineDeps>();

function explainerDeps(): Pick<PipelineDeps, 'explain' | 'explainTimeoutMs'> {
  // Inside the flag guard on purpose: with SCANNER_AI off the env read and
  // the `/v1/explain` path dead-code-eliminate with it, so a flag-off bundle
  // carries no reference to the explainer endpoint (`npm run verify:flags`).
  if (__FEATURE_SCANNER_AI__) {
    const base = import.meta.env.VITE_LANTERN_API_URL as string | undefined;
    if (base) {
      const explain = hostedExplainer({
        endpoint: `${base.replace(/\/$/, '')}/v1/explain`,
        timeoutMs: EXPLAIN_TIMEOUT_MS,
      });
      if (explain) return { explain, explainTimeoutMs: EXPLAIN_TIMEOUT_MS };
    }
  }
  return {};
}

function depsFor(rpcUrl: string): PipelineDeps {
  let deps = depsByRpc.get(rpcUrl);
  if (!deps) {
    deps = {
      simulate: createRpcSimulator({
        rpcUrl,
        timeoutMs: SIMULATE_TIMEOUT_MS,
        attempts: SIMULATE_ATTEMPTS,
      }),
      screen: createRegistryScreener({
        rpcUrl,
        contractId: TESTNET_REGISTRY_ID,
        timeoutMs: SCREEN_TIMEOUT_MS,
      }),
      resolveToken: createTokenMetadataCache(createRpcTokenResolver({ rpcUrl })),
      ...explainerDeps(),
    };
    depsByRpc.set(rpcUrl, deps);
  }
  return deps;
}

/** Test seam: forget the cached per-network dependencies. */
export function resetWalletScanDeps(): void {
  depsByRpc.clear();
  recheckDepsByRpc.clear();
}

// The re-check before submit (#121) sits on the critical path of every
// signature, so it gets its own, tighter dependency set: one simulate attempt
// with a 2 s deadline, a registry screener with NO TTL cache — the whole
// point is to see a report that landed after the review, and the shared
// screener would cheerfully answer from its 60 s cache — and no explainer
// (the sentence is ignored by the diff and would only add latency). The
// token-metadata cache is shared: decimals do not change between review and
// confirm. Nothing here writes to the shared screener's cache.
export const RECHECK_SIMULATE_TIMEOUT_MS = 2_000;
export const RECHECK_SCREEN_TIMEOUT_MS = 2_000;
const recheckDepsByRpc = new Map<string, PipelineDeps>();

export function recheckDepsFor(rpcUrl: string): PipelineDeps {
  let deps = recheckDepsByRpc.get(rpcUrl);
  if (!deps) {
    deps = {
      simulate: createRpcSimulator({ rpcUrl, timeoutMs: RECHECK_SIMULATE_TIMEOUT_MS, attempts: 1 }),
      screen: createRegistryScreener({
        rpcUrl,
        contractId: TESTNET_REGISTRY_ID,
        timeoutMs: RECHECK_SCREEN_TIMEOUT_MS,
        ttlMs: 0,
      }),
      resolveToken: depsFor(rpcUrl).resolveToken,
    };
    recheckDepsByRpc.set(rpcUrl, deps);
  }
  return deps;
}

// `ScanResult` → the legacy `ScanVerdict` the screens render. Every field the
// UI reads is mapped; nothing is invented. `tier` keeps its old meaning of
// "which layer produced the sentence": 2 when the hosted explainer's prose
// was used, 1 for the deterministic pipeline's own sentence. (Legacy used 0
// for a heuristic low — the pipeline always did the full analysis.)
export function toScanVerdict(result: ScanResult, latencyMs: number): ScanVerdict {
  const aiSentence = __FEATURE_SCANNER_AI__ && result.explanationSource === 'explainer';
  return {
    risk: result.risk,
    action: result.action,
    reasons: result.reasons.map((r) => ({ ...r })),
    explanation: result.explanation,
    checkedBy: 'Lantern',
    tier: aiSentence ? 2 : 1,
    latencyMs: Math.max(0, Math.round(latencyMs)),
    registry: 'checked',
    screening: result.screen.answers.map((a) => ({ address: a.address, answer: a.answer })),
    net: result.effects.net.map((n) => ({ ...n, asset: { ...n.asset } })),
    approvals: result.effects.approvals.map((a) => ({ ...a, asset: { ...a.asset } })),
  };
}

// The sentence every review renders, on both the allow and the callout path,
// so the absence of registry screening is stated wherever the verdict is.
export const REGISTRY_UNAVAILABLE_SENTENCE = 'Registry screening is not available on Mainnet.';

export function withoutRegistry(v: ScanVerdict): ScanVerdict {
  return { ...v, registry: 'unavailable', explanation: `${v.explanation} ${REGISTRY_UNAVAILABLE_SENTENCE}` };
}

export function usesLegacy(input: WalletScanInput): boolean {
  if (input.context.network === 'PUBLIC') return true;
  if (__FEATURE_DEMO_AFFORDANCES__ && input.context.forceScenario) return true;
  return false;
}

/**
 * Scan a transaction the wallet is about to ask the user to sign.
 * Resolves to the same `ScanVerdict` shape `scan()` returned, so the review
 * screens are unchanged apart from awaiting it. Never throws: a pipeline
 * failure is a fail-closed verdict, not an exception.
 *
 * `depsOverride` is a test seam (recorded simulations, stub screeners); the
 * wallet never passes it.
 */
export async function scanTx(
  input: WalletScanInput,
  depsOverride?: PipelineDeps,
): Promise<ScanVerdict> {
  if (usesLegacy(input)) {
    const legacy = scan({ xdr: input.xdr, networkPassphrase: input.networkPassphrase, context: input.context });
    return input.context.network === 'PUBLIC' ? withoutRegistry(legacy) : legacy;
  }
  const started = performance.now();
  // No RPC (a network without Soroban and no override) → the pipeline's
  // ingest fails closed with `simulation_unavailable` for Soroban
  // transactions and the screener is absent, so every counterparty is
  // `unknown`. Never a silent clean.
  const deps = depsOverride ?? (input.rpcUrl ? depsFor(input.rpcUrl) : explainerDeps());
  const result = await runPipeline(
    { xdr: input.xdr, networkPassphrase: input.networkPassphrase, context: input.context },
    deps,
  );
  return toScanVerdict(result, performance.now() - started);
}
