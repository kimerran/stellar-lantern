// LIVE-TESTNET end-to-end proof for the passkey smart account (#53).
//
// Skipped unless LANTERN_LIVE_E2E=1 (CI never hits the live network). Run:
//
//   LANTERN_LIVE_E2E=1 npx vitest run tests/passkey-e2e.live.test.ts
//
// A FAKE authenticator (WebCrypto P-256 signing DER, exactly what a real
// device returns) drives the REAL chain: create a passkey smart account
// (friendbot → wasm upload → CreateContractV2), fund it with XLM via SAC
// transfer, then send XLM back OUT of the smart account authorized only by a
// WebAuthn assertion — prepare → passkey-sign → re-simulate → submit. This
// proves __check_auth verifies our assertions on-chain without needing a
// physical passkey device.
import { describe, expect, it } from 'vitest';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

// Injected by vitest.config.ts from the real environment (the node-polyfills
// plugin shims `process` inside test files, so process.env is unusable here).
declare const __LANTERN_LIVE_E2E__: boolean;
import { createPasskeyAccount } from '@core/passkey/onboard';
import { finalizePasskeyTransfer, preparePasskeyTransfer } from '@core/passkey/transfer';
import type { CredentialsApi } from '@core/passkey/webauthn';
import { assembleInvokeXdr } from '@core/stellar/invoke';
import { buildSacTransferXdr, nativeSacId, sacContractBalance } from '@core/stellar/sac';
import { simulateTransaction } from '@core/stellar/soroban';
import { NETWORKS } from '@shared/constants';

const NETWORK = NETWORKS.TESTNET;
const RP_ID = 'lantern.test';

// --- fake authenticator ------------------------------------------------------

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

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeAuthenticator(opts: { wrongChallenge?: boolean } = {}): Promise<CredentialsApi> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey));
  const credentialId = crypto.getRandomValues(new Uint8Array(16));
  return {
    create: async () =>
      ({
        rawId: Uint8Array.from(credentialId).buffer,
        response: { getPublicKeyAlgorithm: () => -7, getPublicKey: () => spki.buffer },
      }) as unknown as Credential,
    get: async (options) => {
      const asked = new Uint8Array(options.publicKey!.challenge as Uint8Array);
      const challenge = opts.wrongChallenge ? crypto.getRandomValues(new Uint8Array(32)) : asked;
      const clientDataJSON = new TextEncoder().encode(
        JSON.stringify({ type: 'webauthn.get', challenge: b64url(challenge), origin: `https://${RP_ID}` }),
      );
      const authData = new Uint8Array(37);
      authData.set(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(RP_ID))), 0);
      authData[32] = 0x05;
      const cdjHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
      const message = new Uint8Array([...authData, ...cdjHash]);
      const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, message));
      return {
        rawId: Uint8Array.from(credentialId).buffer,
        response: {
          authenticatorData: authData.buffer,
          clientDataJSON: clientDataJSON.buffer,
          signature: rawToDer(raw).buffer,
        },
      } as unknown as Credential;
    },
  };
}

// --- live-network helpers ----------------------------------------------------

async function horizonSubmit(signedXdr: string): Promise<{ hash: string }> {
  const res = await fetch(`${NETWORK.horizonUrl}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `tx=${encodeURIComponent(signedXdr)}`,
  });
  const body = (await res.json()) as {
    hash?: string;
    successful?: boolean;
    extras?: { result_codes?: unknown };
    detail?: string;
  };
  if (!res.ok || !body.hash) {
    throw new Error(`Horizon submit failed: ${JSON.stringify(body.extras?.result_codes ?? body.detail ?? body)}`);
  }
  return { hash: body.hash };
}

async function accountSequence(account: string): Promise<string> {
  const res = await fetch(`${NETWORK.horizonUrl}/accounts/${account}`);
  if (!res.ok) throw new Error(`Account ${account} not found (${res.status}).`);
  const body = (await res.json()) as { sequence: string };
  return body.sequence;
}

async function friendbot(account: string): Promise<void> {
  const res = await fetch(`${NETWORK.friendbotUrl}?addr=${encodeURIComponent(account)}`);
  if (!res.ok) throw new Error(`Friendbot failed (${res.status}).`);
}

/** Poll the smart account's XLM balance until it equals `expected` (the RPC
 *  node can lag Horizon by a ledger or two right after a submit). */
async function waitForBalance(holderContractId: string, expected: bigint): Promise<void> {
  let last: unknown;
  for (let i = 0; i < 15; i++) {
    const res = await sacContractBalance({
      holderContractId,
      networkPassphrase: NETWORK.passphrase,
      rpcUrl: NETWORK.sorobanRpcUrl!,
    });
    last = res;
    if (res.ok && res.stroops === expected) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Balance never reached ${expected}: ${JSON.stringify(last, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
}

/** simulate → assemble → sign → submit for a source-authorized invoke. */
async function submitInvoke(builtXdr: string, signer: Keypair): Promise<string> {
  const sim = await simulateTransaction(builtXdr, { rpcUrl: NETWORK.sorobanRpcUrl! });
  if (!sim.ok) throw new Error(sim.error);
  if (!sim.transactionData) throw new Error('no footprint');
  const assembled = assembleInvokeXdr({
    builtXdr,
    networkPassphrase: NETWORK.passphrase,
    minResourceFee: sim.minResourceFee,
    transactionData: sim.transactionData,
    ...(sim.auth ? { auth: sim.auth } : {}),
  });
  const tx = TransactionBuilder.fromXDR(assembled, NETWORK.passphrase);
  tx.sign(signer);
  return (await horizonSubmit(tx.toXDR())).hash;
}

// --- the proof ---------------------------------------------------------------

describe.runIf(__LANTERN_LIVE_E2E__)('passkey smart account — live testnet', () => {
  it(
    'creates, funds, and passkey-authorizes a transfer out of the smart account',
    { timeout: 300_000 },
    async () => {
      const hashes: Record<string, string> = {};
      const authenticator = await makeAuthenticator();

      // 1. Create the smart account (register → friendbot → upload → deploy).
      const created = await createPasskeyAccount({
        network: NETWORK,
        rpId: RP_ID,
        userName: 'e2e',
        credentials: authenticator,
        submit: async (xdr) => {
          const r = await horizonSubmit(xdr);
          hashes[hashes.deploySetup ? 'deploy' : 'deploySetup'] = r.hash;
          return r;
        },
      });
      expect(created.ok, created.ok ? '' : created.error).toBe(true);
      if (!created.ok) return;
      const account = created.record;
      console.log('smart account:', account.contractId);

      // 2. A separate fee wallet funds the smart account with 100 XLM via SAC.
      const feeKp = Keypair.random();
      await friendbot(feeKp.publicKey());
      hashes.fundIn = await submitInvoke(
        buildSacTransferXdr({
          sacId: nativeSacId(NETWORK.passphrase),
          from: feeKp.publicKey(),
          to: account.contractId,
          amountStroops: '1000000000',
          sourceAccount: feeKp.publicKey(),
          sourceSequence: await accountSequence(feeKp.publicKey()),
          networkPassphrase: NETWORK.passphrase,
        }),
        feeKp,
      );

      await waitForBalance(account.contractId, 1000000000n);

      // 3. Send 25 XLM back OUT — authorized only by the passkey assertion.
      const prepared = await preparePasskeyTransfer({
        contractId: account.contractId,
        destination: feeKp.publicKey(),
        amountStroops: '250000000',
        feeSourceAccount: feeKp.publicKey(),
        feeSourceSequence: await accountSequence(feeKp.publicKey()),
        networkPassphrase: NETWORK.passphrase,
        rpcUrl: NETWORK.sorobanRpcUrl!,
      });
      expect(prepared.ok, prepared.ok ? '' : prepared.error).toBe(true);
      if (!prepared.ok) return;

      const finalized = await finalizePasskeyTransfer({
        preparedXdr: prepared.xdr,
        smartAccountId: account.contractId,
        rpId: account.rpId,
        credentialId: Buffer.from(account.credentialId.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
        signatureExpirationLedger: prepared.latestLedger + 120,
        networkPassphrase: NETWORK.passphrase,
        rpcUrl: NETWORK.sorobanRpcUrl!,
        credentials: authenticator,
      });
      expect(finalized.ok, finalized.ok ? '' : finalized.error).toBe(true);
      if (!finalized.ok) return;

      const outTx = TransactionBuilder.fromXDR(finalized.xdr, NETWORK.passphrase);
      outTx.sign(feeKp);
      hashes.passkeySend = (await horizonSubmit(outTx.toXDR())).hash;

      await waitForBalance(account.contractId, 750000000n);

      // 4. Negative: an assertion over the WRONG challenge dies at re-simulation.
      const evil = await makeAuthenticator({ wrongChallenge: true });
      const prepared2 = await preparePasskeyTransfer({
        contractId: account.contractId,
        destination: feeKp.publicKey(),
        amountStroops: '10000000',
        feeSourceAccount: feeKp.publicKey(),
        feeSourceSequence: await accountSequence(feeKp.publicKey()),
        networkPassphrase: NETWORK.passphrase,
        rpcUrl: NETWORK.sorobanRpcUrl!,
      });
      expect(prepared2.ok).toBe(true);
      if (!prepared2.ok) return;
      const rejected = await finalizePasskeyTransfer({
        preparedXdr: prepared2.xdr,
        smartAccountId: account.contractId,
        rpId: account.rpId,
        credentialId: Buffer.from(account.credentialId.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
        signatureExpirationLedger: prepared2.latestLedger + 120,
        networkPassphrase: NETWORK.passphrase,
        rpcUrl: NETWORK.sorobanRpcUrl!,
        credentials: evil,
      });
      expect(rejected.ok).toBe(false);

      console.log('tx hashes:', JSON.stringify(hashes, null, 2));
    },
  );
});
