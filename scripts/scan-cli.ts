// Scanner CLI harness (#60): run the D2 pipeline by hand, from a terminal.
// This is the whole CLI minus the machine — see `Io`; scan.ts is the entry.
//
//   npm run scan -- --file packages/lantern-scanner/fixtures/classic-payment.json
//   npm run scan -- --xdr <base64 transaction envelope>
//   npm run scan -- --file <fixture> --json          # the full ScanResult
//   npm run scan -- --file <fixture> --no-ai         # rules-based sentence only
//   npm run scan -- --file <fixture> --offline       # recorded RPC, no network
//
// The CLI is a thin composition over `runPipeline` — the same six stages, the
// same deps the wallet wires (createRpcSimulator, createRegistryScreener,
// createRpcTokenResolver, createHostedExplainer). It never signs and never
// submits: the only RPC methods it can send are simulateTransaction and
// getLedgerEntries, both read-only.
//
// Env (all optional): SOROBAN_RPC_URL (default the public testnet endpoint),
// BLACKLIST_REGISTRY_ID (default the deployed testnet registry),
// LANTERN_AI_API_KEY (direct Anthropic — local dev only), LANTERN_AI_ENDPOINT
// (the Lantern API's /v1/explain; proxy mode, no key on this side),
// LANTERN_AI_MODEL. With neither key nor endpoint the sentence is the
// rules-based one and the output says so — the verdict is identical either
// way, which is the invariant the QA plan checks.
//
// --offline answers RPC from the fixture corpus instead of the network: the
// fixture's own recorded simulation, plus the recorded getLedgerEntries
// bodies in registry-hot-read.json and token-metadata.json. Anything not
// recorded is an RPC failure, exactly as a dead network would be — so the
// pipeline's fail-closed paths are exercised, not bypassed.

import { Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  runPipeline,
  createRpcSimulator,
  createRegistryScreener,
  createRpcTokenResolver,
  createTokenMetadataCache,
  createHostedExplainer,
  TESTNET_REGISTRY_ID,
  UNVERIFIED_LABEL,
  type Explainer,
  type PipelineDeps,
  type RawSimulation,
  type ScanRequest,
  type ScanResult,
  type AssetRef,
} from '@lantern/scanner';

const DEFAULT_RPC = 'https://soroban-testnet.stellar.org';

// Everything the CLI takes from the machine, injected: the node entry
// (scan.ts) passes the real filesystem and env; the test suite passes the
// corpus via import.meta.glob, because vitest's node-polyfills plugin shims
// node:fs and child_process away.
export interface Io {
  // File contents, or null when it does not exist / cannot be read.
  readText: (path: string) => string | null;
  // Every *.json in the fixture corpus, as { name, text }.
  fixtures: () => Array<{ name: string; text: string }>;
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
}

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

// ── Arguments ────────────────────────────────────────────────────────────────

interface Args {
  xdr?: string;
  file?: string;
  json: boolean;
  ai: boolean;
  offline: boolean;
  aiStub?: string;
  rpc: string;
  registry: string;
  network?: 'testnet' | 'mainnet'; // explicit --network; absent = follow the input
  from?: string;
  destinationUnfunded: boolean;
  help: boolean;
}

const USAGE = `Lantern transaction security scanner — CLI harness (#60)

usage: npm run scan -- (--xdr <base64> | --file <path>) [options]

  --xdr <base64>       a transaction envelope XDR
  --file <path>        a fixture JSON from packages/lantern-scanner/fixtures/
                       (bare name accepted: --file classic-payment), or a text
                       file holding one base64 XDR
  --json               print the full ScanResult as JSON, nothing else
  --no-ai              skip the hosted explainer; rules-based sentence only
  --offline            answer RPC from the fixture recordings, never the network
  --rpc <url>          Soroban RPC (env SOROBAN_RPC_URL; default testnet)
  --registry <C…>      blacklist registry contract id (env BLACKLIST_REGISTRY_ID)
  --network <name>     testnet (default) | mainnet — the passphrase for --xdr;
                       a fixture carries its own and must agree
  --from <G…>          the signer's address (default: the transaction source)
  --destination-unfunded
                       tell the verdict the recipient has no history (the CLI
                       does not look it up; omitted = unknown)
  --ai-stub <text>     QA only: an explainer that always answers <text>, to
                       prove the sentence cannot move the verdict (plan §8.3)
  --help

exit status: 0 scan completed (whatever the verdict) · 2 bad arguments or input`;

export function parseArgs(argv: string[], env: Io['env']): Args {
  const a: Args = {
    json: false,
    ai: true,
    offline: false,
    rpc: env.SOROBAN_RPC_URL ?? DEFAULT_RPC,
    registry: env.BLACKLIST_REGISTRY_ID ?? TESTNET_REGISTRY_ID,
    destinationUnfunded: false,
    help: false,
  };
  const next = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]!;
    switch (f) {
      case '--xdr':
        a.xdr = next(i++, f);
        break;
      case '--file':
        a.file = next(i++, f);
        break;
      case '--json':
        a.json = true;
        break;
      case '--no-ai':
        a.ai = false;
        break;
      case '--offline':
        a.offline = true;
        break;
      case '--rpc':
        a.rpc = next(i++, f);
        break;
      case '--registry':
        a.registry = next(i++, f);
        break;
      case '--network': {
        const n = next(i++, f);
        if (n !== 'testnet' && n !== 'mainnet')
          throw new Error(`--network must be testnet or mainnet`);
        a.network = n;
        break;
      }
      case '--from':
        a.from = next(i++, f);
        break;
      case '--destination-unfunded':
        a.destinationUnfunded = true;
        break;
      case '--ai-stub':
        a.aiStub = next(i++, f);
        break;
      case '--help':
      case '-h':
        a.help = true;
        break;
      default:
        throw new Error(`unknown argument ${f}`);
    }
  }
  return a;
}

// ── Input ────────────────────────────────────────────────────────────────────

interface Fixture {
  name: string;
  description?: string;
  networkPassphrase?: string;
  source?: string;
  xdr: string;
  simulation?: RawSimulation | null;
}

type NetworkName = 'testnet' | 'mainnet';
const networkOf = (passphrase: string): NetworkName =>
  passphrase === Networks.PUBLIC ? 'mainnet' : 'testnet';

interface Input {
  label: string;
  xdr: string;
  networkPassphrase: string;
  network: NetworkName; // derived from the passphrase — the single source
  source?: string;
  fixture?: Fixture;
}

const baseName = (p: string) => p.replace(/^.*\//, '');

function parseFixture(text: string, name: string): Fixture | null {
  try {
    const j = JSON.parse(text) as Partial<Fixture>;
    if (j && typeof j === 'object' && typeof j.xdr === 'string') {
      return { ...j, name: j.name ?? name.replace(/\.json$/, ''), xdr: j.xdr };
    }
    return null;
  } catch {
    // A text file with a bare XDR in it.
    const xdr = text.trim();
    return xdr ? { name, xdr } : null;
  }
}

// `--file` is a path, or a bare corpus name (classic-payment).
function readFixture(io: Io, p: string): Fixture | null {
  const text = io.readText(p);
  if (text !== null) return parseFixture(text, baseName(p));
  const want = p.endsWith('.json') ? p : `${p}.json`;
  const hit = io.fixtures().find((f) => f.name === want);
  return hit ? parseFixture(hit.text, hit.name) : null;
}

function loadInput(io: Io, a: Args): Input {
  const flagPassphrase = a.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
  if (a.xdr && a.file) throw new Error('give --xdr or --file, not both');
  if (a.file) {
    const f = readFixture(io, a.file);
    if (!f) throw new Error(`could not read a transaction from ${a.file}`);
    // The fixture's passphrase wins; an explicit --network that disagrees is
    // a mistake, not something to decode under one network and judge under
    // another.
    const networkPassphrase = f.networkPassphrase ?? flagPassphrase;
    const network = networkOf(networkPassphrase);
    if (a.network && a.network !== network) {
      throw new Error(`--network ${a.network} but the fixture ${f.name} is ${network}`);
    }
    return {
      label: `fixture ${f.name}`,
      xdr: f.xdr,
      networkPassphrase,
      network,
      ...(f.source ? { source: f.source } : {}),
      fixture: f,
    };
  }
  if (a.xdr) {
    return {
      label: 'xdr',
      xdr: a.xdr,
      networkPassphrase: flagPassphrase,
      network: networkOf(flagPassphrase),
    };
  }
  throw new Error('nothing to scan: pass --xdr <base64> or --file <path>');
}

// The transaction's source, for `context.fromAddress`. Undecodable is fine
// here: the pipeline's ingest fails closed on its own, this only fills in the
// signer for the effects that do decode.
function sourceOf(xdr: string, passphrase: string): string | undefined {
  try {
    const tx = TransactionBuilder.fromXDR(xdr, passphrase);
    return 'innerTransaction' in tx ? tx.innerTransaction.source : tx.source;
  } catch {
    return undefined;
  }
}

// ── Offline RPC: answered from the recordings, never the network ─────────────

interface LedgerEntriesRecording {
  keys?: string[] | Record<string, string>;
  response: { result?: { entries?: Array<{ key: string; xdr: string }>; latestLedger?: number } };
}

function offlineFetch(io: Io, fixture: Fixture | undefined): typeof fetch {
  const entries = new Map<string, { key: string; xdr: string }>();
  // Every ledger key a recording asked for, present in its response or not:
  // a recorded absence is a real "no entry"; a key never asked for is not.
  const recorded = new Set<string>();
  let latestLedger = 0;
  for (const file of io.fixtures()) {
    try {
      const j = JSON.parse(file.text) as Partial<LedgerEntriesRecording>;
      const r = j.response?.result;
      if (!r || !Array.isArray(r.entries)) continue;
      const asked = j.keys;
      for (const k of Array.isArray(asked) ? asked : Object.values(asked ?? {})) {
        if (typeof k === 'string') recorded.add(k);
      }
      for (const e of r.entries) {
        if (e && typeof e.key === 'string') {
          entries.set(e.key, e);
          recorded.add(e.key);
        }
      }
      if (typeof r.latestLedger === 'number') latestLedger = Math.max(latestLedger, r.latestLedger);
    } catch {
      // not a recording
    }
  }
  const reply = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  return async (_url, init) => {
    const req = JSON.parse(String(init?.body ?? '{}')) as {
      id?: unknown;
      method?: string;
      params?: { keys?: string[]; transaction?: string };
    };
    if (req.method === 'simulateTransaction') {
      if (!fixture?.simulation)
        throw new TypeError('offline: no recorded simulation for this transaction');
      if (req.params?.transaction !== fixture.xdr) {
        throw new TypeError('offline: the recording is for a different transaction');
      }
      return reply(fixture.simulation);
    }
    if (req.method === 'getLedgerEntries') {
      const keys = req.params?.keys ?? [];
      // A key no recording ever asked for is an RPC failure, not an absent
      // entry — otherwise an unrecorded address would screen clean.
      if (keys.some((k) => !recorded.has(k))) {
        return reply({
          jsonrpc: '2.0',
          id: req.id ?? 1,
          error: { code: -32000, message: 'offline: ledger key not recorded' },
        });
      }
      const found = keys
        .map((k) => entries.get(k))
        .filter((e): e is { key: string; xdr: string } => !!e);
      return reply({ jsonrpc: '2.0', id: req.id ?? 1, result: { entries: found, latestLedger } });
    }
    throw new TypeError(`offline: ${req.method ?? 'unknown method'} is not recorded`);
  };
}

// ── Composition ──────────────────────────────────────────────────────────────

interface Wiring {
  deps: PipelineDeps;
  explainerLabel: string; // what the output tells the tester about stage 6
}

function wire(io: Io, a: Args, input: Input): Wiring {
  const fetchImpl = a.offline ? offlineFetch(io, input.fixture) : io.fetchImpl;
  const deps: PipelineDeps = {
    simulate: createRpcSimulator({ rpcUrl: a.rpc, fetchImpl }),
    screen: createRegistryScreener({ rpcUrl: a.rpc, contractId: a.registry, fetchImpl }),
    resolveToken: createTokenMetadataCache(createRpcTokenResolver({ rpcUrl: a.rpc, fetchImpl })),
  };

  if (a.aiStub !== undefined) {
    // A "model" that always answers the given text, behind the real hosted
    // explainer so the sanitiser and the contradiction guard run on it — the
    // hostile-model case from tests/scanner-explain.test.ts, by hand.
    const text = a.aiStub;
    const stubFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    const stub: Explainer = createHostedExplainer({
      mode: 'anthropic',
      apiKey: 'stub',
      fetchImpl: stubFetch,
    });
    return {
      deps: { ...deps, explain: stub },
      explainerLabel: `stub model answering ${JSON.stringify(text)} (--ai-stub)`,
    };
  }
  if (!a.ai) return { deps, explainerLabel: 'rules-based (--no-ai)' };

  const apiKey = io.env.LANTERN_AI_API_KEY ?? '';
  const endpoint = io.env.LANTERN_AI_ENDPOINT ?? '';
  const model = io.env.LANTERN_AI_MODEL;
  if (a.offline) return { deps, explainerLabel: 'rules-based (--offline)' };
  if (apiKey) {
    return {
      deps: {
        ...deps,
        explain: createHostedExplainer({
          mode: 'anthropic',
          apiKey,
          fetchImpl: io.fetchImpl,
          ...(model ? { model } : {}),
        }),
      },
      explainerLabel: `hosted model ${model ?? 'default'} (LANTERN_AI_API_KEY)`,
    };
  }
  if (endpoint) {
    return {
      deps: {
        ...deps,
        explain: createHostedExplainer({
          mode: 'proxy',
          apiKey: '',
          endpoint,
          fetchImpl: io.fetchImpl,
        }),
      },
      explainerLabel: `Lantern API proxy ${endpoint}`,
    };
  }
  return { deps, explainerLabel: 'rules-based (no LANTERN_AI_API_KEY / LANTERN_AI_ENDPOINT set)' };
}

// ── Rendering ────────────────────────────────────────────────────────────────

const short = (addr: string) => (addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr);
const asset = (x: AssetRef) => (x.issuer ? `${x.code}(${short(x.issuer)})` : x.code);

function render(input: Input, a: Args, r: ScanResult, wiring: Wiring, ms: number): string {
  const L: string[] = [];
  const h = (t: string) => L.push('', t.toUpperCase());
  const sim = r.simulation;
  L.push(
    `Lantern scanner · ${input.network} · ${input.label}${a.offline ? ' · OFFLINE (recorded RPC)' : ''}`,
  );
  if (input.fixture?.description) L.push(`  ${input.fixture.description}`);
  const from = r.effects.source?.source ?? sourceOf(input.xdr, input.networkPassphrase);
  L.push(`  signer ${from ?? 'unknown'} · rpc ${a.rpc} · registry ${a.registry}`);

  h('ingest');
  if (sim.ok) {
    L.push(
      `  ok · ${sim.decoded?.operations.length ?? 0} op(s) · ${sim.simulated ? 'simulated via RPC' : 'classic, no simulation needed'}`,
    );
  } else if (sim.outcome === 'unknown') {
    L.push(`  UNKNOWN · ${sim.error ?? 'state archived — cannot be verified until restored'}`);
  } else {
    L.push(`  FAILED · ${sim.failure ?? 'failed'}${sim.error ? ` · ${sim.error}` : ''}`);
  }
  if (sim.auth.length)
    L.push(`  ${sim.auth.length} authorization entr${sim.auth.length === 1 ? 'y' : 'ies'}`);

  h('effects');
  const e = r.effects;
  if (e.effects.length === 0) L.push('  none decoded');
  for (const fx of e.effects) {
    const bits = [fx.kind, `op ${fx.opIndex}`];
    if (fx.functionName) bits.push(`${fx.functionName}()`);
    if (fx.amount) bits.push(`${fx.amount} ${fx.assetCode ?? ''}`.trim());
    if (fx.counterparty) bits.push(`→ ${short(fx.counterparty)}`);
    L.push(`  ${bits.join(' · ')}`);
  }
  for (const d of e.deltas) {
    const amt =
      d.bound === 'total'
        ? 'entire balance'
        : (d.amount ?? `${d.raw ?? '?'} (raw, decimals unknown)`);
    const bound = d.bound === 'exact' || d.bound === 'total' ? '' : ` (${d.bound})`;
    L.push(
      `    ${short(d.address)} ${d.direction === 'out' ? '−' : '+'}${amt} ${asset(d.asset)}${bound}${d.depth ? ` · depth ${d.depth}` : ''}`,
    );
  }
  if (e.net.length) {
    L.push('  net per address');
    for (const n of e.net) {
      const outS = n.outIsTotal ? 'entire balance' : `${n.outUpTo ? '≤' : ''}${n.out}`;
      const inS = n.inIsTotal ? 'entire balance' : `${n.inAtLeast ? '≥' : ''}${n.in}`;
      L.push(`    ${short(n.address)} ${asset(n.asset)}: out ${outS} · in ${inS}`);
    }
  }
  for (const c of e.closes)
    L.push(
      `  CLOSES ${short(c.address)} → everything to ${short(c.destination)} (op ${c.opIndex})`,
    );
  for (const ap of e.approvals) {
    L.push(
      `  APPROVAL ${short(ap.owner)} lets ${short(ap.spender)} spend ${ap.amountScaled ?? `${ap.amount} (raw)`} ${asset(ap.asset)}` +
        ` until ledger ${ap.expirationLedger}${ap.unlimited ? ' · UNLIMITED' : ''}`,
    );
  }
  for (const u of e.unverified) {
    const args = u.args.map((x) =>
      'value' in x ? String(x.value) : 'hex' in x ? `0x${x.hex}` : x.type,
    );
    L.push(
      `  ${UNVERIFIED_LABEL}: ${short(u.contractId)}.${u.functionName}(${args.join(', ')}) · depth ${u.depth}`,
    );
  }
  if (e.observed.length) {
    L.push('  balance changes the simulation observed');
    for (const o of e.observed) {
      L.push(
        `    ${short(o.address)} ${o.direction === 'out' ? '−' : '+'}${o.amount ?? `${o.raw ?? '?'} (raw)`} ${asset(o.asset)}`,
      );
    }
  }
  L.push(`  coverage ${e.coverage}`);

  h('screen');
  L.push(`  outcome ${r.screen.outcome} · checked ${r.screen.checked.length}`);
  for (const hit of r.screen.hits) {
    const en = hit.entry;
    L.push(
      `  FLAGGED ${hit.address} · ${hit.source}` +
        (en
          ? ` · ${en.reason} · ${en.reports} report(s) · status ${en.status} · reporter ${short(en.reporter)}`
          : ''),
    );
  }
  for (const u of r.screen.unknown) L.push(`  UNKNOWN ${short(u.address)} · ${u.reason}`);
  for (const an of r.screen.answers) {
    if (an.answer.outcome === 'not_flagged' && an.answer.entry) {
      L.push(`  not flagged ${short(an.address)} · entry present but ${an.answer.entry.status}`);
    }
  }

  h('verdict');
  L.push(`  risk ${r.risk.toUpperCase()} · action ${r.action.toUpperCase()} · ${r.verdict.scope}`);
  for (const rs of r.reasons) L.push(`  [${rs.severity}] ${rs.code} — ${rs.title}: ${rs.detail}`);
  L.push(`  signals (${r.signals.length})`);
  for (const s of r.signals)
    L.push(`    ${s.stage} · ${s.code}${s.ref ? ` · ${s.ref}` : ''} — ${s.detail}`);

  h('sentence');
  L.push(`  "${r.explanation}"`);
  L.push(`  source: ${r.explanationSource} · explainer: ${wiring.explainerLabel}`);
  L.push('', `scanned in ${ms} ms · nothing was signed or submitted`);
  return L.join('\n');
}

// ── Entry ────────────────────────────────────────────────────────────────────

export async function run(argv: string[], io: Io): Promise<Run> {
  let a: Args;
  try {
    a = parseArgs(argv, io.env);
  } catch (e) {
    return { code: 2, stdout: '', stderr: `scan: ${(e as Error).message}\n\n${USAGE}\n` };
  }
  if (a.help) return { code: 0, stdout: `${USAGE}\n`, stderr: '' };
  let input: Input;
  try {
    input = loadInput(io, a);
  } catch (e) {
    return { code: 2, stdout: '', stderr: `scan: ${(e as Error).message}\n` };
  }
  const from = a.from ?? input.source ?? sourceOf(input.xdr, input.networkPassphrase) ?? '';
  const request: ScanRequest = {
    xdr: input.xdr,
    networkPassphrase: input.networkPassphrase,
    context: {
      network: input.network === 'mainnet' ? 'PUBLIC' : 'TESTNET',
      fromAddress: from,
      // The CLI never looks the destination up: unknown unless the tester
      // says otherwise, so the verdict's `new_account` path stays reachable.
      ...(a.destinationUnfunded ? { destinationFunded: false } : {}),
    },
  };
  const wiring = wire(io, a, input);
  const t0 = Date.now();
  const result = await runPipeline(request, wiring.deps);
  const ms = Date.now() - t0;
  const stdout = a.json
    ? JSON.stringify(
        {
          ...result,
          meta: { input: input.label, offline: a.offline, explainer: wiring.explainerLabel, ms },
        },
        null,
        2,
      )
    : render(input, a, result, wiring, ms);
  return { code: 0, stdout: `${stdout}\n`, stderr: '' };
}
