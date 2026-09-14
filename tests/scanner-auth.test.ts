import { describe, it, expect } from 'vitest';
import { Address, XdrLargeInt, xdr } from '@stellar/stellar-sdk';
import {
  auth,
  ingest,
  runPipeline,
  decodeScVal,
  type AuthCall,
  type RawSimulation,
  type ScanRequest,
  type SimulationResult,
} from '@lantern/scanner';

// Stage 2 — Auth (#53): walk the SorobanAuthorizationEntry tree. Offline: the
// real entries come from the testnet recordings, the three-level tree from
// the synthetic deep-auth fixture (built with SDK constructors, labelled so).

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
  const f = Object.entries(ON_DISK).find(([p]) => p.endsWith(`/${name}.json`))?.[1];
  if (!f) throw new Error(`no fixture ${name}`);
  return f;
}
function requestFor(f: Fixture): ScanRequest {
  return {
    xdr: f.xdr,
    networkPassphrase: f.networkPassphrase,
    context: { network: 'TESTNET', fromAddress: f.source, destinationFunded: true },
  };
}
async function simFor(f: Fixture): Promise<SimulationResult> {
  return ingest(requestFor(f), { simulate: async () => f.simulation! });
}
const sig = (c: AuthCall) => `${c.depth}:${c.functionName}@${c.contractId?.slice(0, 4)}`;

const POOL = 'CC4KSBTTPCKZUYBXB47SSZGXTKO6G23Y6LJOIR6YCOJVTGJZEYJCHBOH';
const XLM_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC_SAC = 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU';
const SPENDER = 'GBVG3DQJNAYAPTB4FKPLL65BUNF76K2TKPTK72LDIAJKRATGRY5BFJBP';

// ── Real recordings ──────────────────────────────────────────────────────────
describe('auth: recorded entries', () => {
  it('a SAC transfer is one source-account entry with one call and decoded args', async () => {
    const f = fixture('sac-transfer');
    const tree = auth(await simFor(f));
    expect(tree.analyzed).toBe(true);
    expect(tree.unparseable).toBe(0);
    expect(tree.entries).toHaveLength(1);
    expect(tree.entries[0]?.credentials).toEqual({ kind: 'source_account' });
    expect(tree.calls.map(sig)).toEqual(['0:transfer@CDLZ']);
    expect(tree.calls[0]?.args).toEqual([
      { type: 'address', value: f.source },
      { type: 'address', value: 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57' },
      { type: 'i128', value: '50000000' },
    ]);
  });

  it('the Blend submit recording surfaces its nested transfer with the amount it moves', async () => {
    const tree = auth(await simFor(fixture('nested-subinvocation')));
    expect(tree.calls.map(sig)).toEqual(['0:submit@CC4K', '1:transfer@CDLZ']);
    expect(tree.nestedCount).toBe(1);
    expect(tree.maxDepth).toBe(1);
    const transfer = tree.calls[1]!;
    expect(transfer.path).toEqual([0]);
    expect(transfer.args[2]).toEqual({ type: 'i128', value: '10000000' });
    // The root's request vector decodes structurally, not as a string.
    const requests = tree.calls[0]!.args[3]!;
    expect(requests.type).toBe('vec');
    if (requests.type !== 'vec') return;
    expect(requests.items[0]?.type).toBe('map');
  });
});

// ── Create-contract entries ──────────────────────────────────────────────────
describe('auth: create-contract entries', () => {
  it('decodes a V2 deployment’s constructor arguments instead of hiding them', () => {
    const create = new xdr.CreateContractArgsV2({
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: new Address(SPENDER).toScAddress(),
          salt: Buffer.alloc(32),
        }),
      ),
      executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32)),
      constructorArgs: [new XdrLargeInt('i128', '42').toScVal()],
    });
    const entry = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function:
          xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(create),
        subInvocations: [],
      }),
    });
    const sim: SimulationResult = {
      ok: true,
      outcome: 'ok',
      decoded: null,
      simulated: true,
      auth: [entry.toXDR('base64')],
      footprint: { readOnly: [], readWrite: [] },
      events: [],
    };
    const tree = auth(sim);
    expect(tree.unparseable).toBe(0);
    expect(tree.calls).toHaveLength(1);
    expect(tree.calls[0]?.kind).toBe('create_contract');
    expect(tree.calls[0]?.args).toEqual([{ type: 'i128', value: '42' }]);
  });
});

// ── Three levels deep, both credential kinds ─────────────────────────────────
describe('auth: deep tree (synthetic fixture)', () => {
  it('flattens every call in pre-order with the correct depth and path', async () => {
    const tree = auth(await simFor(fixture('deep-auth')));
    expect(tree.unparseable).toBe(0);
    expect(tree.entries).toHaveLength(2);
    expect(tree.calls.map(sig)).toEqual([
      '0:submit@CC4K',
      '1:transfer@CDLZ',
      '2:transfer@CAQC',
      '1:approve@CDLZ',
      '0:set_metadata@CAQC',
    ]);
    expect(tree.calls.map((c) => c.path)).toEqual([[], [0], [0, 0], [1], []]);
    expect(tree.calls.map((c) => c.entryIndex)).toEqual([0, 0, 0, 0, 1]);
    expect(tree.nestedCount).toBe(3);
    expect(tree.maxDepth).toBe(2);
    // The depth-2 transfer is fully visible: who, to whom, how much.
    const deep = tree.calls[2]!;
    expect(deep.contractId).toBe(USDC_SAC);
    expect(deep.args).toEqual([
      { type: 'address', value: fixture('deep-auth').source },
      { type: 'address', value: SPENDER },
      { type: 'i128', value: '-5' },
    ]);
  });

  it('distinguishes address credentials (with nonce + expiry) from source-account credentials', async () => {
    const tree = auth(await simFor(fixture('deep-auth')));
    expect(tree.entries[0]?.credentials).toEqual({
      kind: 'address',
      address: fixture('deep-auth').source,
      nonce: '-1234567890123',
      signatureExpirationLedger: 4_700_000,
    });
    expect(tree.entries[1]?.credentials).toEqual({ kind: 'source_account' });
    // Every flattened call carries its entry's credentials.
    expect(tree.calls.slice(0, 4).every((c) => c.credentials.kind === 'address')).toBe(true);
    expect(tree.calls[4]?.credentials.kind).toBe('source_account');
  });

  it('the tree shape matches the flattening', async () => {
    const tree = auth(await simFor(fixture('deep-auth')));
    const root = tree.roots[0]!;
    expect(root.functionName).toBe('submit');
    expect(root.children.map((c) => c.functionName)).toEqual(['transfer', 'approve']);
    expect(root.children[0]?.children[0]?.functionName).toBe('transfer');
    expect(root.children[0]?.children[0]?.depth).toBe(2);
    expect(root.contractId).toBe(POOL);
    expect(root.children[0]?.contractId).toBe(XLM_SAC);
  });
});

// ── Fail closed on an unreadable entry ───────────────────────────────────────
describe('auth: unparseable entries', () => {
  function withBadEntry(f: Fixture, bad: string, where: 'append' | 'replace'): RawSimulation {
    const first = (f.simulation!.result!.results as Array<{ auth: string[] }>)[0]!;
    const authList = where === 'append' ? [...first.auth, bad] : [bad];
    return {
      ...f.simulation!,
      result: { ...f.simulation!.result, results: [{ ...first, auth: authList }] },
    };
  }

  it('a truncated entry is counted, and the good entries are still walked', async () => {
    const f = fixture('nested-subinvocation');
    const good = (f.simulation!.result!.results as Array<{ auth: string[] }>)[0]!.auth[0]!;
    const truncated = good.slice(0, Math.floor(good.length / 2));
    const request = requestFor(f);
    const sim = await ingest(request, {
      simulate: async () => withBadEntry(f, truncated, 'append'),
    });
    const tree = auth(sim);
    expect(tree.unparseable).toBe(1);
    expect(tree.entries).toHaveLength(1);
    expect(tree.calls.map(sig)).toEqual(['0:submit@CC4K', '1:transfer@CDLZ']);
  });

  it('is high / block_confirm with auth_unreadable — and the result is not an empty tree', async () => {
    const f = fixture('nested-subinvocation');
    const request = requestFor(f);
    const result = await runPipeline(request, {
      simulate: async () => withBadEntry(f, 'bm90IHhkcg==', 'append'),
    });
    expect(result.risk).toBe('high');
    expect(result.action).toBe('block_confirm');
    expect(result.reasons.find((r) => r.code === 'auth_unreadable')?.severity).toBe('high');
    expect(result.auth.unparseable).toBe(1);
    expect(result.auth.calls.length).toBeGreaterThan(0);
  });

  it('when the ONLY entry is unreadable, the empty call list is never read as "authorises nothing"', async () => {
    const f = fixture('sac-transfer');
    const request = requestFor(f);
    const result = await runPipeline(request, {
      simulate: async () => withBadEntry(f, 'AAAA', 'replace'),
    });
    expect(result.auth.calls).toEqual([]);
    expect(result.auth.unparseable).toBe(1);
    expect(result.risk).toBe('high');
    expect(result.action).toBe('block_confirm');
    expect(result.reasons.map((r) => r.code)).toContain('auth_unreadable');
    expect(result.signals.find((s) => s.stage === 'auth')?.code).toBe('fail_closed');
  });
});

// ── ScVal rendering: lossless for the token-interface types ──────────────────
describe('decodeScVal', () => {
  const MAX_I128 = '170141183460469231731687303715884105727';
  const MIN_I128 = '-170141183460469231731687303715884105728';
  const MAX_U128 = '340282366920938463463374607431768211455';

  it('Address (G… and C…)', () => {
    expect(decodeScVal(new Address(SPENDER).toScVal())).toEqual({
      type: 'address',
      value: SPENDER,
    });
    expect(decodeScVal(new Address(XLM_SAC).toScVal())).toEqual({
      type: 'address',
      value: XLM_SAC,
    });
  });

  it('i128 / u128 at the extremes, as decimal strings', () => {
    for (const v of ['0', '1', '-1', '-5', MAX_I128, MIN_I128]) {
      expect(decodeScVal(new XdrLargeInt('i128', v).toScVal())).toEqual({ type: 'i128', value: v });
    }
    for (const v of ['0', MAX_U128]) {
      expect(decodeScVal(new XdrLargeInt('u128', v).toScVal())).toEqual({ type: 'u128', value: v });
    }
  });

  it('u32, i32, u64, i64, i256', () => {
    expect(decodeScVal(xdr.ScVal.scvU32(4_000_000))).toEqual({ type: 'u32', value: '4000000' });
    expect(decodeScVal(xdr.ScVal.scvI32(-7))).toEqual({ type: 'i32', value: '-7' });
    expect(decodeScVal(new XdrLargeInt('u64', '18446744073709551615').toScVal())).toEqual({
      type: 'u64',
      value: '18446744073709551615',
    });
    expect(decodeScVal(new XdrLargeInt('i64', '-9223372036854775808').toScVal())).toEqual({
      type: 'i64',
      value: '-9223372036854775808',
    });
    expect(decodeScVal(new XdrLargeInt('i256', '-7').toScVal())).toEqual({
      type: 'i256',
      value: '-7',
    });
  });

  it('Symbol, String, Bytes, Bool, Void', () => {
    expect(decodeScVal(xdr.ScVal.scvSymbol('transfer'))).toEqual({
      type: 'symbol',
      value: 'transfer',
    });
    expect(decodeScVal(xdr.ScVal.scvString('hello'))).toEqual({ type: 'string', value: 'hello' });
    expect(decodeScVal(xdr.ScVal.scvBytes(Buffer.from('0102ff', 'hex')))).toEqual({
      type: 'bytes',
      hex: '0102ff',
    });
    expect(decodeScVal(xdr.ScVal.scvBool(true))).toEqual({ type: 'bool', value: true });
    expect(decodeScVal(xdr.ScVal.scvVoid())).toEqual({ type: 'void' });
  });

  it('Vec and Map keep their structure', () => {
    const v = xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol('a'),
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('amount'),
          val: new XdrLargeInt('i128', '9').toScVal(),
        }),
      ]),
    ]);
    expect(decodeScVal(v)).toEqual({
      type: 'vec',
      items: [
        { type: 'symbol', value: 'a' },
        {
          type: 'map',
          entries: [
            { key: { type: 'symbol', value: 'amount' }, value: { type: 'i128', value: '9' } },
          ],
        },
      ],
    });
  });

  it('a value with no human form is kept as opaque base64, never dropped', () => {
    const nonce = xdr.ScVal.scvLedgerKeyNonce(new xdr.ScNonceKey({ nonce: new xdr.Int64(1) }));
    const d = decodeScVal(nonce);
    expect(d.type).toBe('opaque');
    if (d.type !== 'opaque') return;
    expect(d.xdrType).toBe('scvLedgerKeyNonce');
    expect(xdr.ScVal.fromXDR(d.raw, 'base64').toXDR('base64')).toBe(nonce.toXDR('base64'));
  });
});
