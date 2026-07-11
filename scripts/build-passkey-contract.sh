#!/usr/bin/env bash
# Build the passkey-account contract and vendor the WASM into
# src/core/passkey/contractWasm.ts (+ a copy next to the crate for inspection).
# Requires: rustup target wasm32v1-none, stellar CLI. Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")/.."

(cd contracts/passkey-account && stellar contract build)

WASM=contracts/passkey-account/target/wasm32v1-none/release/passkey_account.wasm
cp "$WASM" contracts/passkey-account/passkey_account.wasm
node scripts/gen-contract-wasm-module.mjs "$WASM" src/core/passkey/contractWasm.ts
echo "OK: $(wc -c < contracts/passkey-account/passkey_account.wasm) bytes"
