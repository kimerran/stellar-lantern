// The vendored passkey smart-account contract WASM (#53): the generated module
// must stay internally consistent — the base64 decodes to real WASM and the
// exported hash is the sha256 CreateContractV2 will reference on-chain.
import { describe, expect, it } from 'vitest';
import {
  PASSKEY_ACCOUNT_WASM_BASE64,
  PASSKEY_ACCOUNT_WASM_HASH_HEX,
} from '@core/passkey/contractWasm';

describe('vendored passkey-account wasm', () => {
  const wasm = Buffer.from(PASSKEY_ACCOUNT_WASM_BASE64, 'base64');

  it('decodes to a WebAssembly module (magic header)', () => {
    expect(wasm.length).toBeGreaterThan(4);
    expect([...wasm.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]); // "\0asm"
  });

  it('hash matches the wasm bytes', async () => {
    const digest = Buffer.from(await crypto.subtle.digest('SHA-256', wasm));
    expect(digest.toString('hex')).toBe(PASSKEY_ACCOUNT_WASM_HASH_HEX);
  });

  it('hash is a 32-byte hex string', () => {
    expect(PASSKEY_ACCOUNT_WASM_HASH_HEX).toMatch(/^[0-9a-f]{64}$/);
  });
});
