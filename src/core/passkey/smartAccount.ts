// Deploy/bind builders for the passkey smart account (#53). Two host-function
// transactions get a user from "registered a passkey" to "has an on-chain
// account": (1) upload the vendored contract WASM (idempotent — re-uploading
// existing code just bumps its TTL), and (2) CreateContractV2 from that wasm
// hash with the passkey's 65-byte SEC1 public key as the constructor arg. Both
// build *pre-simulation* XDR that feeds the existing simulate → assemble tail
// (soroban.ts / invoke.ts), exactly like every other invoke in this codebase.
//
// Pure/offline — no network here. The deployer is any funded testnet account
// (an ephemeral friendbot-funded keypair in the onboarding flow); the resulting
// contract id is deterministic in (deployer, salt), so `predictPasskeyAccountId`
// tells us the account address before the deploy tx even lands.

import {
  Account,
  Address,
  BASE_FEE,
  hash,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { P256_PUBLIC_KEY_BYTES } from './secp256r1';

const DEFAULT_TIMEOUT_SECS = 180;

function requireAccountId(value: string, what: string): string {
  const trimmed = value.trim();
  if (!StrKey.isValidEd25519PublicKey(trimmed)) {
    throw new Error(`Invalid ${what}: expected a G… account address.`);
  }
  return trimmed;
}

export interface BuildUploadWasmParams {
  sourceAccount: string;
  sourceSequence: string;
  wasmBase64: string;
  networkPassphrase: string;
  fee?: string;
  timeoutSecs?: number;
}

/**
 * Build the *unsigned, pre-simulation* XDR that uploads contract WASM. Feed the
 * result to `simulateTransaction` → `assembleInvokeXdr` before signing.
 */
export function buildUploadWasmXdr(params: BuildUploadWasmParams): string {
  const source = requireAccountId(params.sourceAccount, 'source account');
  const wasm = Buffer.from(params.wasmBase64, 'base64');
  if (wasm.length === 0) throw new Error('Empty contract WASM.');
  return new TransactionBuilder(new Account(source, params.sourceSequence), {
    fee: params.fee || BASE_FEE,
    networkPassphrase: params.networkPassphrase,
  })
    .addOperation(Operation.uploadContractWasm({ wasm }))
    .setTimeout(params.timeoutSecs ?? DEFAULT_TIMEOUT_SECS)
    .build()
    .toXDR();
}

/**
 * The deterministic per-passkey deploy salt: sha256 of the WebAuthn credential
 * id. One passkey → one salt → (per deployer) one contract address.
 */
export function passkeySalt(credentialId: Uint8Array): Buffer {
  if (credentialId.length === 0) throw new Error('Empty credential id.');
  return hash(Buffer.from(credentialId));
}

export interface BuildCreatePasskeyAccountParams {
  sourceAccount: string; // the deployer (G…) — also pays the tx
  sourceSequence: string;
  wasmHashHex: string; // sha256 of the uploaded WASM (contractWasm.ts)
  publicKey: Uint8Array; // 65-byte SEC1 passkey public key (constructor arg)
  salt: Buffer; // 32 bytes, from passkeySalt()
  networkPassphrase: string;
  fee?: string;
  timeoutSecs?: number;
}

/**
 * Build the *unsigned, pre-simulation* XDR that deploys one passkey smart
 * account: CreateContractV2 from the vendored wasm hash, with the passkey's
 * public key passed to `__constructor`. Same simulate → assemble tail applies.
 */
export function buildCreatePasskeyAccountXdr(params: BuildCreatePasskeyAccountParams): string {
  const source = requireAccountId(params.sourceAccount, 'deployer account');
  if (!/^[0-9a-f]{64}$/i.test(params.wasmHashHex)) {
    throw new Error('Invalid wasm hash: expected 32 bytes of hex.');
  }
  if (params.publicKey.length !== P256_PUBLIC_KEY_BYTES) {
    throw new Error('Invalid passkey public key: expected a 65-byte SEC1 point.');
  }
  if (params.salt.length !== 32) {
    throw new Error('Invalid salt: expected 32 bytes.');
  }
  return new TransactionBuilder(new Account(source, params.sourceSequence), {
    fee: params.fee || BASE_FEE,
    networkPassphrase: params.networkPassphrase,
  })
    .addOperation(
      Operation.createCustomContract({
        address: new Address(source),
        wasmHash: Buffer.from(params.wasmHashHex, 'hex'),
        salt: params.salt,
        constructorArgs: [xdr.ScVal.scvBytes(Buffer.from(params.publicKey))],
      }),
    )
    .setTimeout(params.timeoutSecs ?? DEFAULT_TIMEOUT_SECS)
    .build()
    .toXDR();
}

export interface PredictPasskeyAccountIdParams {
  deployer: string; // G…
  salt: Buffer; // 32 bytes
  networkPassphrase: string;
}

/**
 * The C… address `buildCreatePasskeyAccountXdr` will create: sha256 of the
 * ENVELOPE_TYPE_CONTRACT_ID preimage over (network, deployer, salt).
 */
export function predictPasskeyAccountId(params: PredictPasskeyAccountIdParams): string {
  const deployer = requireAccountId(params.deployer, 'deployer account');
  if (params.salt.length !== 32) throw new Error('Invalid salt: expected 32 bytes.');
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(params.networkPassphrase)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: new Address(deployer).toScAddress(),
          salt: params.salt,
        }),
      ),
    }),
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}
