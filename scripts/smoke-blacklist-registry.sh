#!/usr/bin/env bash
#
# Smoke-test a deployed blacklist registry on TESTNET and produce Deliverable 1's
# fee-routing evidence (#36).
#
# The claim this proves is not "report() ran" — it is that a report costs the
# reporter the configured fee, that the fee lands in the treasury, and that the
# subject reads back flagged afterwards. So the script brackets the report with
# treasury balance reads and ASSERTS the delta equals the fee, rather than
# printing two numbers and leaving the reader to compare them.
#
# Re-runnable: repeat reports of an already-flagged subject are legal (that IS
# the anti-spam property — the fee is charged every time), so running this twice
# against the same contract charges twice and still passes.
#
# Usage:  scripts/smoke-blacklist-registry.sh <contract-id> [stellar-identity-name]
# Env:    RPC, SUBJECT (default: the demo flagged address the scanner already shows)
set -euo pipefail
cd "$(dirname "$0")/.."

CONTRACT_ID="${1:?usage: scripts/smoke-blacklist-registry.sh <contract-id> [identity]}"
IDENTITY="${2:-lantern-deployer}"
RPC="${RPC:-https://soroban-testnet.stellar.org}"
PASSPHRASE="Test SDF Network ; September 2015"

# Lantern's demo flagged address (src/core/scan/engine.ts, DEMO_FLAGGED_ADDRESSES),
# so the seeded on-chain entry lines up with the demo the scanner already shows.
SUBJECT="${SUBJECT:-GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ}"
EVIDENCE="$(printf 'lantern-d1-smoke' | sha256sum | cut -d' ' -f1)"

REPORTER="$(stellar keys address "$IDENTITY")"
# The reporter must not be the subject (Error::SelfReport, 2).
if [ "$REPORTER" = "$SUBJECT" ]; then
  echo "❌ reporter == subject; report() would fail with SelfReport" >&2; exit 1
fi

sim()  { stellar contract invoke --id "$1" --source "$IDENTITY" --rpc-url "$RPC" \
           --network-passphrase "$PASSPHRASE" --send=no -- "${@:2}"; }
send() { stellar contract invoke --id "$1" --source "$IDENTITY" --rpc-url "$RPC" \
           --network-passphrase "$PASSPHRASE" -- "${@:2}"; }

CONFIG="$(sim "$CONTRACT_ID" config)"
strip() { tr -d '"'; }
json_field() { echo "$CONFIG" | sed -n "s/.*\"$1\":\"\{0,1\}\([^\",}]*\).*/\1/p"; }
TREASURY="$(json_field treasury)"
FEE_TOKEN="$(json_field fee_token)"
FEE="$(json_field fee)"

echo "==> contract : $CONTRACT_ID"
echo "    reporter : $REPORTER"
echo "    subject  : $SUBJECT"
echo "    treasury : $TREASURY"
echo "    fee      : $FEE stroops of $FEE_TOKEN"
echo "    evidence : $EVIDENCE"

BEFORE="$(sim "$FEE_TOKEN" balance --id "$TREASURY" | strip)"
echo "==> treasury balance before: $BEFORE"

echo "==> report()"
# The tx hash is only on stderr ("Signing transaction: <hash>"), so keep both
# streams and pull it back out.
OUT="$(send "$CONTRACT_ID" report --reporter "$REPORTER" --subject "$SUBJECT" \
        --reason Scam --evidence "$EVIDENCE" 2>&1)"
echo "$OUT" | sed 's/^/    /'
TX="$(echo "$OUT" | sed -n 's/.*Signing transaction: \([0-9a-f]\{64\}\).*/\1/p' | tail -1)"

AFTER="$(sim "$FEE_TOKEN" balance --id "$TREASURY" | strip)"
echo "==> treasury balance after: $AFTER"

DELTA=$(( AFTER - BEFORE ))
if [ "$DELTA" != "$FEE" ]; then
  echo "❌ treasury delta $DELTA != fee $FEE" >&2; exit 1
fi
echo "    ✓ delta $DELTA == fee $FEE"

FLAGGED="$(sim "$CONTRACT_ID" is_flagged --subject "$SUBJECT")"
if [ "$FLAGGED" != "true" ]; then
  echo "❌ is_flagged($SUBJECT) = $FLAGGED, expected true" >&2; exit 1
fi
echo "    ✓ is_flagged == true"

echo "==> fee-free hot read (no source account, no signature)"
node scripts/hot-read-blacklist-registry.mjs --contract "$CONTRACT_ID" --subject "$SUBJECT" --rpc "$RPC"

cat <<BLOCK

✅ Smoke report on-chain, fee routed to the treasury.

  report tx : $TX
  https://stellar.expert/explorer/testnet/tx/$TX

  treasury  : $TREASURY  ($BEFORE -> $AFTER, +$FEE)
  subject   : $SUBJECT  is_flagged = true
BLOCK
