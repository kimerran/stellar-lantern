// No-mnemonic passkey onboarding (#53): registered passkey → funded ephemeral
// deployer → wasm upload → CreateContractV2, fully offline via injected fakes.
import { describe, expect, it } from 'vitest';
import { Networks, SorobanDataBuilder, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { createPasskeyAccount, type OnboardStep } from '@core/passkey/onboard';
import { PASSKEY_ACCOUNT_WASM_HASH_HEX } from '@core/passkey/contractWasm';
import type { CredentialsApi } from '@core/passkey/webauthn';
import { NETWORKS } from '@shared/constants';

const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
const CRED_ID = new Uint8Array([9, 8, 7, 6]);

const fakeCredentials: CredentialsApi = {
  create: async () =>
    ({
      rawId: CRED_ID.buffer,
      response: {
        getPublicKeyAlgorithm: () => -7,
        getPublicKey: () => spki.buffer,
      },
    }) as unknown as Credential,
  get: async () => null,
};

const footprint = new SorobanDataBuilder().build().toXDR('base64');

/** Routed fetch: friendbot, Horizon account, and Soroban RPC simulate. */
function scriptedFetch(opts: { friendbotOk?: boolean; simulateError?: string } = {}) {
  const urls: string[] = [];
  const impl = (async (url: unknown) => {
    const u = String(url);
    urls.push(u);
    if (u.includes('friendbot')) {
      return { ok: opts.friendbotOk ?? true, status: opts.friendbotOk === false ? 400 : 200, json: async () => ({}) };
    }
    if (u.includes('/accounts/')) {
      return { ok: true, status: 200, json: async () => ({ sequence: '1000' }) };
    }
    // Soroban RPC simulate
    return {
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: opts.simulateError
          ? { error: opts.simulateError }
          : { transactionData: footprint, minResourceFee: '500', latestLedger: 12345 },
      }),
    };
  }) as unknown as typeof fetch;
  return { impl, urls };
}

describe('createPasskeyAccount', () => {
  const base = {
    network: NETWORKS.TESTNET,
    rpId: 'lantern.test',
    userName: 'alice',
    credentials: fakeCredentials,
  };

  it('registers, funds, uploads and deploys — returning an all-public record', async () => {
    const { impl } = scriptedFetch();
    const submitted: string[] = [];
    const steps: OnboardStep[] = [];
    const res = await createPasskeyAccount({
      ...base,
      fetchImpl: impl,
      submit: async (signedXdr) => {
        submitted.push(signedXdr);
        return { hash: `hash-${submitted.length}` };
      },
      onProgress: (s) => steps.push(s),
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(steps).toEqual(['register', 'fund', 'upload', 'deploy']);
    expect(res.record.version).toBe(1);
    expect(res.record.network).toBe('TESTNET');
    expect(res.record.contractId).toMatch(/^C/);
    expect(res.record.credentialId).toBe('CQgHBg'); // base64url of [9,8,7,6]
    expect(res.record.publicKey).toMatch(/^04[0-9a-f]{128}$/);
    expect(res.record.rpId).toBe('lantern.test');

    // Two txs submitted: wasm upload, then CreateContractV2 — both signed.
    expect(submitted).toHaveLength(2);
    const [upload, create] = submitted.map((s) => {
      const tx = TransactionBuilder.fromXDR(s, NETWORKS.TESTNET.passphrase);
      if ('innerTransaction' in tx) throw new Error('unexpected fee-bump');
      return tx;
    });
    expect(upload!.signatures).toHaveLength(1);
    expect(create!.signatures).toHaveLength(1);
    const uploadFn = upload!.toEnvelope().v1().tx().operations()[0]!.body().invokeHostFunctionOp().hostFunction();
    expect(uploadFn.switch().name).toBe('hostFunctionTypeUploadContractWasm');
    const createFn = create!.toEnvelope().v1().tx().operations()[0]!.body().invokeHostFunctionOp().hostFunction();
    expect(createFn.switch().name).toBe('hostFunctionTypeCreateContractV2');
    expect(Buffer.from(createFn.createContractV2().executable().wasmHash()).toString('hex')).toBe(
      PASSKEY_ACCOUNT_WASM_HASH_HEX,
    );
    // Sequential sequence numbers from the same deployer.
    expect(create!.source).toBe(upload!.source);
    expect(BigInt(create!.sequence) - BigInt(upload!.sequence)).toBe(1n);
  });

  it('fails cleanly when friendbot funding fails', async () => {
    const { impl } = scriptedFetch({ friendbotOk: false });
    const res = await createPasskeyAccount({
      ...base,
      fetchImpl: impl,
      submit: async () => ({ hash: 'x' }),
    });
    expect(res).toEqual({ ok: false, error: 'Friendbot funding failed. Try again in a moment.' });
  });

  it('surfaces a simulation failure as the error', async () => {
    const { impl } = scriptedFetch({ simulateError: 'HostError: something reverted' });
    const res = await createPasskeyAccount({
      ...base,
      fetchImpl: impl,
      submit: async () => ({ hash: 'x' }),
    });
    expect(res).toEqual({ ok: false, error: 'HostError: something reverted' });
  });

  it('rejects a network without friendbot (mainnet)', async () => {
    const res = await createPasskeyAccount({
      ...base,
      network: NETWORKS.PUBLIC,
      submit: async () => ({ hash: 'x' }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Testnet/);
  });
});
