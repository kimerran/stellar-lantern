// SAC helpers (#53): native SAC id, the Balance(holder) ledger key, contract
// balance reads (via stubbed getLedgerEntries fetch), and the transfer builder.
import { describe, expect, it } from 'vitest';
import { Address, Networks, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import {
  buildSacTransferXdr,
  nativeSacId,
  sacBalanceKeyXdr,
  sacContractBalance,
} from '@core/stellar/sac';

const PASSPHRASE = Networks.TESTNET;
const HOLDER = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';
const DEST = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const RPC = 'https://rpc.example';

type FetchArgs = { url: string; body: unknown };

function jsonFetch(body: unknown, calls?: FetchArgs[]): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    calls?.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
}

function balanceEntryXdr(holder: string, amount: bigint): string {
  const sacId = nativeSacId(PASSPHRASE);
  const hi = amount >> 64n;
  const lo = amount & 0xffffffffffffffffn;
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: new xdr.ExtensionPoint(0),
      contract: new Address(sacId).toScAddress(),
      key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Balance'), new Address(holder).toScVal()]),
      durability: xdr.ContractDataDurability.persistent(),
      val: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('amount'),
          val: xdr.ScVal.scvI128(
            new xdr.Int128Parts({
              hi: xdr.Int64.fromString(hi.toString()),
              lo: xdr.Uint64.fromString(lo.toString()),
            }),
          ),
        }),
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('authorized'), val: xdr.ScVal.scvBool(true) }),
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('clamped'), val: xdr.ScVal.scvBool(false) }),
      ]),
    }),
  ).toXDR('base64');
}

describe('nativeSacId / sacBalanceKeyXdr', () => {
  it('returns a valid C… id that differs per network', () => {
    const testnet = nativeSacId(PASSPHRASE);
    expect(StrKey.isValidContract(testnet)).toBe(true);
    expect(nativeSacId(Networks.PUBLIC)).not.toBe(testnet);
  });

  it('builds a persistent Balance(holder) contract-data key on the SAC', () => {
    const key = xdr.LedgerKey.fromXDR(sacBalanceKeyXdr(nativeSacId(PASSPHRASE), HOLDER), 'base64');
    const data = key.contractData();
    expect(Address.fromScAddress(data.contract()).toString()).toBe(nativeSacId(PASSPHRASE));
    expect(data.durability().name).toBe('persistent');
    const vec = data.key().vec()!;
    expect(vec[0]!.sym().toString()).toBe('Balance');
    expect(Address.fromScVal(vec[1]!).toString()).toBe(HOLDER);
  });

  it('rejects invalid ids', () => {
    expect(() => sacBalanceKeyXdr('nope', HOLDER)).toThrow(/SAC/);
    expect(() => sacBalanceKeyXdr(nativeSacId(PASSPHRASE), DEST)).toThrow(/holder/);
  });
});

describe('sacContractBalance', () => {
  it('parses the amount out of a present balance entry', async () => {
    const calls: FetchArgs[] = [];
    const key = sacBalanceKeyXdr(nativeSacId(PASSPHRASE), HOLDER);
    const res = await sacContractBalance({
      holderContractId: HOLDER,
      networkPassphrase: PASSPHRASE,
      rpcUrl: RPC,
      fetchImpl: jsonFetch(
        { jsonrpc: '2.0', id: 1, result: { entries: [{ key, xdr: balanceEntryXdr(HOLDER, 123456789n) }] } },
        calls,
      ),
    });
    expect(res).toEqual({ ok: true, stroops: 123456789n });
    expect((calls[0]!.body as { method: string }).method).toBe('getLedgerEntries');
  });

  it('treats a missing entry as a zero balance', async () => {
    const res = await sacContractBalance({
      holderContractId: HOLDER,
      networkPassphrase: PASSPHRASE,
      rpcUrl: RPC,
      fetchImpl: jsonFetch({ jsonrpc: '2.0', id: 1, result: { entries: [] } }),
    });
    expect(res).toEqual({ ok: true, stroops: 0n });
  });

  it('surfaces RPC errors and malformed entries', async () => {
    const err = await sacContractBalance({
      holderContractId: HOLDER,
      networkPassphrase: PASSPHRASE,
      rpcUrl: RPC,
      fetchImpl: jsonFetch({ jsonrpc: '2.0', id: 1, error: { message: 'boom' } }),
    });
    expect(err).toEqual({ ok: false, error: 'boom' });

    const bad = await sacContractBalance({
      holderContractId: HOLDER,
      networkPassphrase: PASSPHRASE,
      rpcUrl: RPC,
      fetchImpl: jsonFetch({ jsonrpc: '2.0', id: 1, result: { entries: [{ key: 'k', xdr: 'not-xdr' }] } }),
    });
    expect(bad.ok).toBe(false);
  });
});

describe('buildSacTransferXdr', () => {
  const params = {
    sacId: nativeSacId(PASSPHRASE),
    from: HOLDER,
    to: DEST,
    amountStroops: '10000000',
    sourceAccount: DEST,
    sourceSequence: '3',
    networkPassphrase: PASSPHRASE,
  };

  it('builds transfer(from, to, i128 amount) on the SAC', () => {
    const tx = TransactionBuilder.fromXDR(buildSacTransferXdr(params), PASSPHRASE);
    if ('innerTransaction' in tx) throw new Error('unexpected fee-bump');
    const args = tx
      .toEnvelope()
      .v1()
      .tx()
      .operations()[0]!
      .body()
      .invokeHostFunctionOp()
      .hostFunction()
      .invokeContract();
    expect(Address.fromScAddress(args.contractAddress()).toString()).toBe(params.sacId);
    expect(args.functionName().toString()).toBe('transfer');
    expect(Address.fromScVal(args.args()[0]!).toString()).toBe(HOLDER);
    expect(Address.fromScVal(args.args()[1]!).toString()).toBe(DEST);
    expect(args.args()[2]!.switch().name).toBe('scvI128');
    expect(args.args()[2]!.i128().lo().toString()).toBe('10000000');
  });

  it('rejects bad amounts and addresses', () => {
    expect(() => buildSacTransferXdr({ ...params, amountStroops: '0' })).toThrow(/range/);
    expect(() => buildSacTransferXdr({ ...params, amountStroops: '1.5' })).toThrow(/integer/);
    expect(() => buildSacTransferXdr({ ...params, amountStroops: '-3' })).toThrow(/integer/);
    expect(() => buildSacTransferXdr({ ...params, to: 'junk' })).toThrow(/destination/);
    expect(() => buildSacTransferXdr({ ...params, sacId: DEST })).toThrow(/SAC/);
  });
});
