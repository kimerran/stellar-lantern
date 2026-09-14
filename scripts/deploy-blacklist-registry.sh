#!/usr/bin/env bash
#
# Deploy the Lantern blacklist registry on Stellar TESTNET (#36).
#
# The registry is a SINGLE deployed contract that any wallet reads by id — unlike
# the passkey account, which deploys one instance per user. So the thing this
# script produces that matters is a contract id and a WASM hash to publish.
#
# This script is REPEATABLE: testnet is periodically reset, which wipes the
# contract. Re-run it, then paste the printed block into README.md's "Testnet
# smart contracts" table and docs/blacklist-registry.md.
#
# Prereqs: `stellar` CLI (v22+), `cargo` + the wasm32v1-none target, outbound
# access to testnet. Keys NEVER go in the repo: the script uses local
# `stellar keys` identities, and the real admin/treasury secrets live in
# environment secrets (SOW §3.9).
#
# Usage:  scripts/deploy-blacklist-registry.sh [stellar-identity-name]
#   The identity funds the deploy and becomes the registry admin. Defaults to
#   "lantern-deployer" (auto-generated + friendbot-funded if it doesn't exist).
#
# Env:
#   RPC       default https://soroban-testnet.stellar.org
#   FEE       report fee in stroops of FEE_TOKEN, default 10000000 (1 XLM)
#   TREASURY  address fees are routed to; default: the address of a
#             generated+funded "lantern-treasury" identity
#   FEE_TOKEN default the native XLM SAC on testnet
#
# What it does, in order:
#   1. ensure a funded deployer identity (and treasury identity, if unset)
#   2. build the crate                        -> local sha256
#   3. contract upload                        -> WASM hash (== that sha256)
#   4. contract deploy --wasm-hash            -> contract id
#   5. validate with config + count           (live simulation)
#   6. print the copy-paste block for the README / docs
set -euo pipefail
cd "$(dirname "$0")/.."

RPC="${RPC:-https://soroban-testnet.stellar.org}"
PASSPHRASE="Test SDF Network ; September 2015"
IDENTITY="${1:-lantern-deployer}"
FEE="${FEE:-10000000}"                                                  # 1 XLM in stroops
FEE_TOKEN="${FEE_TOKEN:-CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC}" # native XLM SAC, testnet

# Ensure a funded identity exists; friendbot top-up is best-effort (already-funded
# accounts get a 400, which is fine — this is what makes the script re-runnable).
ensure_identity() {
  stellar keys address "$1" >/dev/null 2>&1 || stellar keys generate "$1" --network testnet --fund
  curl -s "https://friendbot.stellar.org?addr=$(stellar keys address "$1")" -o /dev/null || true
  stellar keys address "$1"
}

echo "==> deployer identity: $IDENTITY"
ADMIN="$(ensure_identity "$IDENTITY")"
echo "    admin: $ADMIN"

if [ -z "${TREASURY:-}" ]; then
  echo "==> treasury identity: lantern-treasury (TREASURY unset)"
  TREASURY="$(ensure_identity lantern-treasury)"
fi
echo "    treasury: $TREASURY"
echo "    fee: $FEE stroops of $FEE_TOKEN"

echo "==> building the crate"
./scripts/build-blacklist-registry.sh >/dev/null
WASM=contracts/blacklist-registry/target/wasm32v1-none/release/blacklist_registry.wasm
LOCAL_SHA="$(sha256sum "$WASM" | cut -d' ' -f1)"
echo "    local sha256: $LOCAL_SHA"

echo "==> uploading WASM"
WASM_HASH="$(stellar contract upload --wasm "$WASM" \
  --source "$IDENTITY" --rpc-url "$RPC" --network-passphrase "$PASSPHRASE")"
echo "    wasm hash: $WASM_HASH"

# A Soroban WASM hash IS the sha256 of the uploaded bytes. A mismatch means the
# artifact drifted between build and upload — stop rather than publish a lie.
if [ "$WASM_HASH" != "$LOCAL_SHA" ]; then
  echo "❌ uploaded hash != local sha256 ($WASM_HASH vs $LOCAL_SHA)" >&2
  exit 1
fi

echo "==> deploying"
CONTRACT_ID="$(stellar contract deploy --wasm-hash "$WASM_HASH" \
  --source "$IDENTITY" --rpc-url "$RPC" --network-passphrase "$PASSPHRASE" -- \
  --admin "$ADMIN" --treasury "$TREASURY" --fee_token "$FEE_TOKEN" --fee "$FEE")"
echo "    contract id: $CONTRACT_ID"

echo "==> validating via live simulation"
invoke() { stellar contract invoke --id "$CONTRACT_ID" --source "$IDENTITY" \
  --rpc-url "$RPC" --network-passphrase "$PASSPHRASE" --send=no -- "$@"; }
CONFIG="$(invoke config)"
COUNT="$(invoke count)"
echo "    config: $CONFIG"
echo "    count:  $COUNT"

cat <<BLOCK

✅ Blacklist registry deployed and validated on testnet.

  contract id : $CONTRACT_ID
  wasm hash   : $WASM_HASH
  admin       : $ADMIN
  treasury    : $TREASURY
  fee         : $FEE stroops of $FEE_TOKEN

  contract : https://stellar.expert/explorer/testnet/contract/$CONTRACT_ID
  wasm     : https://stellar.expert/explorer/testnet/contract/$CONTRACT_ID/wasm

Next: scripts/smoke-blacklist-registry.sh $CONTRACT_ID
Then update the README "Testnet smart contracts" row and docs/blacklist-registry.md.
BLOCK
