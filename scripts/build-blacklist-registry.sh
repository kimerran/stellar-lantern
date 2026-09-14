#!/usr/bin/env bash
# Build the blacklist-registry contract and drop the WASM next to the crate.
# Unlike the passkey account (one instance per user, so its WASM is vendored
# into a TS module), the registry is a single deployed contract — the wallet
# only ever needs its contract id, never its bytes.
# Requires: rustup target wasm32v1-none, stellar CLI. Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")/.."

(cd contracts/blacklist-registry && stellar contract build)

WASM=contracts/blacklist-registry/target/wasm32v1-none/release/blacklist_registry.wasm
cp "$WASM" contracts/blacklist-registry/blacklist_registry.wasm
echo "sha256: $(sha256sum "$WASM" | cut -d' ' -f1)"
echo "OK: $(wc -c < "$WASM") bytes"
