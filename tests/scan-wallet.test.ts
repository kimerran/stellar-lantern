import { describe, it, expect, beforeEach } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import { scan, type RawSimulation, type ScanResult } from '@lantern/scanner';
import {
  scanTx,
  toScanVerdict,
  resetWalletScanDeps,
  withoutRegistry,
  REGISTRY_UNAVAILABLE_SENTENCE,
} from '@core/scan/wallet';
import { badgeStyle } from '../src/popup/components/ScanBadge';
import { decideRecheck, recheckTx } from '@core/scan/recheck';
import manifestSrc from '../manifest.config.ts?raw';
import sendSrc from '../src/popup/screens/Send.tsx?raw';
import appsSrc from '../src/popup/screens/Apps.tsx?raw';
import swapSrc from '../src/popup/screens/Swap.tsx?raw';
import earnSrc from '../src/popup/screens/Earn.tsx?raw';
import smartSrc from '../src/popup/screens/SmartAccount.tsx?raw';
import releaseYml from '../.github/workflows/release.yml?raw';
import androidYml from '../.github/workflows/android.yml?raw';
import envExample from '../.env.example?raw';

// The wallet's adapter onto the D2 pipeline (#84): the seven review screens
// await `scanTx()` and render the same `ScanVerdict` shape they always did.
// Everything here runs offline — recorded simulations and stub screeners.

interface Fixture {
  name: string;
  networkPassphrase: string;
  source: string;
  xdr: string;
  simulation: RawSimulation | null;
}
const ON_DISK = import.meta.glob<Fixture>('../packages/lantern-scanner/fixtures/*.json', {
  eager: true,
  import: 'default',
});
function fixture(name: string): Fixture {
  for (const [path, value] of Object.entries(ON_DISK)) {
    if (path.endsWith(`/${name}.json`) && typeof value.xdr === 'string') return value;
  }
  throw new Error(`no fixture named ${name}`);
}
const recorded = (f: Fixture) => async (xdr: string) => {
  if (xdr !== f.xdr) throw new Error('unexpected XDR');
  if (!f.simulation) throw new Error('no recorded simulation');
  return f.simulation;
};
const FLAGGED = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const notFlagged = async (_a: string) => ({ outcome: 'not_flagged' as const, source: 'stub' });
const flagged = async (address: string) =>
  address === FLAGGED
    ? {
        outcome: 'flagged' as const,
        source: 'registry',
        entry: {
          subject: FLAGGED,
          reporter: 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57',
          reason: 'Scam',
          status: 'Active' as const,
          reports: 3,
          reportedAt: 1,
          updatedAt: 1,
          evidence: '00'.repeat(32),
          index: 0,
        },
      }
    : { outcome: 'not_flagged' as const, source: 'stub' };

function testnetInput(f: Fixture, extra: Record<string, unknown> = {}) {
  return {
    xdr: f.xdr,
    networkPassphrase: f.networkPassphrase,
    rpcUrl: 'https://rpc.invalid',
    context: { network: 'TESTNET' as const, fromAddress: f.source, ...extra },
  };
}

beforeEach(() => resetWalletScanDeps());

describe('toScanVerdict — ScanResult → the shape the screens render', () => {
  const base = {
    signals: [],
    verdict: {} as ScanResult['verdict'],
    simulation: {} as ScanResult['simulation'],
    auth: {} as ScanResult['auth'],
    effects: { net: [], approvals: [] } as unknown as ScanResult['effects'],
    screen: { answers: [] } as unknown as ScanResult['screen'],
  };

  it('maps a low result', () => {
    const v = toScanVerdict(
      {
        ...base,
        risk: 'low',
        action: 'allow',
        reasons: [],
        explanation: 'This sends 25 XLM.',
        explanationSource: 'fallback',
      },
      412.6,
    );
    expect(v).toEqual({
      risk: 'low',
      action: 'allow',
      reasons: [],
      explanation: 'This sends 25 XLM.',
      checkedBy: 'Lantern',
      tier: 1,
      latencyMs: 413,
      registry: 'checked',
      screening: [],
      net: [],
      approvals: [],
    });
  });

  it("carries stage 4's per-counterparty answers for the one-click report (#120)", () => {
    const answer = { outcome: 'flagged' as const, source: 'registry' };
    const v = toScanVerdict(
      {
        ...base,
        screen: { answers: [{ address: 'GABC', answer }] } as unknown as ScanResult['screen'],
        risk: 'high',
        action: 'block_confirm',
        reasons: [],
        explanation: 'x',
        explanationSource: 'fallback',
      },
      1,
    );
    expect(v.screening).toEqual([{ address: 'GABC', answer }]);
  });

  it('maps a medium result, copying every reason', () => {
    const reason = {
      code: 'new_account',
      severity: 'medium' as const,
      title: 'New',
      detail: 'd',
      ref: 'ops[0]',
    };
    const v = toScanVerdict(
      {
        ...base,
        risk: 'medium',
        action: 'warn',
        reasons: [reason],
        explanation: 'x',
        explanationSource: 'fallback',
      },
      10,
    );
    expect(v.risk).toBe('medium');
    expect(v.action).toBe('warn');
    expect(v.reasons).toEqual([reason]);
    expect(v.reasons[0]).not.toBe(reason); // a copy the UI may hold, not the frozen one
  });

  it('maps a high result', () => {
    const v = toScanVerdict(
      {
        ...base,
        risk: 'high',
        action: 'block_confirm',
        reasons: [
          { code: 'reported_address', severity: 'high', title: 'Reported address', detail: 'd' },
        ],
        explanation: 'x',
        explanationSource: 'explainer',
      },
      0,
    );
    expect(v.risk).toBe('high');
    expect(v.action).toBe('block_confirm');
    expect(v.reasons[0]?.code).toBe('reported_address');
  });

  it('tier is 2 only when the explainer wrote the sentence (flag ON under test)', () => {
    expect(__FEATURE_SCANNER_AI__).toBe(true);
    const r = {
      ...base,
      risk: 'low' as const,
      action: 'allow' as const,
      reasons: [],
      explanation: 'x',
    };
    expect(toScanVerdict({ ...r, explanationSource: 'explainer' }, 1).tier).toBe(2);
    expect(toScanVerdict({ ...r, explanationSource: 'fallback' }, 1).tier).toBe(1);
  });

  it('latency is a real, non-negative integer', () => {
    const r = {
      ...base,
      risk: 'low' as const,
      action: 'allow' as const,
      reasons: [],
      explanation: 'x',
      explanationSource: 'fallback' as const,
    };
    expect(toScanVerdict(r, -3).latencyMs).toBe(0);
    expect(toScanVerdict(r, 1999.5).latencyMs).toBe(2000);
  });
});

describe('scanTx on testnet runs the pipeline', () => {
  it('a payment to the demo flagged address is flagged / high / block_confirm with the registry entry in the callout', async () => {
    const f = fixture('classic-payment-to-flagged');
    const v = await scanTx(testnetInput(f), { simulate: recorded(f), screen: flagged });
    expect(v.risk).toBe('high');
    expect(v.action).toBe('block_confirm');
    const reason = v.reasons.find((r) => r.code === 'reported_address');
    expect(reason?.detail).toContain('Scam');
    expect(reason?.detail).toContain('3 reports');
    expect(reason?.detail).toContain('GDVE');
    expect(v.checkedBy).toBe('Lantern');
  });

  it('a clean payment is low, with a real latency', async () => {
    const f = fixture('classic-payment');
    const v = await scanTx(testnetInput(f, { destinationFunded: true }), {
      simulate: recorded(f),
      screen: notFlagged,
    });
    expect(v.risk).toBe('low');
    expect(v.action).toBe('allow');
    expect(Number.isInteger(v.latencyMs)).toBe(true);
    expect(v.explanation.length).toBeGreaterThan(0);
  });

  it('a registry that cannot be reached is never a clean verdict', async () => {
    const f = fixture('classic-payment');
    const v = await scanTx(testnetInput(f, { destinationFunded: true }), {
      simulate: recorded(f),
      screen: async () => ({
        outcome: 'unknown' as const,
        reason: 'rpc_error',
        source: 'registry',
      }),
    });
    expect(v.risk).not.toBe('low');
    expect(v.reasons.some((r) => r.code === 'screen_unknown')).toBe(true);
  });

  it('with the explainer unreachable the rules-based sentence appears and the verdict is unchanged', async () => {
    const f = fixture('classic-payment-to-flagged');
    const deps = { simulate: recorded(f), screen: flagged };
    const withAi = await scanTx(testnetInput(f), {
      ...deps,
      explain: async () => 'A model wrote this sentence about the transfer.',
    });
    const noAi = await scanTx(testnetInput(f), {
      ...deps,
      explain: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(withAi.tier).toBe(2);
    expect(noAi.tier).toBe(1);
    expect(withAi.explanation).not.toBe(noAi.explanation);
    const decision = ({ risk, action, reasons }: typeof withAi) => ({ risk, action, reasons });
    expect(decision(noAi)).toEqual(decision(withAi));
  });

  it('never throws: an undecodable XDR is a fail-closed high', async () => {
    const v = await scanTx({
      xdr: 'not-a-transaction',
      networkPassphrase: Networks.TESTNET,
      rpcUrl: 'https://rpc.invalid',
      context: {
        network: 'TESTNET',
        fromAddress: 'GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK',
      },
    });
    expect(v.risk).toBe('high');
    expect(v.action).toBe('block_confirm');
  });
});

describe('PUBLIC keeps the legacy scan() path, and never claims a registry check', () => {
  it('returns the legacy verdict marked registry: unavailable, with the sentence saying so', async () => {
    const f = fixture('classic-payment');
    const input = {
      xdr: f.xdr,
      networkPassphrase: Networks.PUBLIC,
      context: { network: 'PUBLIC' as const, fromAddress: f.source, destinationFunded: true },
    };
    // The pipeline is never consulted: a simulate that throws would surface.
    const viaAdapter = await scanTx(input, {
      simulate: async () => {
        throw new Error('pipeline must not run on PUBLIC');
      },
    });
    const legacy = scan(input);
    // Same risk, action and reasons as the legacy engine — the carve-out
    // removes the registry CLAIM, not the review (D3 QA plan §10.1 / §10.3).
    expect(viaAdapter).toEqual(withoutRegistry(legacy));
    expect(viaAdapter.risk).toBe(legacy.risk);
    expect(viaAdapter.action).toBe(legacy.action);
    expect(viaAdapter.reasons).toEqual(legacy.reasons);
    expect(viaAdapter.registry).toBe('unavailable');
    expect(viaAdapter.explanation).toBe(`${legacy.explanation} ${REGISTRY_UNAVAILABLE_SENTENCE}`);
    expect(viaAdapter.screening).toBeUndefined();
  });

  it('the mark survives the re-check before submit — the badge cannot flip back at signing', async () => {
    const f = fixture('classic-payment');
    const input = {
      xdr: f.xdr,
      networkPassphrase: Networks.PUBLIC,
      context: { network: 'PUBLIC' as const, fromAddress: f.source, destinationFunded: true },
    };
    // The real sequence a screen runs: review, then confirm.
    const reviewed = await scanTx(input);
    const result = await recheckTx(reviewed, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const decision = decideRecheck(reviewed, result, false);
    // Nothing changed, so it proceeds — with the mark and the sentence intact.
    expect(decision.proceed).toBe(true);
    expect(result.drift).toEqual({ drifted: false });
    expect(decision.verdict.registry).toBe('unavailable');
    expect(decision.verdict.explanation).toContain(REGISTRY_UNAVAILABLE_SENTENCE);
    expect(badgeStyle(decision.verdict.risk, decision.verdict.registry).label).not.toMatch(
      /checked/i,
    );
  });

  it('a low Mainnet verdict never renders "Checked by Lantern" (§10.1 hard blocker)', () => {
    const mainnet = badgeStyle('low', 'unavailable');
    expect(mainnet.label).toBe('Reviewed — registry not available on Mainnet');
    expect(mainnet.label).not.toMatch(/checked/i);
    // Testnet (registry consulted) keeps the badge; medium/high are about the
    // verdict, not the registry, and are unchanged either way.
    expect(badgeStyle('low', 'checked').label).toBe('Checked by Lantern');
    expect(badgeStyle('low', undefined).label).toBe('Checked by Lantern');
    expect(badgeStyle('high', 'unavailable').label).toBe('High risk — action needed');
    // Every screen that renders the low badge passes the verdict's registry flag.
    for (const [name, src] of Object.entries({ sendSrc, appsSrc, swapSrc, earnSrc, smartSrc })) {
      expect(src, name).toMatch(
        /<ScanBadge risk="low"[^>]*registry=\{[a-zA-Z.]*verdict\.registry\}/,
      );
    }
  });

  it('forceScenario (demo builds) also goes through the legacy engine', async () => {
    const f = fixture('classic-payment');
    const v = await scanTx(
      {
        ...testnetInput(f),
        context: { network: 'TESTNET', fromAddress: f.source, forceScenario: 'high' },
      },
      {
        simulate: async () => {
          throw new Error('pipeline must not run for a forced scenario');
        },
      },
    );
    expect(v.risk).toBe('high');
  });
});

describe('call sites and build plumbing', () => {
  const SCREENS = ['Send', 'Apps', 'Swap', 'Earn', 'Guardians', 'SmartAccount', 'CoSignRecovery'];
  const SRC = import.meta.glob<string>('../src/popup/screens/*.tsx', {
    eager: true,
    query: '?raw',
    import: 'default',
  });
  const screenSrc = (name: string): string => {
    const hit = Object.entries(SRC).find(([p]) => p.endsWith(`/${name}.tsx`));
    if (!hit) throw new Error(`no screen ${name}`);
    return hit[1];
  };

  it('all seven review screens await scanTx() and none imports scan from @core/scan', () => {
    for (const name of SCREENS) {
      const src = screenSrc(name);
      expect(src, name).toMatch(/await scanTx\(/);
      expect(src, name).not.toMatch(/import\s*\{[^}]*\bscan\b[^}]*\}\s*from\s*'@core\/scan'/);
      expect(src, name).not.toMatch(/[^a-zA-Z.]scan\(\{/);
    }
  });

  it('CoSignRecovery holds a busy state across the await so a double tap cannot scan twice', () => {
    const src = screenSrc('CoSignRecovery');
    expect(src).toMatch(/loading=\{reviewing\}/);
    expect(src).toMatch(/if \(reviewing\) return;/);
  });

  it('release and Android builds turn the AI sentence on and point at the same Lantern API', () => {
    const API = 'https://lantern-api-production-3fad.up.railway.app';
    for (const [name, yml] of [
      ['release.yml', releaseYml],
      ['android.yml', androidYml],
    ] as const) {
      expect(yml, name).toMatch(/VITE_FEATURE_SCANNER_AI:\s*'true'/);
      expect(yml, name).toContain(`VITE_LANTERN_API_URL: '${API}'`);
    }
    expect(envExample).toContain('VITE_LANTERN_API_URL=');
  });

  it('the manifest grants the Soroban testnet RPC the scanner simulates and screens against', () => {
    expect(manifestSrc).toContain(`'https://soroban-testnet.stellar.org/*'`);
    expect(manifestSrc).not.toMatch(
      /limited to the Stellar endpoints \(Horizon \+ friendbot\) plus/,
    );
  });
});
