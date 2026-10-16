import { describe, it, expect } from 'vitest';
import { runPipeline, type RawSimulation, type ScanResult } from '@lantern/scanner';

// Paiflow's envelopes (#294): what Lantern shows when Paiflow asks it to sign
// a trigger (splitter `distribute`, pipeline `deposit`) or a subscription
// allowance (`approve`). Real testnet XDR and simulations, recorded against
// instances of Paiflow's own contract WASM by
// packages/lantern-scanner/fixtures/record-paiflow.mjs. Offline: the simulate
// dependency answers from the recording only.
interface Fixture {
  name: string;
  networkPassphrase: string;
  source: string;
  xdr: string;
  simulation: RawSimulation;
}

const ON_DISK = import.meta.glob<Fixture>('../packages/lantern-scanner/fixtures/paiflow-*.json', {
  eager: true,
  import: 'default',
});
const byName = Object.fromEntries(Object.values(ON_DISK).map((f) => [f.name, f]));

const USER = 'GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK';
const SPLITTER = 'CDONRKQI3HR526AEK2TYCN7TWWOC2PYT3EWF5IFNXE2V5LOBB2ZPEY27';
const DEPOSIT = 'CAZN6V3TZBLLJXFQW4Q673J23NOOIMVT33FCLIW7H3VKQE36JPTB4UWR';
const SUBSCRIPTION = 'CDQZHL55LRY76ONEBHBAUOLHSYSZ2CSWZ5DXZN3LJKRRVTWBDVDADX4M';
const RECIPIENT_60 = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const RECIPIENT_40 = 'GBVG3DQJNAYAPTB4FKPLL65BUNF76K2TKPTK72LDIAJKRATGRY5BFJBP';

async function scanFixture(name: string): Promise<ScanResult> {
  const f = byName[name];
  if (!f) throw new Error(`no fixture named ${name}`);
  return runPipeline(
    {
      xdr: f.xdr,
      networkPassphrase: f.networkPassphrase,
      context: { network: 'TESTNET', fromAddress: f.source, destinationFunded: true },
    },
    {
      simulate: async (xdr) => {
        if (xdr !== f.xdr) throw new Error('simulate called with an XDR the fixture did not record');
        return f.simulation;
      },
      isFlagged: async () => false,
    },
  );
}

const moved = (r: ScanResult, address: string) =>
  r.effects.observedNet.find((n) => n.address === address);

describe('Paiflow envelopes', () => {
  it('are on disk, with the user as source and a successful simulation', () => {
    expect(Object.keys(byName).sort()).toEqual([
      'paiflow-pipeline-deposit',
      'paiflow-splitter-distribute',
      'paiflow-subscription-approve',
    ]);
    for (const f of Object.values(byName)) {
      expect(f.source).toBe(USER);
      expect((f.simulation as { result?: { error?: unknown } }).result?.error).toBeUndefined();
    }
  });

  it('splitter distribute: simulated, warns as an unverified contract, names the function', async () => {
    const r = await scanFixture('paiflow-splitter-distribute');
    expect(r.simulation.outcome).toBe('ok');
    expect(r.risk).toBe('medium');
    expect(r.reasons.map((x) => x.code)).toEqual(['unverified_contract']);
    expect(r.effects.effects[0]).toMatchObject({
      kind: 'contract_call',
      counterparty: SPLITTER,
      functionName: 'distribute',
    });
    expect(r.explanation).toContain('“distribute”');
  });

  it('splitter distribute: the simulation proves 10 XLM out of the user, 6 and 4 to the recipients', async () => {
    const r = await scanFixture('paiflow-splitter-distribute');
    expect(moved(r, USER)).toMatchObject({ out: '10.0000000', in: '0.0000000' });
    expect(moved(r, RECIPIENT_60)).toMatchObject({ in: '6.0000000' });
    expect(moved(r, RECIPIENT_40)).toMatchObject({ in: '4.0000000' });
  });

  it('pipeline deposit: simulated through the trigger and the splitter it calls', async () => {
    const r = await scanFixture('paiflow-pipeline-deposit');
    expect(r.simulation.outcome).toBe('ok');
    expect(r.risk).toBe('medium');
    expect(r.effects.effects[0]).toMatchObject({ counterparty: DEPOSIT, functionName: 'deposit' });
    expect(r.explanation).toContain('“deposit”');
    // A pipeline trigger, not a lending pool: the wording must not guess (#294).
    expect(r.explanation).toMatch(/^Deposits funds — calls “deposit”/);
    expect(r.explanation).not.toMatch(/lending pool/i);
    expect(moved(r, USER)).toMatchObject({ out: '10.0000000' });
    expect(moved(r, RECIPIENT_60)).toMatchObject({ in: '6.0000000' });
    expect(moved(r, RECIPIENT_40)).toMatchObject({ in: '4.0000000' });
  });

  it('subscription approve: a bounded allowance to the subscription contract, decoded in full', async () => {
    const r = await scanFixture('paiflow-subscription-approve');
    expect(r.simulation.outcome).toBe('ok');
    expect(r.risk).toBe('low');
    expect(r.effects.coverage).toBe('full');
    expect(r.effects.approvals).toEqual([
      expect.objectContaining({
        owner: USER,
        spender: SUBSCRIPTION,
        amountScaled: '60.0000000',
        unlimited: false,
      }),
    ]);
  });
});
