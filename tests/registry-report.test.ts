import { describe, expect, it } from 'vitest';
import {
  Address,
  Keypair,
  Networks,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { argToScVal } from '@core/stellar/invoke';
import {
  REGISTRY_REASONS,
  ZERO_EVIDENCE,
  buildReportTx,
  checkReport,
  configFromInstance,
  describeFee,
  evidenceHash,
  formatUnits,
  readReportFee,
  readSubject,
  reasonToScVal,
  registryFor,
} from '@core/registry/report';
import { registryReportEvent, track } from '@core/telemetry/emits';
import { EVENT_SCHEMA } from '@core/telemetry/events';
import { validateEnvelope, validateEvent } from '@core/telemetry/validate';
import { contractInstanceKey, decodeScVal, TESTNET_REGISTRY_ID } from '@lantern/scanner';
import { NETWORKS } from '@shared/constants';
import sendSrc from '../src/popup/screens/Send.tsx?raw';
import appsSrc from '../src/popup/screens/Apps.tsx?raw';
import swapSrc from '../src/popup/screens/Swap.tsx?raw';
import earnSrc from '../src/popup/screens/Earn.tsx?raw';
import guardiansSrc from '../src/popup/screens/Guardians.tsx?raw';
import coSignSrc from '../src/popup/screens/CoSignRecovery.tsx?raw';
import txDetailSrc from '../src/popup/screens/TxDetail.tsx?raw';
import reportSrc from '../src/popup/components/ReportAddress.tsx?raw';
import manifestSrc from '../manifest.config.ts?raw';

const REPORTER = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const SUBJECT = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const TREASURY = 'GA4A2EPXERUUVMBMH3D5OV4ONZ7QXIYKHBSI2ZWZ5HQAIFUMYCQZRSNR';
const ADMIN = 'GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK';
const XLM_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const TESTNET = NETWORKS.TESTNET;

// Recorded once from the SDK and pinned: a unit variant of a #[contracttype]
// enum is `scvVec([scvSymbol(name)])`. If this ever reads as a bare symbol
// or a u32 the invoke fails at simulation with an opaque host error (#120).
const REASON_FIXTURE: Record<(typeof REGISTRY_REASONS)[number], string> = {
  Scam: 'AAAAEAAAAAEAAAABAAAADwAAAARTY2Ft',
  Phishing: 'AAAAEAAAAAEAAAABAAAADwAAAAhQaGlzaGluZw==',
  Drainer: 'AAAAEAAAAAEAAAABAAAADwAAAAdEcmFpbmVyAA==',
  Poisoning: 'AAAAEAAAAAEAAAABAAAADwAAAAlQb2lzb25pbmcAAAA=',
  Mixer: 'AAAAEAAAAAEAAAABAAAADwAAAAVNaXhlcgAAAA==',
  Other: 'AAAAEAAAAAEAAAABAAAADwAAAAVPdGhlcgAAAA==',
};

describe('Reason enum encoding', () => {
  it('encodes every variant as scvVec([scvSymbol(variant)]), against the recorded fixture', () => {
    expect(REGISTRY_REASONS).toEqual(['Scam', 'Phishing', 'Drainer', 'Poisoning', 'Mixer', 'Other']);
    for (const reason of REGISTRY_REASONS) {
      const v = reasonToScVal(reason);
      expect(v.switch().name).toBe('scvVec');
      expect(v.vec()).toHaveLength(1);
      expect(v.vec()![0]!.switch().name).toBe('scvSymbol');
      expect(v.vec()![0]!.sym().toString()).toBe(reason);
      expect(v.toXDR('base64')).toBe(REASON_FIXTURE[reason]);
      // The invoke builder's `enum` arm produces the identical bytes.
      expect(argToScVal({ type: 'enum', value: reason }).toXDR('base64')).toBe(REASON_FIXTURE[reason]);
    }
  });

  it('the enum arm rejects anything that is not a symbol', () => {
    expect(() => argToScVal({ type: 'enum', value: 'not a symbol' })).toThrow(/enum/i);
    expect(() => argToScVal({ type: 'enum', value: 'x'.repeat(33) })).toThrow(/enum/i);
  });
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const footprint = new SorobanDataBuilder().build().toXDR('base64');

// A recorded-shape fetch: Horizon `/accounts/{id}` → sequence, Soroban RPC →
// the JSON-RPC result given. Records every URL + JSON-RPC method it saw.
function fakeFetch(opts: {
  sequence?: string;
  accountStatus?: number;
  simulate?: unknown;
  ledgerEntries?: unknown;
}) {
  const calls: Array<{ url: string; method?: string }> = [];
  const impl = ((url: string, init?: { body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as { method?: string }) : undefined;
    calls.push({ url, ...(body?.method ? { method: body.method } : {}) });
    if (url.includes('/accounts/')) {
      const status = opts.accountStatus ?? 200;
      return Promise.resolve({
        ok: status < 300,
        status,
        json: () => Promise.resolve({ sequence: opts.sequence ?? '1' }),
      });
    }
    const result = body?.method === 'getLedgerEntries' ? opts.ledgerEntries : opts.simulate;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result }),
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

// The registry's instance entry with a `Config` in instance storage, built
// the way the contract lays it out (a map keyed by symbol).
function instanceEntryXdr(config: { admin: string; treasury: string; feeToken: string; fee: bigint }) {
  const sym = (s: string) => xdr.ScVal.scvSymbol(s);
  const entry = (k: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: sym(k), val: v });
  const i128 = (n: bigint) =>
    xdr.ScVal.scvI128(
      new xdr.Int128Parts({
        hi: xdr.Int64.fromString((n >> 64n).toString()),
        lo: xdr.Uint64.fromString((n & ((1n << 64n) - 1n)).toString()),
      }),
    );
  const configVal = xdr.ScVal.scvMap([
    entry('admin', new Address(config.admin).toScVal()),
    entry('fee', i128(config.fee)),
    entry('fee_token', new Address(config.feeToken).toScVal()),
    entry('treasury', new Address(config.treasury).toScVal()),
  ]);
  const instance = new xdr.ScContractInstance({
    executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32)),
    storage: [
      new xdr.ScMapEntry({ key: xdr.ScVal.scvVec([sym('Count')]), val: xdr.ScVal.scvU32(1) }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvVec([sym('Config')]), val: configVal }),
    ],
  });
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: new xdr.ExtensionPoint(0),
      contract: new Address(TESTNET_REGISTRY_ID).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
      val: xdr.ScVal.scvContractInstance(instance),
    }),
  ).toXDR('base64');
}

// ── Guards ──────────────────────────────────────────────────────────────────

describe('checkReport — client-side guards, before anything is built', () => {
  it('blocks reporter === subject with no transaction and no network call', async () => {
    const guard = checkReport({ reporter: REPORTER, subject: REPORTER, network: TESTNET });
    expect(guard).toMatchObject({ ok: false, code: 'self_report' });
    const { impl, calls } = fakeFetch({});
    const r = await buildReportTx({ reporter: REPORTER, subject: REPORTER, reason: 'Scam', network: TESTNET, fetchImpl: impl });
    expect(r).toMatchObject({ ok: false, error: /your own address/i });
    expect(calls).toHaveLength(0);
  });

  it('blocks an invalid subject before build', async () => {
    expect(checkReport({ reporter: REPORTER, subject: 'not-an-address', network: TESTNET })).toMatchObject({
      ok: false,
      code: 'invalid_subject',
    });
    const { impl, calls } = fakeFetch({});
    const r = await buildReportTx({ reporter: REPORTER, subject: 'GABC', reason: 'Scam', network: TESTNET, fetchImpl: impl });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('accepts a contract (C…) subject — the registry keys on Address', () => {
    expect(checkReport({ reporter: REPORTER, subject: XLM_SAC, network: TESTNET })).toEqual({ ok: true });
  });

  it('is absent on PUBLIC: no registry, no build, no fee read', async () => {
    expect(registryFor(NETWORKS.PUBLIC)).toBeNull();
    expect(checkReport({ reporter: REPORTER, subject: SUBJECT, network: NETWORKS.PUBLIC })).toMatchObject({
      ok: false,
      code: 'no_registry',
    });
    const { impl, calls } = fakeFetch({});
    const built = await buildReportTx({ reporter: REPORTER, subject: SUBJECT, reason: 'Scam', network: NETWORKS.PUBLIC, fetchImpl: impl });
    expect(built.ok).toBe(false);
    const fee = await readReportFee({ network: NETWORKS.PUBLIC, fetchImpl: impl });
    expect(fee.ok).toBe(false);
    expect(calls).toHaveLength(0);
    // The component gates on the same predicate, so PUBLIC renders nothing —
    // not a disabled button.
    expect(reportSrc).toMatch(/if \(!registryFor\(network\)\) return null;/);
  });

  it('a Settings RPC override does not turn PUBLIC into a registry network', () => {
    expect(registryFor({ ...NETWORKS.PUBLIC, sorobanRpcUrl: 'https://rpc.example.com' })).toBeNull();
  });
});

// ── Build ───────────────────────────────────────────────────────────────────

describe('buildReportTx — build → simulate → assemble, offline', () => {
  it('produces a ready-to-sign report() invoke with the four typed args', async () => {
    const { impl, calls } = fakeFetch({
      sequence: '4200',
      simulate: { transactionData: footprint, minResourceFee: '12345' },
    });
    const evidence = evidenceHash('lantern-d3-note');
    const r = await buildReportTx({
      reporter: REPORTER,
      subject: SUBJECT,
      reason: 'Phishing',
      evidence,
      network: TESTNET,
      fetchImpl: impl,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Horizon for the sequence, then exactly one simulate on the testnet RPC.
    expect(calls.map((c) => c.method ?? 'horizon')).toEqual(['horizon', 'simulateTransaction']);
    expect(calls[0]!.url).toBe(`${TESTNET.horizonUrl}/accounts/${REPORTER}`);
    expect(calls[1]!.url).toBe(TESTNET.sorobanRpcUrl);

    const tx = TransactionBuilder.fromXDR(r.xdr, Networks.TESTNET) as Transaction;
    expect(tx.source).toBe(REPORTER);
    expect(tx.sequence).toBe('4201');
    expect(tx.fee).toBe(String(100 + 12345));
    const op = tx.operations[0];
    expect(op?.type).toBe('invokeHostFunction');
    if (op?.type !== 'invokeHostFunction') return;
    const inv = op.func.invokeContract();
    expect(Address.fromScAddress(inv.contractAddress()).toString()).toBe(TESTNET_REGISTRY_ID);
    expect(inv.functionName().toString()).toBe('report');
    const args = inv.args().map(decodeScVal);
    expect(args).toHaveLength(4);
    expect(args[0]).toMatchObject({ type: 'address', value: REPORTER });
    expect(args[1]).toMatchObject({ type: 'address', value: SUBJECT });
    // The enum: a one-element vec holding the symbol — never a bare symbol.
    expect(inv.args()[2]!.toXDR('base64')).toBe(REASON_FIXTURE.Phishing);
    expect(inv.args()[3]!.switch().name).toBe('scvBytes');
    expect(Buffer.from(inv.args()[3]!.bytes()).toString('hex')).toBe(evidence);
  });

  it('defaults evidence to 32 zero bytes', async () => {
    const { impl } = fakeFetch({ simulate: { transactionData: footprint, minResourceFee: '1' } });
    const r = await buildReportTx({ reporter: REPORTER, subject: SUBJECT, reason: 'Scam', network: TESTNET, fetchImpl: impl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tx = TransactionBuilder.fromXDR(r.xdr, Networks.TESTNET) as Transaction;
    const op = tx.operations[0];
    if (op?.type !== 'invokeHostFunction') throw new Error('not an invoke');
    const ev = op.func.invokeContract().args()[3]!.bytes();
    expect(ev).toHaveLength(32);
    expect(Buffer.from(ev).toString('hex')).toBe(ZERO_EVIDENCE);
  });

  it('surfaces a simulation failure (the contract would revert) as an error, not an XDR', async () => {
    const { impl } = fakeFetch({ simulate: { error: 'HostError: Error(Contract, #2)' } });
    const r = await buildReportTx({ reporter: REPORTER, subject: SUBJECT, reason: 'Scam', network: TESTNET, fetchImpl: impl });
    expect(r).toMatchObject({ ok: false, error: /Contract, #2/ });
  });

  it('says so when the reporter is not funded', async () => {
    const { impl } = fakeFetch({ accountStatus: 404 });
    const r = await buildReportTx({ reporter: REPORTER, subject: SUBJECT, reason: 'Scam', network: TESTNET, fetchImpl: impl });
    expect(r).toMatchObject({ ok: false, error: /not funded/i });
  });

  it('rejects a malformed evidence hash before any network call', async () => {
    const { impl, calls } = fakeFetch({});
    const r = await buildReportTx({ reporter: REPORTER, subject: SUBJECT, reason: 'Scam', evidence: 'abc', network: TESTNET, fetchImpl: impl });
    expect(r).toMatchObject({ ok: false, error: /32-byte/ });
    expect(calls).toHaveLength(0);
  });
});

describe('evidenceHash', () => {
  it('is sha256 of the UTF-8 note, hex — the D1 smoke script agrees', () => {
    // `printf 'lantern-d1-smoke' | sha256sum`
    expect(evidenceHash('lantern-d1-smoke')).toBe('7f107062713d6b640e0491e374f26314e3d12a1c4e3687959269ae5d32e411d8');
    expect(evidenceHash('')).toHaveLength(64);
  });
});

// ── Fee ─────────────────────────────────────────────────────────────────────

describe('readReportFee — config() without a transaction', () => {
  const entryXdr = instanceEntryXdr({ admin: ADMIN, treasury: TREASURY, feeToken: XLM_SAC, fee: 10_000_000n });

  it('decodes Config from the instance entry', () => {
    expect(configFromInstance(entryXdr)).toEqual({
      admin: ADMIN,
      treasury: TREASURY,
      feeToken: XLM_SAC,
      fee: '10000000',
    });
    expect(configFromInstance('AAAA')).toBeNull();
  });

  it('reads fee + fee_token and describes them in the token units', async () => {
    // First getLedgerEntries: the registry instance. Second: the SAC's
    // instance (token metadata) — answered with a real recorded body shape
    // is overkill here; a missing metadata entry exercises the fallback below.
    let n = 0;
    const impl = ((url: string, init?: { body?: string }) => {
      const body = JSON.parse(init!.body!) as { method: string; params: { keys: string[] } };
      expect(url).toBe(TESTNET.sorobanRpcUrl);
      expect(body.method).toBe('getLedgerEntries');
      n += 1;
      const entries =
        body.params.keys[0] === contractInstanceKey(TESTNET_REGISTRY_ID)
          ? [{ key: body.params.keys[0], xdr: entryXdr }]
          : [];
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: { entries } }) });
    }) as unknown as typeof fetch;
    const r = await readReportFee({ network: TESTNET, fetchImpl: impl });
    expect(n).toBe(2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fee).toMatchObject({ fee: '10000000', feeToken: XLM_SAC, treasury: TREASURY });
    // Token metadata unreadable → base units + contract, never a guessed "1".
    expect(r.fee.code).toBeUndefined();
    expect(describeFee(r.fee)).toBe('10000000 base units of CDLZ…CYSC');
    // With decimals known, the human amount.
    expect(describeFee({ ...r.fee, code: 'XLM', decimals: 7 })).toBe('1 XLM');
  });

  it('is `unknown` — never zero — when the config cannot be read', async () => {
    const { impl } = fakeFetch({ ledgerEntries: { entries: [] } });
    const r = await readReportFee({ network: TESTNET, fetchImpl: impl });
    expect(r).toMatchObject({ ok: false, error: /fee/i });
    const thrower = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    expect(await readReportFee({ network: TESTNET, fetchImpl: thrower })).toMatchObject({ ok: false });
  });
});

describe('formatUnits', () => {
  it('scales exactly and trims', () => {
    expect(formatUnits('10000000', 7)).toBe('1');
    expect(formatUnits('12345000', 7)).toBe('1.2345');
    expect(formatUnits('1', 7)).toBe('0.0000001');
    expect(formatUnits('0', 7)).toBe('0');
    expect(formatUnits('123456789012345678901234567890', 18)).toBe('123456789012.34567890123456789');
  });
});

// ── After submit ────────────────────────────────────────────────────────────

describe('readSubject — the count after the write', () => {
  it('answers not_flagged for an absent entry and unknown on an RPC error', async () => {
    const { impl } = fakeFetch({ ledgerEntries: { entries: [], latestLedger: 10 } });
    expect(await readSubject({ network: TESTNET, subject: SUBJECT, fetchImpl: impl })).toMatchObject({ outcome: 'not_flagged' });
    const thrower = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    expect(await readSubject({ network: TESTNET, subject: SUBJECT, fetchImpl: thrower })).toMatchObject({ outcome: 'unknown' });
    expect(await readSubject({ network: NETWORKS.PUBLIC, subject: SUBJECT })).toMatchObject({ outcome: 'unknown', reason: 'no_registry' });
  });
});

// ── Telemetry ───────────────────────────────────────────────────────────────

describe('registry_report_submitted telemetry', () => {
  it('carries the closed reason and the outcome only, and validates on the wire', () => {
    const e = registryReportEvent('Scam', true);
    expect(e).toEqual({ name: 'registry_report_submitted', props: { reason: 'Scam', ok: true } });
    expect(EVENT_SCHEMA.registry_report_submitted).toEqual({ reason: [...REGISTRY_REASONS], ok: 'boolean' });
    expect(validateEvent({ ...e, ts: 1 })).toBe(true);
    expect(typeof track.registryReport).toBe('function');
  });

  it('the envelope validator drops any event that smuggles a subject, fee or note', () => {
    const base = { installId: '123e4567-e89b-42d3-a456-426614174000', platform: 'extension', appVersion: '0.1.0', network: 'testnet' };
    const ok = { ...base, events: [{ name: 'registry_report_submitted', props: { reason: 'Other', ok: false }, ts: 1 }] };
    expect(validateEnvelope(ok)).toBe(true);
    for (const props of [
      { reason: 'Scam', ok: true, subject: SUBJECT },
      { reason: 'Scam', ok: true, fee: '10000000' },
      { reason: 'Scam', ok: true, note: 'they took my lumens' },
      { reason: SUBJECT, ok: true },
      { reason: 'free text', ok: true },
      { reason: 'Scam' },
    ]) {
      expect(validateEnvelope({ ...base, events: [{ name: 'registry_report_submitted', props, ts: 1 }] })).toBe(false);
    }
  });
});

// ── Wiring ──────────────────────────────────────────────────────────────────

describe('entry points', () => {
  it('every review screen #84 converted (minus the passkey account) and TxDetail mount the report', () => {
    for (const [name, src] of Object.entries({ sendSrc, appsSrc, swapSrc, earnSrc, guardiansSrc, coSignSrc, txDetailSrc })) {
      expect(src, name).toMatch(/<ReportCounterparties/);
    }
  });

  it('the confirmation sheet shows the subject in full, the fee, and the attribution sentence', () => {
    expect(reportSrc).toContain('This is public, permanent, and recorded on-chain against your address.');
    expect(reportSrc).toMatch(/break-all font-mono[^>]*>\{subject\.address\}/);
    expect(reportSrc).toContain('could not read the registry fee');
    expect(reportSrc).toMatch(/charges the fee\s+again/);
    expect(reportSrc).toContain('stays marked as disputed');
  });

  it('the report sheet signs through SIGN_AND_SUBMIT and the RPC origin is a host permission', () => {
    expect(reportSrc).toContain("type: 'SIGN_AND_SUBMIT'");
    expect(manifestSrc).toContain("'https://soroban-testnet.stellar.org/*'");
  });

  it('never persists the note: no storage write in the component', () => {
    expect(reportSrc).not.toMatch(/localStorage|chrome\.storage|setItem|Preferences/);
  });
});

describe('a session keypair can sign the built envelope', () => {
  it('the assembled XDR round-trips through TransactionBuilder.fromXDR + sign', async () => {
    const kp = Keypair.random();
    const { impl } = fakeFetch({ simulate: { transactionData: footprint, minResourceFee: '1' } });
    const r = await buildReportTx({ reporter: kp.publicKey(), subject: SUBJECT, reason: 'Mixer', network: TESTNET, fetchImpl: impl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tx = TransactionBuilder.fromXDR(r.xdr, TESTNET.passphrase);
    tx.sign(kp);
    expect(tx.signatures).toHaveLength(1);
  });
});
