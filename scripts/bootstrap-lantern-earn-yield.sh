#!/usr/bin/env bash
#
# Take Lantern's Blend pool from "deployed but on-ice / 0% yield" to
# "ACTIVE with real, live supply yield" on Stellar TESTNET.
#
# Background: deploy-lantern-pool.sh deploys the pool ON-ICE (set_status 3) so
# Earn's supply/withdraw works WITHOUT a backstop. But supply APY in Blend is not
# a setting — it only exists when there is borrow *utilization*, and borrowing
# requires the pool to be ACTIVE (status 0/1), which Blend gates on a funded
# backstop. This script does the full bring-up:
#
#   Phase A  fund the deployer with BLND/USDC via the Blend testnet faucet
#            (HTTP getAssets endpoint; grants once per address, so it spins up
#             many throttled friendbot accounts and consolidates)
#   Phase B  mint Comet BLND:USDC LP -> deposit into the pool's backstop until it
#            clears the activation threshold  ( blnd^4 * usdc >= 1e25, i.e.
#            blnd^0.8 * usdc^0.2 >= 100_000 ; see blend pool status.rs ) -> set_status(0)
#   Phase C  seed XLM supply liquidity, then run an over-collateralized borrower
#            (SupplyCollateral USDC + Borrow XLM) to create ~58% XLM utilization
#   Phase D  verify: read get_reserve and print utilization + est. supply APY
#            (using the SAME 3-slope math as src/core/blend/apr.ts)
#
# IDEMPOTENT / RE-RUNNABLE: testnet resets wipe the pool periodically. Re-run
# after re-deploying (deploy-lantern-pool.sh) — each phase is skipped when its
# post-condition already holds (pool already active; utilization already present).
#
# Prereqs: `stellar` CLI (v22+), `curl`, `python3`, outbound testnet access.
# Usage:   scripts/bootstrap-lantern-earn-yield.sh [pool-id] [deployer-identity]
#          Defaults: pool id = the lantern-earn entry, identity = lantern-deployer.
set -uo pipefail

RPC="${RPC:-https://soroban-testnet.stellar.org}"
PP="Test SDF Network ; September 2015"
FAUCET="https://ewqw4hx7oa.execute-api.us-east-1.amazonaws.com/getAssets?userId="

# Blend v2 testnet contracts (blend-utils testnet.contracts.json)
COMET=CA5UTUUPHYL5K22UBRUVC37EARZUGYOSGK3IKIXG2JLCC5ZZLI4BDWDM   # BLND:USDC 80/20 LP (= backstop token)
BACKSTOP=CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA
USDC=CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU
BLND=CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF
XLM=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
FAUCET_ISSUER=GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56  # issuer that pre-signs faucet grants

POOL="${1:-CC4KSBTTPCKZUYBXB47SSZGXTKO6G23Y6LJOIR6YCOJVTGJZEYJCHBOH}"
IDENTITY="${2:-lantern-deployer}"

# Tunables (top-of-script so the demo is easy to re-scale)
BACKSTOP_LP_TARGET=21000          # LP to hold in backstop (clears blnd^4*usdc>=1e25)
BLND_FUND_TARGET=172000           # whole-BLND the deployer needs before minting LP
XLM_SEED=2000                     # XLM the deployer supplies as borrowable liquidity
XLM_BORROW=1200                   # XLM the borrower draws -> utilization
USDC_COLLATERAL=5000              # borrower's USDC collateral (heavily over-collateralized)

inv()   { stellar contract invoke --id "$1" --rpc-url "$RPC" --network-passphrase "$PP" --source "$IDENTITY" -- "${@:2}"; }
invas() { stellar contract invoke --id "$2" --rpc-url "$RPC" --network-passphrase "$PP" --source "$1" -- "${@:3}"; }  # invoke signed by $1
sim()   { stellar contract invoke --id "$1" --rpc-url "$RPC" --network-passphrase "$PP" --source "$IDENTITY" --send=no -- "${@:2}" 2>/dev/null; }
# Run a CRITICAL command; on failure print its error (review: no silent state changes) and abort.
must()  { local label="$1"; shift; local out; if ! out=$("$@" 2>&1); then echo "✗ FAILED: $label" >&2; echo "$out" | tail -6 >&2; exit 1; fi; }
blnd_str() { sim "$BLND" balance --id "$1" | tr -d '"'; }
whole()   { echo $(( ${1:-0} / 10000000 )); }
status()  { sim "$POOL" get_config | python3 -c "import json,sys;print(json.load(sys.stdin)['status'])" 2>/dev/null; }
exists()  { curl -s -m 8 "https://horizon-testnet.stellar.org/accounts/$1" | grep -q '"account_id"'; }

# Validate a faucet-returned tx BEFORE signing (review: don't blind-sign remote XDR):
# must be sourced by the known issuer and contain only changeTrust/payment ops,
# with every payment destined to the recipient we asked for.
faucet_tx_ok() { # xdr recipient
  echo "$1" | stellar xdr decode --type TransactionEnvelope --output json 2>/dev/null | python3 -c "
import json,sys
try: tx=json.load(sys.stdin)['tx']['tx']
except Exception: sys.exit(1)
if tx['source_account']!='$FAUCET_ISSUER': sys.exit(1)
for op in tx['operations']:
    k=next(iter(op['body']))
    if k not in ('change_trust','payment'): sys.exit(1)
    if k=='payment' and op['body'][k]['destination']!='$2': sys.exit(1)
sys.exit(0)"
}

DEP="$(stellar keys address "$IDENTITY" 2>/dev/null)" || { echo "identity $IDENTITY not found"; exit 1; }
echo "pool=$POOL  admin/deployer=$DEP  status=$(status)"

# ── Faucet one fresh account and sweep its BLND(+USDC) to the deployer ────────
# NOTE: the sweep transfers move funds FROM the fresh account, so they are signed
# with the fresh key ($n) — NOT the deployer (a SAC transfer needs from.require_auth()).
faucet_and_sweep() { # keyname address
  local n="$1" a="$2" resp xdr
  exists "$a" || return 0
  for t in 1 2 3; do
    resp=$(curl -s -m 30 "${FAUCET}${a}"); xdr=$(echo "$resp" | tr -d '"')
    if [ ${#xdr} -gt 200 ] && faucet_tx_ok "$xdr" "$a"; then
      echo "$xdr" | stellar tx sign --sign-with-key "$n" --network testnet 2>/dev/null \
        | stellar tx send --network testnet >/dev/null 2>&1 && break
    fi
    sleep 2
  done
  invas "$n" "$BLND" transfer --from "$a" --to "$DEP" --amount 50000000000 >/dev/null 2>&1
  invas "$n" "$USDC" transfer --from "$a" --to "$DEP" --amount 10000000000 >/dev/null 2>&1
}

if [ "$(status)" != "0" ]; then
  echo "==> Phase A: fund deployer to ${BLND_FUND_TARGET} BLND via faucet accounts"
  idx=0
  while [ "$(whole "$(blnd_str "$DEP")")" -lt "$BLND_FUND_TARGET" ] && [ "$idx" -lt 120 ]; do
    batch=()
    for k in 1 2 3 4 5; do                      # create+friendbot-fund, throttled (avoids the rate limit)
      n="lbf$idx"; stellar keys generate "$n" >/dev/null 2>&1
      a=$(stellar keys address "$n")
      for t in 1 2 3 4 5; do curl -s -m 15 "https://friendbot.stellar.org?addr=$a" -o /dev/null; exists "$a" && break; sleep 3; done
      batch+=("$n:$a"); idx=$((idx+1)); sleep 1
    done
    for pair in "${batch[@]}"; do faucet_and_sweep "${pair%%:*}" "${pair##*:}" & done
    wait
    echo "   deployer BLND=$(whole "$(blnd_str "$DEP")")"
  done
  [ "$(whole "$(blnd_str "$DEP")")" -ge "$BLND_FUND_TARGET" ] || { echo "✗ could not reach BLND target via faucet; aborting"; exit 1; }

  echo "==> Phase B: mint ${BACKSTOP_LP_TARGET} LP -> deposit to backstop -> activate"
  must "join_pool (mint LP)" inv "$COMET" join_pool --pool_amount_out "$((BACKSTOP_LP_TARGET))0000000" \
    --max_amounts_in '[ "1900000000000", "500000000000" ]' --user "$DEP"
  LPS=$(sim "$COMET" balance --id "$DEP" | tr -d '"')
  must "backstop.deposit"   inv "$BACKSTOP" deposit --from "$DEP" --pool_address "$POOL" --amount "$LPS"
  must "set_status(0)"      inv "$POOL" set_status --pool_status 0
  [ "$(status)" = "0" ] || { echo "✗ pool did not go Active (status=$(status)); backstop likely under threshold"; exit 1; }
  echo "   pool status now: 0 (Active)"
else
  echo "==> Pool already Active — skipping funding/backstop/activation."
fi

# ── Phase C: create utilization (skip if the XLM reserve already has debt) ────
XLM_DEBT=$(sim "$POOL" get_reserve --asset "$XLM" | python3 -c "import json,sys;print(int(json.load(sys.stdin)['data']['d_supply']))" 2>/dev/null || echo 0)
if [ "${XLM_DEBT:-0}" -eq 0 ]; then
  echo "==> Phase C: seed ${XLM_SEED} XLM supply + borrow ${XLM_BORROW} XLM"
  must "deployer supply XLM" inv "$POOL" submit --from "$DEP" --spender "$DEP" --to "$DEP" \
    --requests '[ { "address": "'"$XLM"'", "amount": "'"${XLM_SEED}0000000"'", "request_type": 0 } ]'
  stellar keys generate lantern-borrower --network testnet --fund >/dev/null 2>&1
  B=$(stellar keys address lantern-borrower)
  resp=$(curl -s -m 30 "${FAUCET}${B}"); xdr=$(echo "$resp" | tr -d '"')
  faucet_tx_ok "$xdr" "$B" && echo "$xdr" | stellar tx sign --sign-with-key lantern-borrower --network testnet 2>/dev/null | stellar tx send --network testnet >/dev/null 2>&1
  must "fund borrower USDC" inv "$USDC" transfer --from "$DEP" --to "$B" --amount "$(( (USDC_COLLATERAL-1000) ))0000000"
  must "borrower supply+borrow" invas lantern-borrower "$POOL" \
    submit --from "$B" --spender "$B" --to "$B" \
    --requests '[ { "address": "'"$USDC"'", "amount": "'"${USDC_COLLATERAL}0000000"'", "request_type": 2 }, { "address": "'"$XLM"'", "amount": "'"${XLM_BORROW}0000000"'", "request_type": 4 } ]'
else
  echo "==> XLM reserve already has utilization — skipping seed/borrow."
fi

# ── Phase D: verify + report (same math as src/core/blend/apr.ts) ─────────────
echo "==> Phase D: verify XLM reserve yield"
sim "$POOL" get_reserve --asset "$XLM" | python3 -c "
import json,sys
d=json.load(sys.stdin); data=d['data']; cfg=d['config']; S7=1e7
b=int(data['b_supply'])*int(data['b_rate']); l=int(data['d_supply'])*int(data['d_rate'])
util=l/b if b else 0
rb,r1,r2,r3=cfg['r_base']/S7,cfg['r_one']/S7,cfg['r_two']/S7,cfg['r_three']/S7
target=cfg['util']/S7; irmod=int(data['ir_mod'])/S7
if util<=target: ba=(util/target*r1+rb)*irmod if target else 0
elif util<=0.95:  ba=((util-target)/(0.95-target)*r2+r1+rb)*irmod
else:             ba=(util-0.95)/0.05*r3+irmod*(r2+r1+rb)
apy=(1+ba*util/52)**52-1
print(f'   XLM supplied={int(data[\"b_supply\"])/1e7:.0f}  borrowed={int(data[\"d_supply\"])/1e7:.0f}')
print(f'   utilization={util*100:.1f}%   => est. SUPPLY APY = {apy*100:.2f}%')
print('   ✅ Lantern Earn now pays real yield on supplied XLM.' if apy>0 else '   ⚠️ still 0% — check utilization')
"

# ── Cleanup: drop the throwaway friendbot funding identities (review) ─────────
# Keeps `lantern-borrower` (holds the live borrow position, so it can be unwound).
ID_DIR="${HOME}/.config/stellar/identity"
[ -d "$ID_DIR" ] && find "$ID_DIR" -maxdepth 1 -type f -name 'lbf[0-9]*.toml' -delete 2>/dev/null
echo "==> done."
