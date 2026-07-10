// Generate a TypeScript module that vendors a compiled contract WASM as base64
// (plus its sha256, which is the on-chain wasm hash CreateContractV2 references).
// Usage: node scripts/gen-contract-wasm-module.mjs <wasm-file> <out-ts-file>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [wasmPath, outPath] = process.argv.slice(2);
if (!wasmPath || !outPath) {
  console.error('usage: gen-contract-wasm-module.mjs <wasm-file> <out-ts-file>');
  process.exit(1);
}

const wasm = readFileSync(wasmPath);
const hash = createHash('sha256').update(wasm).digest('hex');
const b64 = wasm.toString('base64');

// Wrap the base64 to keep the generated file diffable.
const lines = b64.match(/.{1,96}/g) ?? [];

const out = `// GENERATED FILE — do not edit by hand.
// Built from contracts/passkey-account by scripts/build-passkey-contract.sh.
// The passkey smart-account contract (#53), vendored so the extension bundles
// it (MV3 forbids remote code) and CI needs no Rust toolchain.

/** sha256 of the WASM — the on-chain wasm hash CreateContractV2 deploys from. */
export const PASSKEY_ACCOUNT_WASM_HASH_HEX = '${hash}';

/** The compiled passkey-account contract, base64-encoded (${wasm.length} bytes). */
export const PASSKEY_ACCOUNT_WASM_BASE64 =
${lines.map((l) => `  '${l}'`).join(' +\n')};
`;

writeFileSync(outPath, out);
console.log(`wrote ${outPath} (${wasm.length} bytes wasm, sha256 ${hash})`);
