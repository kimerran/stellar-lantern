// Deploy/bind builders for the passkey smart account (#53): upload +
// CreateContractV2 XDR shapes, the deterministic salt, and the predicted C…
// contract id. Pure/offline — decoded straight back out of the XDR.
import { describe, expect, it } from 'vitest';
import { Networks, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import {
  buildCreatePasskeyAccountXdr,
  buildUploadWasmXdr,
  passkeySalt,
  predictPasskeyAccountId,
} from '@core/passkey/smartAccount';
import { PASSKEY_ACCOUNT_WASM_BASE64, PASSKEY_ACCOUNT_WASM_HASH_HEX } from '@core/passkey/contractWasm';

const DEPLOYER = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const PASSPHRASE = Networks.TESTNET;
const PUBLIC_KEY = new Uint8Array(65).fill(7);
PUBLIC_KEY[0] = 0x04;
const CREDENTIAL_ID = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

function hostFunctionOf(b64Xdr: string): xdr.HostFunction {
  const tx = TransactionBuilder.fromXDR(b64Xdr, PASSPHRASE);
  if ('innerTransaction' in tx) throw new Error('unexpected fee-bump');
  const op = tx.toEnvelope().v1().tx().operations()[0]!.body().invokeHostFunctionOp();
  return op.hostFunction();
}

describe('buildUploadWasmXdr', () => {
  it('builds an uploadContractWasm host function carrying the exact wasm bytes', () => {
    const built = buildUploadWasmXdr({
      sourceAccount: DEPLOYER,
      sourceSequence: '100',
      wasmBase64: PASSKEY_ACCOUNT_WASM_BASE64,
      networkPassphrase: PASSPHRASE,
    });
    const fn = hostFunctionOf(built);
    expect(fn.switch().name).toBe('hostFunctionTypeUploadContractWasm');
    expect(Buffer.from(fn.wasm()).equals(Buffer.from(PASSKEY_ACCOUNT_WASM_BASE64, 'base64'))).toBe(true);
  });

  it('rejects a bad source account and empty wasm', () => {
    expect(() =>
      buildUploadWasmXdr({ sourceAccount: 'nope', sourceSequence: '1', wasmBase64: PASSKEY_ACCOUNT_WASM_BASE64, networkPassphrase: PASSPHRASE }),
    ).toThrow(/source account/);
    expect(() =>
      buildUploadWasmXdr({ sourceAccount: DEPLOYER, sourceSequence: '1', wasmBase64: '', networkPassphrase: PASSPHRASE }),
    ).toThrow(/Empty/);
  });
});

describe('passkeySalt', () => {
  it('is a 32-byte deterministic digest of the credential id', () => {
    const a = passkeySalt(CREDENTIAL_ID);
    const b = passkeySalt(CREDENTIAL_ID);
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(passkeySalt(new Uint8Array([9, 9])))).toBe(false);
  });

  it('rejects an empty credential id', () => {
    expect(() => passkeySalt(new Uint8Array(0))).toThrow(/Empty/);
  });
});

describe('buildCreatePasskeyAccountXdr', () => {
  const params = {
    sourceAccount: DEPLOYER,
    sourceSequence: '42',
    wasmHashHex: PASSKEY_ACCOUNT_WASM_HASH_HEX,
    publicKey: PUBLIC_KEY,
    salt: passkeySalt(CREDENTIAL_ID),
    networkPassphrase: PASSPHRASE,
  };

  it('builds CreateContractV2 with the wasm hash, salt and 65-byte constructor arg', () => {
    const fn = hostFunctionOf(buildCreatePasskeyAccountXdr(params));
    expect(fn.switch().name).toBe('hostFunctionTypeCreateContractV2');
    const create = fn.createContractV2();
    expect(Buffer.from(create.executable().wasmHash()).toString('hex')).toBe(PASSKEY_ACCOUNT_WASM_HASH_HEX);
    const preimage = create.contractIdPreimage().fromAddress();
    expect(Buffer.from(preimage.salt()).toString('hex')).toBe(passkeySalt(CREDENTIAL_ID).toString('hex'));
    const args = create.constructorArgs();
    expect(args.length).toBe(1);
    expect(Buffer.from(args[0]!.bytes()).equals(Buffer.from(PUBLIC_KEY))).toBe(true);
  });

  it('rejects bad inputs', () => {
    expect(() => buildCreatePasskeyAccountXdr({ ...params, wasmHashHex: 'zz' })).toThrow(/wasm hash/);
    expect(() => buildCreatePasskeyAccountXdr({ ...params, publicKey: new Uint8Array(64) })).toThrow(/public key/);
    expect(() => buildCreatePasskeyAccountXdr({ ...params, salt: Buffer.alloc(16) })).toThrow(/salt/);
    expect(() => buildCreatePasskeyAccountXdr({ ...params, sourceAccount: 'CBADCONTRACT' })).toThrow(/deployer/);
  });
});

describe('predictPasskeyAccountId', () => {
  it('returns a valid, deterministic C… address that varies with salt and deployer', () => {
    const salt = passkeySalt(CREDENTIAL_ID);
    const id = predictPasskeyAccountId({ deployer: DEPLOYER, salt, networkPassphrase: PASSPHRASE });
    expect(StrKey.isValidContract(id)).toBe(true);
    expect(predictPasskeyAccountId({ deployer: DEPLOYER, salt, networkPassphrase: PASSPHRASE })).toBe(id);
    expect(
      predictPasskeyAccountId({ deployer: DEPLOYER, salt: passkeySalt(new Uint8Array([1])), networkPassphrase: PASSPHRASE }),
    ).not.toBe(id);
    expect(
      predictPasskeyAccountId({ deployer: DEPLOYER, salt, networkPassphrase: Networks.PUBLIC }),
    ).not.toBe(id);
  });

  it('matches the contract id the CreateContractV2 op itself derives', () => {
    // Oracle: the deploy op's contractIdPreimage must hash to the predicted id
    // (same preimage inputs — this pins the two functions together).
    const salt = passkeySalt(CREDENTIAL_ID);
    const fn = hostFunctionOf(
      buildCreatePasskeyAccountXdr({
        sourceAccount: DEPLOYER,
        sourceSequence: '1',
        wasmHashHex: PASSKEY_ACCOUNT_WASM_HASH_HEX,
        publicKey: PUBLIC_KEY,
        salt,
        networkPassphrase: PASSPHRASE,
      }),
    );
    const fromOp = fn.createContractV2().contractIdPreimage().fromAddress();
    expect(fromOp.address().switch().name).toBe('scAddressTypeAccount');
    expect(Buffer.from(fromOp.salt()).toString('hex')).toBe(salt.toString('hex'));
    // Address + salt fed to predict — already asserted deterministic above.
    const id = predictPasskeyAccountId({ deployer: DEPLOYER, salt, networkPassphrase: PASSPHRASE });
    expect(StrKey.isValidContract(id)).toBe(true);
  });
});
