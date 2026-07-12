#!/usr/bin/env bash
#
# Deploy Lantern's own Blend v2 lending pool on Stellar TESTNET (#109).
#
# Blend v2 is a pool *factory*, so "our own pool" = an instance we deploy through
# the factory with our own reserves/params. Because it speaks the standard Blend
# ABI, the wallet's existing Earn stack (core/blend/*, screens/Earn.tsx) works
# against it unchanged — the only app change is the BLEND_POOLS directory entry.
#
# This script is REPEATABLE: testnet is periodically reset, which wipes the pool.
# Re-run it, then paste the printed pool id into src/core/blend/directory.ts
# (the `lantern-earn` entry's poolId).
#
# Prereqs: the `stellar` CLI (v22+) on PATH, and outbound access to testnet.
# Usage:  scripts/deploy-lantern-pool.sh [stellar-identity-name]
#   The identity funds the deploy and becomes the pool admin. Defaults to
#   "lantern-deployer" (auto-generated + friendbot-funded if it doesn't exist).
#
# What it does, in order:
#   1. ensure a funded deployer identity           (friendbot)
#   2. factory.deploy         -> new pool contract id
#   3. queue_set_reserve + set_reserve for USDC and XLM  (curated reserves)
#   4. set_status(3)          -> "on-ice": supply/withdraw (Earn) enabled without
#                                a backstop; borrow stays disabled (out of scope)
#   5. validate get_reserve for each reserve (live simulation)
set -euo pipefail

RPC="${RPC:-https://soroban-testnet.stellar.org}"
PASSPHRASE="Test SDF Network ; September 2015"
IDENTITY="${1:-lantern-deployer}"

# Blend v2 testnet contracts (blend-utils testnet.contracts.json) + reserve SACs.
FACTORY="CDV6RX4CGPCOKGTBFS52V3LMWQGZN3LCQTXF5RVPOOCG4XVMHXQ4NTF6" # poolFactoryV2
ORACLE="CAZOKR2Y5E2OSWSIBRVZMJ47RUTQPIGVWSAQ2UISGAVC46XKPGDG5PKI"  # shared mock oracle (prices USDC/XLM)
USDC="CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU"
XLM="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"

# Deterministic salt so a given (admin, salt) reproduces the same pool address.
SALT="6c616e7465726e2d6561726e2d706f6f6c2d7631000000000000000000000000" # "lantern-earn-pool-v1"

invoke() { stellar contract invoke --id "$1" --rpc-url "$RPC" --network-passphrase "$PASSPHRASE" --source "$IDENTITY" -- "${@:2}"; }

echo "==> deployer identity: $IDENTITY"
if ! stellar keys address "$IDENTITY" >/dev/null 2>&1; then
  stellar keys generate "$IDENTITY" --network testnet --fund
fi
ADMIN="$(stellar keys address "$IDENTITY")"
# Top up (no-op if already funded); ignore failure.
curl -s "https://friendbot.stellar.org?addr=$ADMIN" -o /dev/null || true
echo "    admin: $ADMIN"

echo "==> deploying Lantern pool via factory"
POOL="$(invoke "$FACTORY" deploy \
  --admin "$ADMIN" --name '"Lantern Earn"' --salt "$SALT" \
  --oracle "$ORACLE" --backstop_take_rate 0 --max_positions 4 --min_collateral 0 \
  | tr -d '"')"
echo "    pool: $POOL"

set_reserve() { # asset index c_factor l_factor util
  local asset="$1" index="$2" cf="$3" lf="$4" util="$5"
  local meta
  meta="{ \"index\": $index, \"decimals\": 7, \"c_factor\": $cf, \"l_factor\": $lf, \"util\": $util, \"max_util\": 9500000, \"r_base\": 50000, \"r_one\": 500000, \"r_two\": 5000000, \"r_three\": 15000000, \"reactivity\": 200, \"supply_cap\": \"1000000000000000\", \"enabled\": true }"
  echo "==> reserve[$index] $asset"
  invoke "$POOL" queue_set_reserve --asset "$asset" --metadata "$meta" >/dev/null
  invoke "$POOL" set_reserve --asset "$asset" >/dev/null
}
set_reserve "$USDC" 0 9000000 9000000 8000000
set_reserve "$XLM"  1 7500000 7500000 5000000

echo "==> set_status(3) — enable supply/withdraw (Earn) without a backstop"
invoke "$POOL" set_status --pool_status 3 >/dev/null

echo "==> validating reserves via live get_reserve simulation"
for A in "$USDC" "$XLM"; do
  stellar contract invoke --id "$POOL" --rpc-url "$RPC" --network-passphrase "$PASSPHRASE" \
    --source "$IDENTITY" --send=no -- get_reserve --asset "$A" >/dev/null && echo "    ok: $A"
done

echo
echo "✅ Lantern pool deployed and validated on testnet."
echo "   poolId: $POOL"
echo "   → paste into src/core/blend/directory.ts (lantern-earn entry)."
