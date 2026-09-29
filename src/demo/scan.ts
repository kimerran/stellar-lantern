// The playground's scan path (#184): turn a pasted envelope or a composed
// payment into an XDR, and run the same six-stage `runPipeline` the wallet
// runs since #84, against testnet only. Framework-free so the rules the page
// must keep (a malformed paste is a sentence, not a stack trace; `unknown`
// screening is never clean; the summary says where it came from) are unit
// tested without a browser. Every network call goes through injectable deps.

import { Account, Asset, BASE_FEE, FeeBumpTransaction, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  runPipeline,
  createRegistryScreener,
  createRpcSimulator,
  createRpcTokenResolver,
  createTokenMetadataCache,
  TESTNET_REGISTRY_ID,
  type PipelineDeps,
  type ScanResult,
  type ScreenAnswer,
} from '@lantern/scanner';
import { NETWORKS } from '@shared/constants';

export const DEMO_NETWORK = NETWORKS.TESTNET;
const RPC_URL = DEMO_NETWORK.sorobanRpcUrl as string;

// The wallet's budgets (src/core/scan/wallet.ts), so a visitor waits no longer
// than a wallet user does and a dead RPC fails closed instead of hanging.
const SIMULATE_TIMEOUT_MS = 3_500;
const SCREEN_TIMEOUT_MS = 3_000;
const HORIZON_TIMEOUT_MS = 5_000;

let liveDeps: PipelineDeps | null = null;

/** The live testnet dependencies, built once per page so the screener's and
 *  the token resolver's caches survive between scans. No explainer yet: the
 *  hosted one waits on the lantern-api origin allow-list (#184). */
export function demoDeps(): PipelineDeps {
  liveDeps ??= {
    simulate: createRpcSimulator({ rpcUrl: RPC_URL, timeoutMs: SIMULATE_TIMEOUT_MS, attempts: 2 }),
    screen: createRegistryScreener({ rpcUrl: RPC_URL, contractId: TESTNET_REGISTRY_ID, timeoutMs: SCREEN_TIMEOUT_MS }),
    resolveToken: createTokenMetadataCache(createRpcTokenResolver({ rpcUrl: RPC_URL })),
  };
  return liveDeps;
}

// ── Input ────────────────────────────────────────────────────────────────────

export type Prepared = { ok: true; xdr: string; source: string } | { ok: false; error: string };

/** Validate a pasted base64 envelope. The error is always a readable sentence. */
export function preparePasted(text: string): Prepared {
  const xdr = text.replace(/\s+/g, '');
  if (!xdr) return { ok: false, error: 'Paste a transaction first.' };
  if (!/^[A-Za-z0-9+/]+=*$/.test(xdr)) {
    return { ok: false, error: 'That isn’t a transaction. Paste the base64 transaction envelope (XDR), which starts with “AAAA”.' };
  }
  try {
    const tx = TransactionBuilder.fromXDR(xdr, DEMO_NETWORK.passphrase);
    const source = tx instanceof FeeBumpTransaction ? tx.innerTransaction.source : tx.source;
    return { ok: true, xdr, source };
  } catch {
    return {
      ok: false,
      error: 'That text couldn’t be read as a Stellar transaction. Check that it was copied whole, with nothing added.',
    };
  }
}

export interface ComposeFields {
  from: string;
  to: string;
  amount: string;
}

/** What a Horizon account lookup can say. `missing` is a 404: not on testnet. */
export type AccountLookup = (address: string) => Promise<{ sequence: string } | 'missing'>;

export const horizonAccount: AccountLookup = async (address) => {
  const res = await fetch(`${DEMO_NETWORK.horizonUrl}/accounts/${address}`, {
    signal: AbortSignal.timeout(HORIZON_TIMEOUT_MS),
  });
  if (res.status === 404) return 'missing';
  if (!res.ok) throw new Error(`Horizon answered ${res.status}`);
  const body = (await res.json()) as { sequence?: unknown };
  if (typeof body.sequence !== 'string') throw new Error('Horizon answered without a sequence number');
  return { sequence: body.sequence };
};

export type Composed =
  | { ok: true; xdr: string; source: string; destinationFunded: boolean }
  | { ok: false; error: string; missingSource?: boolean };

/** Build an unsigned XLM payment. The visitor supplies addresses, never a key. */
export async function composePayment(fields: ComposeFields, lookup: AccountLookup = horizonAccount): Promise<Composed> {
  const from = fields.from.trim();
  const to = fields.to.trim();
  const amount = fields.amount.trim();
  if (!StrKey.isValidEd25519PublicKey(from)) return { ok: false, error: 'The “from” address isn’t a valid Stellar address (G…).' };
  if (!StrKey.isValidEd25519PublicKey(to)) return { ok: false, error: 'The “to” address isn’t a valid Stellar address (G…).' };
  if (from === to) return { ok: false, error: 'The “from” and “to” addresses are the same.' };
  if (!/^\d+(\.\d{1,7})?$/.test(amount) || Number(amount) <= 0) {
    return { ok: false, error: 'Enter an amount of XLM greater than zero, with at most 7 decimal places.' };
  }
  let source: Awaited<ReturnType<AccountLookup>>;
  let destination: Awaited<ReturnType<AccountLookup>>;
  try {
    [source, destination] = await Promise.all([lookup(from), lookup(to)]);
  } catch {
    return { ok: false, error: 'Stellar testnet (Horizon) couldn’t be reached, so the payment couldn’t be built. Try again in a moment.' };
  }
  if (source === 'missing') {
    return {
      ok: false,
      missingSource: true,
      error: 'The “from” account doesn’t exist on testnet, so there is no payment to build. Try one of the examples instead.',
    };
  }
  // The regex above bounds decimals, not magnitude: the SDK throws for an
  // amount past int64 stroops (922337203685.4775807 XLM). Never surface that.
  let xdr: string;
  try {
    xdr = new TransactionBuilder(new Account(from, source.sequence), {
      fee: BASE_FEE,
      networkPassphrase: DEMO_NETWORK.passphrase,
    })
      .addOperation(Operation.payment({ destination: to, asset: Asset.native(), amount }))
      .setTimeout(300)
      .build()
      .toXDR();
  } catch {
    return { ok: false, error: 'That amount is too large for a Stellar payment.' };
  }
  return { ok: true, xdr, source: from, destinationFunded: destination !== 'missing' };
}

// ── Scan ─────────────────────────────────────────────────────────────────────

export interface DemoScan {
  result: ScanResult;
  // Where the sentence came from. `runPipeline` reports 'explainer' when no
  // explainer was configured, because its default IS the rules-based one, so
  // the page decides from what it passed in.
  summarySource: 'explainer' | 'fallback';
  ms: number;
}

export type DemoOutcome = { ok: true; scan: DemoScan } | { ok: false; error: string };

export async function runDemoScan(
  input: { xdr: string; source: string; destinationFunded?: boolean },
  deps: PipelineDeps = demoDeps(),
): Promise<DemoOutcome> {
  const started = performance.now();
  try {
    const result = await runPipeline(
      {
        xdr: input.xdr,
        networkPassphrase: DEMO_NETWORK.passphrase,
        context: {
          network: 'TESTNET',
          fromAddress: input.source,
          ...(input.destinationFunded === undefined ? {} : { destinationFunded: input.destinationFunded }),
        },
      },
      deps,
    );
    return {
      ok: true,
      scan: {
        result,
        summarySource: deps.explain ? result.explanationSource : 'fallback',
        ms: Math.round(performance.now() - started),
      },
    };
  } catch (e) {
    // The pipeline fails closed rather than throwing; this is the backstop.
    const why = e instanceof Error ? e.message : 'unknown error';
    return { ok: false, error: `The scan couldn’t finish (${why}). Nothing was judged safe.` };
  }
}

// ── Screening rows ───────────────────────────────────────────────────────────

export type ScreeningTone = 'flagged' | 'clear' | 'unknown';

export interface ScreeningRow {
  address: string;
  tone: ScreeningTone;
  label: string;
  detail?: string;
}

const UNKNOWN_WHY: Record<string, string> = {
  timeout: 'the registry didn’t answer in time',
  rpc_error: 'the registry couldn’t be reached',
  malformed: 'the registry’s answer couldn’t be read',
  archived: 'the registry entry is archived on the ledger',
  no_registry: 'no registry is configured',
  not_recorded: 'this address isn’t in the offline recording',
};

/** One row per counterparty. `unknown` is its own tone, never `clear`. */
export function screeningRows(answers: ReadonlyArray<{ address: string; answer: ScreenAnswer }>): ScreeningRow[] {
  return answers.map(({ address, answer }) => {
    if (answer.outcome === 'flagged') {
      const e = answer.entry;
      return {
        address,
        tone: 'flagged',
        label: 'Reported in the scam registry',
        ...(e ? { detail: `${e.reason} · ${e.reports} report${e.reports === 1 ? '' : 's'} · ${e.status}` } : {}),
      };
    }
    if (answer.outcome === 'not_flagged') {
      return { address, tone: 'clear', label: 'Not in the scam registry' };
    }
    const why = (answer.reason && UNKNOWN_WHY[answer.reason]) ?? 'the registry couldn’t be checked';
    return { address, tone: 'unknown', label: 'Not checked — unverified', detail: `Couldn’t check: ${why}.` };
  });
}
