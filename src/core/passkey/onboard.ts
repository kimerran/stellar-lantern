// No-mnemonic passkey onboarding (#53): registered passkey → live smart
// account, with no seed phrase generated, displayed, or stored — ever. The
// on-chain half needs a funded fee payer, so on testnet we mint an EPHEMERAL
// deployer keypair, friendbot-fund it, and let it pay for the WASM upload +
// CreateContractV2. The deployer secret never leaves this function's scope and
// is never persisted — losing it loses nothing, because it controls nothing:
// the smart account answers only to the passkey.
//
// Testnet-only by design (friendbot IS the fee sponsor). Mainnet needs a real
// fee-sponsorship channel (e.g. Launchtube) — documented follow-up.
//
// All device/network seams are injectable: `credentials` (WebAuthn),
// `fetchImpl` (friendbot / Horizon / Soroban RPC), `submit` (tx broadcast).

import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import type { NetworkConfig } from '@shared/constants';
import type { PasskeyAccountRecord } from '@shared/types';
import { assembleInvokeXdr } from '@core/stellar/invoke';
import { simulateTransaction } from '@core/stellar/soroban';
import { PASSKEY_ACCOUNT_WASM_BASE64, PASSKEY_ACCOUNT_WASM_HASH_HEX } from './contractWasm';
import {
  buildCreatePasskeyAccountXdr,
  buildUploadWasmXdr,
  passkeySalt,
  predictPasskeyAccountId,
} from './smartAccount';
import { registerPasskey, type CredentialsApi } from './webauthn';

export type OnboardStep = 'register' | 'fund' | 'upload' | 'deploy';

export interface CreatePasskeyAccountParams {
  network: NetworkConfig;
  rpId: string;
  userName: string;
  /** Broadcast a signed tx (the UI routes this through SUBMIT_ONLY). */
  submit: (signedXdr: string) => Promise<{ hash: string }>;
  credentials?: CredentialsApi;
  fetchImpl?: typeof fetch;
  onProgress?: (step: OnboardStep) => void;
}

export type CreatePasskeyAccountResult =
  | { ok: true; record: PasskeyAccountRecord }
  | { ok: false; error: string };

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * The full simulate → assemble → sign → submit tail for one pre-built invoke
 * tx. Throws with a human-readable message on any failure.
 */
async function runInvoke(opts: {
  builtXdr: string;
  rpcUrl: string;
  networkPassphrase: string;
  signer: Keypair;
  submit: (signedXdr: string) => Promise<{ hash: string }>;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const sim = await simulateTransaction(opts.builtXdr, {
    rpcUrl: opts.rpcUrl,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
  if (!sim.ok) throw new Error(sim.error);
  if (!sim.transactionData) throw new Error('Simulation returned no footprint data.');
  const assembled = assembleInvokeXdr({
    builtXdr: opts.builtXdr,
    networkPassphrase: opts.networkPassphrase,
    minResourceFee: sim.minResourceFee,
    transactionData: sim.transactionData,
    ...(sim.auth ? { auth: sim.auth } : {}),
  });
  const tx = TransactionBuilder.fromXDR(assembled, opts.networkPassphrase);
  tx.sign(opts.signer);
  const { hash } = await opts.submit(tx.toXDR());
  return hash;
}

/**
 * Create a passkey smart account end to end. Returns the (all-public) record
 * to persist, or a single human-readable error. No mnemonic exists at any
 * point in this flow.
 */
export async function createPasskeyAccount(
  params: CreatePasskeyAccountParams,
): Promise<CreatePasskeyAccountResult> {
  const { network } = params;
  if (network.id !== 'TESTNET' || !network.friendbotUrl || !network.sorobanRpcUrl) {
    return { ok: false, error: 'Passkey accounts are only available on Testnet for now.' };
  }
  const fetchImpl = params.fetchImpl ?? fetch;

  try {
    // 1. Register the passkey — the ONLY signer this account will ever have.
    params.onProgress?.('register');
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const passkey = await registerPasskey({
      rpId: params.rpId,
      rpName: 'Lantern',
      userId,
      userName: params.userName,
      challenge,
      ...(params.credentials ? { credentials: params.credentials } : {}),
    });

    // 2. Ephemeral fee payer: random keypair, friendbot-funded, then discarded.
    params.onProgress?.('fund');
    const deployer = Keypair.random();
    const fbRes = await fetchImpl(
      `${network.friendbotUrl}?addr=${encodeURIComponent(deployer.publicKey())}`,
    );
    if (!fbRes.ok) throw new Error('Friendbot funding failed. Try again in a moment.');
    const acctRes = await fetchImpl(`${network.horizonUrl}/accounts/${deployer.publicKey()}`);
    if (!acctRes.ok) throw new Error('Could not load the funding account.');
    const acct = (await acctRes.json()) as { sequence?: unknown };
    if (typeof acct.sequence !== 'string') throw new Error('Could not load the funding account.');
    let sequence = acct.sequence;

    // 3. Upload the contract WASM (idempotent — re-upload just bumps its TTL).
    params.onProgress?.('upload');
    await runInvoke({
      builtXdr: buildUploadWasmXdr({
        sourceAccount: deployer.publicKey(),
        sourceSequence: sequence,
        wasmBase64: PASSKEY_ACCOUNT_WASM_BASE64,
        networkPassphrase: network.passphrase,
      }),
      rpcUrl: network.sorobanRpcUrl,
      networkPassphrase: network.passphrase,
      signer: deployer,
      submit: params.submit,
      ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
    });
    sequence = (BigInt(sequence) + 1n).toString();

    // 4. Deploy the smart account bound to the passkey's public key.
    params.onProgress?.('deploy');
    const salt = passkeySalt(passkey.credentialId);
    await runInvoke({
      builtXdr: buildCreatePasskeyAccountXdr({
        sourceAccount: deployer.publicKey(),
        sourceSequence: sequence,
        wasmHashHex: PASSKEY_ACCOUNT_WASM_HASH_HEX,
        publicKey: passkey.publicKey,
        salt,
        networkPassphrase: network.passphrase,
      }),
      rpcUrl: network.sorobanRpcUrl,
      networkPassphrase: network.passphrase,
      signer: deployer,
      submit: params.submit,
      ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
    });

    const contractId = predictPasskeyAccountId({
      deployer: deployer.publicKey(),
      salt,
      networkPassphrase: network.passphrase,
    });
    return {
      ok: true,
      record: {
        version: 1,
        network: 'TESTNET',
        contractId,
        credentialId: toBase64Url(passkey.credentialId),
        publicKey: toHex(passkey.publicKey),
        rpId: params.rpId,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not create the account.' };
  }
}
