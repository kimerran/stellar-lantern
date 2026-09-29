// The playground's seeded examples (#185). Each one is a committed fixture from
// packages/lantern-scanner/fixtures/, so the XDR a visitor runs (or copies) is
// the same one the scanner's own suite runs. Live first: the example goes
// through the same live pipeline as pasted input. Only when testnet can't be
// reached does it replay the recording, and then it says so. The two are never
// blended silently.

import {
  entryLedgerKey,
  interpretLedgerEntries,
  TESTNET_REGISTRY_ID,
  type PipelineDeps,
  type RawLedgerEntriesBody,
  type RawSimulation,
  type RiskLevel,
  type ScanAction,
  type ScanResult,
  type ScreenLookup,
} from '@lantern/scanner';
import registryRecording from '../../packages/lantern-scanner/fixtures/registry-hot-read.json';
import safePayment from '../../packages/lantern-scanner/fixtures/classic-payment.json';
import toFlagged from '../../packages/lantern-scanner/fixtures/classic-payment-to-flagged.json';
import approve from '../../packages/lantern-scanner/fixtures/sep41-approve.json';
import unknownContract from '../../packages/lantern-scanner/fixtures/unknown-contract.json';
import signerTakeover from '../../packages/lantern-scanner/fixtures/classic-signer-takeover.json';
import accountMerge from '../../packages/lantern-scanner/fixtures/classic-account-merge.json';
import { demoDeps, runDemoScan, type DemoScan } from './scan';

interface Fixture {
  name: string;
  source: string;
  recordedAt: string | null;
  xdr: string;
  simulation: unknown;
}

export interface Example {
  id: string;
  title: string;
  blurb: string;
  fixture: Fixture;
  // What the recording scores. A live answer that differs is shown, flagged.
  expect: { risk: RiskLevel; action?: ScanAction };
  malicious?: true;
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'safe-payment',
    title: 'A safe payment',
    blurb: 'Send 25 XLM to an ordinary testnet account.',
    fixture: safePayment,
    expect: { risk: 'low', action: 'allow' },
  },
  {
    id: 'reported-scammer',
    title: 'Payment to a reported scammer',
    blurb: 'Send 5 XLM to an address reported as a scam in the on-chain registry.',
    fixture: toFlagged,
    expect: { risk: 'high', action: 'block_confirm' },
    malicious: true,
  },
  {
    id: 'unlimited-approval',
    title: 'Unlimited token approval',
    blurb: 'Let a contract spend every token of this kind you hold, for a long time.',
    fixture: approve,
    expect: { risk: 'high' },
  },
  {
    id: 'unverified-contract',
    title: 'An unverified contract',
    blurb: 'Call a function on a contract Lantern doesn’t recognise. This one isn’t even deployed, so the call would fail.',
    fixture: unknownContract,
    // The recorded simulation reverts (no such contract), which is high on
    // its own; `unverified_contract` rides along.
    expect: { risk: 'high', action: 'block_confirm' },
  },
  {
    id: 'signer-takeover',
    title: 'Signer takeover',
    blurb: 'Add someone else’s key as a signer and switch yours off: they now own the account.',
    fixture: signerTakeover,
    expect: { risk: 'high', action: 'block_confirm' },
  },
  {
    id: 'account-merge',
    title: 'Account merge',
    blurb: 'Close the account and send its entire XLM balance to another address.',
    fixture: accountMerge,
    expect: { risk: 'high' },
  },
];

// ── The recording ────────────────────────────────────────────────────────────

const recording = registryRecording as unknown as {
  recordedAt: string;
  keys: Record<string, string>;
  response: RawLedgerEntriesBody;
};
const RECORDED_KEYS = new Set(Object.values(recording.keys));

/** Answer from the recorded registry read. An address the recording didn't
 *  cover is `unknown`, never assumed clean. */
export const recordedScreen: ScreenLookup = async (address) => {
  let key: string;
  try {
    key = entryLedgerKey(TESTNET_REGISTRY_ID, address);
  } catch {
    return { outcome: 'unknown', reason: 'malformed', source: 'recording' };
  }
  if (!RECORDED_KEYS.has(key)) return { outcome: 'unknown', reason: 'not_recorded', source: 'recording' };
  return { ...interpretLedgerEntries(recording.response, key), source: 'recording' };
};

export function cachedDeps(example: Example): PipelineDeps {
  const sim = example.fixture.simulation as RawSimulation | null;
  return {
    ...(sim ? { simulate: async () => sim } : {}),
    screen: recordedScreen,
  };
}

// ── Running one ──────────────────────────────────────────────────────────────

/** Testnet couldn't be reached: a transport failure, not an answer. */
export function liveUnreachable(result: ScanResult): boolean {
  const f = result.simulation.failure;
  if (f === 'rpc_timeout' || f === 'rpc_transport' || f === 'simulation_malformed') return true;
  return result.screen.unknown.some((u) => u.reason === 'rpc_error' || u.reason === 'timeout');
}

export interface Cached {
  simulationRecordedAt: string | null; // null: a classic tx needs no simulation
  registryRecordedAt: string;
}

export type ExampleOutcome =
  | {
      ok: true;
      scan: DemoScan;
      // Absent: a live answer. Present: the recording was replayed.
      cached?: Cached;
      // A live answer that differs from what the recording scores.
      discrepancy?: string;
    }
  | { ok: false; error: string };

export async function runExample(
  example: Example,
  live: PipelineDeps = demoDeps(),
): Promise<ExampleOutcome> {
  const input = { xdr: example.fixture.xdr, source: example.fixture.source };
  const first = await runDemoScan(input, live);
  if (first.ok && !liveUnreachable(first.scan.result)) {
    const { risk, action } = first.scan.result;
    const want = example.expect;
    const differs = risk !== want.risk || (want.action !== undefined && action !== want.action);
    return differs
      ? {
          ok: true,
          scan: first.scan,
          discrepancy: `Live testnet answered ${risk} / ${action}; the recorded example scores ${want.risk}${want.action ? ` / ${want.action}` : ''}. The live answer is shown.`,
        }
      : { ok: true, scan: first.scan };
  }
  const replay = await runDemoScan(input, cachedDeps(example));
  if (!replay.ok) return replay;
  return {
    ok: true,
    scan: replay.scan,
    cached: {
      simulationRecordedAt: example.fixture.simulation ? example.fixture.recordedAt : null,
      registryRecordedAt: recording.recordedAt,
    },
  };
}
