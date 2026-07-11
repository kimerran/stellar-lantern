// Passkey transfer pipeline (#53): prepare carries the simulation's (unsigned)
// auth entry into the scannable XDR; finalize passkey-signs it, re-simulates
// (enforce mode) and re-assembles with OUR signed entry and the refreshed fee.
import { describe, expect, it } from 'vitest';
import {
  Address,
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { finalizePasskeyTransfer, preparePasskeyTransfer } from '@core/passkey/transfer';
import { nativeSacId } from '@core/stellar/sac';
import type { CredentialsApi } from '@core/passkey/webauthn';

const PASSPHRASE = Networks.TESTNET;
const SMART_ACCOUNT = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';
const DEST = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const FEE_SOURCE = 'GBBM6BKZPEHWYO3E3YKREDPQXMS4VK35YLNU7NFBRI26RAN7GI5POFBB';
const CRED_ID = new Uint8Array([1, 2, 3]);
const RPC = 'https://rpc.example';

const footprint = new SorobanDataBuilder().build().toXDR('base64');

function unsignedAuthEntryXdr(): string {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(SMART_ACCOUNT).toScAddress(),
        nonce: xdr.Int64.fromString('777'),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(nativeSacId(PASSPHRASE)).toScAddress(),
          functionName: 'transfer',
          args: [],
        }),
      ),
      subInvocations: [],
    }),
  }).toXDR('base64');
}

function rpcFetch(results: unknown[]) {
  let call = 0;
  const impl = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: '2.0', id: 1, result: results[Math.min(call++, results.length - 1)] }),
  })) as unknown as typeof fetch;
  return { impl, calls: () => call };
}

function rawToDer(raw: Uint8Array): Uint8Array {
  const derInt = (b: Uint8Array): number[] => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = Array.from(b.subarray(i));
    if ((v[0]! & 0x80) !== 0) v = [0x00, ...v];
    return [0x02, v.length, ...v];
  };
  const content = [...derInt(raw.subarray(0, 32)), ...derInt(raw.subarray(32, 64))];
  return new Uint8Array([0x30, content.length, ...content]);
}

const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);

const fakeAuthenticator: CredentialsApi = {
  create: async () => null,
  get: async (options) => {
    const challenge = new Uint8Array(options.publicKey!.challenge as Uint8Array);
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: Buffer.from(challenge).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
        origin: 'https://lantern.test',
      }),
    );
    const authData = new Uint8Array(37).fill(1);
    const cdjHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
    const message = new Uint8Array([...authData, ...cdjHash]);
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, message));
    return {
      rawId: Uint8Array.from(CRED_ID).buffer,
      response: { authenticatorData: authData.buffer, clientDataJSON: clientDataJSON.buffer, signature: rawToDer(raw).buffer },
    } as unknown as Credential;
  },
};

const prepareParams = {
  contractId: SMART_ACCOUNT,
  destination: DEST,
  amountStroops: '5000000',
  feeSourceAccount: FEE_SOURCE,
  feeSourceSequence: '9',
  networkPassphrase: PASSPHRASE,
  rpcUrl: RPC,
};

describe('preparePasskeyTransfer', () => {
  it('assembles the simulated transfer with its unsigned auth entry', async () => {
    const { impl } = rpcFetch([
      { transactionData: footprint, minResourceFee: '400', latestLedger: 1000, results: [{ auth: [unsignedAuthEntryXdr()] }] },
    ]);
    const res = await preparePasskeyTransfer({ ...prepareParams, fetchImpl: impl });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.latestLedger).toBe(1000);
    const tx = TransactionBuilder.fromXDR(res.xdr, PASSPHRASE);
    if ('innerTransaction' in tx) throw new Error('unexpected fee-bump');
    const auth = tx.toEnvelope().v1().tx().operations()[0]!.body().invokeHostFunctionOp().auth();
    expect(auth).toHaveLength(1);
    expect(Address.fromScAddress(auth[0]!.credentials().address().address()).toString()).toBe(SMART_ACCOUNT);
  });

  it('propagates simulation failures', async () => {
    const { impl } = rpcFetch([{ error: 'HostError: nope' }]);
    const res = await preparePasskeyTransfer({ ...prepareParams, fetchImpl: impl });
    expect(res).toEqual({ ok: false, error: 'HostError: nope' });
  });

  it('rejects an invalid destination before any RPC call', async () => {
    const { impl, calls } = rpcFetch([{}]);
    const res = await preparePasskeyTransfer({ ...prepareParams, destination: 'junk', fetchImpl: impl });
    expect(res.ok).toBe(false);
    expect(calls()).toBe(0);
  });
});

describe('finalizePasskeyTransfer', () => {
  async function prepared(): Promise<string> {
    const { impl } = rpcFetch([
      { transactionData: footprint, minResourceFee: '400', latestLedger: 1000, results: [{ auth: [unsignedAuthEntryXdr()] }] },
    ]);
    const res = await preparePasskeyTransfer({ ...prepareParams, fetchImpl: impl });
    if (!res.ok) throw new Error(res.error);
    return res.xdr;
  }

  it('signs the entry, re-simulates and re-assembles with the refreshed fee', async () => {
    const preparedXdr = await prepared();
    const { impl, calls } = rpcFetch([{ transactionData: footprint, minResourceFee: '999' }]);
    const res = await finalizePasskeyTransfer({
      preparedXdr,
      smartAccountId: SMART_ACCOUNT,
      rpId: 'lantern.test',
      credentialId: CRED_ID,
      signatureExpirationLedger: 1100,
      networkPassphrase: PASSPHRASE,
      rpcUrl: RPC,
      credentials: fakeAuthenticator,
      fetchImpl: impl,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(calls()).toBe(1); // exactly one re-simulation

    const tx = TransactionBuilder.fromXDR(res.xdr, PASSPHRASE);
    if ('innerTransaction' in tx) throw new Error('unexpected fee-bump');
    // Fee reflects the SECOND simulation (100 inclusion + 999 resource).
    expect(tx.fee).toBe('1099');
    const entry = tx.toEnvelope().v1().tx().operations()[0]!.body().invokeHostFunctionOp().auth()[0]!;
    const creds = entry.credentials().address();
    expect(creds.signatureExpirationLedger()).toBe(1100);
    const keysInMap = creds.signature().map()!.map((e) => e.key().sym().toString());
    expect(keysInMap).toEqual(['authenticator_data', 'client_data_json', 'signature']);
  });

  it('fails when the re-simulation rejects the assertion', async () => {
    const preparedXdr = await prepared();
    const { impl } = rpcFetch([{ error: 'HostError: check_auth failed' }]);
    const res = await finalizePasskeyTransfer({
      preparedXdr,
      smartAccountId: SMART_ACCOUNT,
      rpId: 'lantern.test',
      credentialId: CRED_ID,
      signatureExpirationLedger: 1100,
      networkPassphrase: PASSPHRASE,
      rpcUrl: RPC,
      credentials: fakeAuthenticator,
      fetchImpl: impl,
    });
    expect(res).toEqual({ ok: false, error: 'HostError: check_auth failed' });
  });
});
