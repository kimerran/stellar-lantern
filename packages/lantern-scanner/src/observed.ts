// Balance changes the simulation observed (#56, stage 3c).
//
// `simulateTransaction` returns `stateChanges`: the ledger entries the
// transaction would create / update / delete, with before and after. Two of
// them are balances: an `account` entry (a G… account's native XLM) and a
// SAC's `Balance(holder)` contract-data entry (a C… holder's token balance).
// Diffing them yields what the call *does* to balances regardless of whether
// the scanner knows what the function *means* — which is exactly what an
// unverified contract needs reported.
//
// Only balances are read here. Other contract data (a pool's positions, an
// allowance record) is left alone: interpreting it would be guessing.

import { Address, xdr } from '@stellar/stellar-sdk';
import type { AssetDelta, AssetRef, StateChange } from './types';
import type { TokenMetadata } from './token';
import { assetForToken, scaleAmount } from './token';

interface BalanceChange {
  address: string;
  asset: AssetRef;
  before: bigint;
  after: bigint;
}

function nativeBalance(entry: string | undefined): { address: string; balance: bigint } | null {
  if (!entry) return null;
  const data = xdr.LedgerEntry.fromXDR(entry, 'base64').data();
  if (data.switch().name !== 'account') return null;
  const acc = data.account();
  return {
    address: Address.account(acc.accountId().ed25519()).toString(),
    balance: BigInt(acc.balance().toString()),
  };
}

// A SAC keeps a contract holder's balance under the instance-independent key
// ["Balance", holder] with value { amount, authorized, clawback }.
function sacBalance(
  key: xdr.LedgerKey,
  entry: string | undefined,
): { contractId: string; holder: string; amount: bigint } | null {
  if (key.switch().name !== 'contractData') return null;
  const cd = key.contractData();
  const k = cd.key();
  if (k.switch().name !== 'scvVec') return null;
  const parts = k.vec() ?? [];
  const tag = parts[0];
  if (
    parts.length !== 2 ||
    tag?.switch().name !== 'scvSymbol' ||
    tag.sym().toString() !== 'Balance'
  ) {
    return null;
  }
  const holderVal = parts[1]!;
  if (holderVal.switch().name !== 'scvAddress') return null;
  const contractId = Address.fromScAddress(cd.contract()).toString();
  const holder = Address.fromScVal(holderVal).toString();
  if (!entry) return { contractId, holder, amount: 0n };
  const data = xdr.LedgerEntry.fromXDR(entry, 'base64').data();
  if (data.switch().name !== 'contractData') return null;
  const val = data.contractData().val();
  if (val.switch().name !== 'scvMap') return null;
  for (const m of val.map() ?? []) {
    const mk = m.key();
    if (mk.switch().name === 'scvSymbol' && mk.sym().toString() === 'amount') {
      const v = m.val();
      if (v.switch().name !== 'scvI128') return null;
      const p = v.i128();
      return {
        contractId,
        holder,
        amount: (BigInt(p.hi().toString()) << 64n) | BigInt(p.lo().toString()),
      };
    }
  }
  return null;
}

export function balanceChanges(
  stateChanges: StateChange[],
  metadata: Map<string, TokenMetadata | null>,
  networkPassphrase: string,
): BalanceChange[] {
  const out: BalanceChange[] = [];
  for (const sc of stateChanges) {
    let key: xdr.LedgerKey;
    try {
      key = xdr.LedgerKey.fromXDR(sc.key, 'base64');
    } catch {
      continue;
    }
    try {
      if (key.switch().name === 'account') {
        const before = nativeBalance(sc.before);
        const after = nativeBalance(sc.after);
        const address = after?.address ?? before?.address;
        if (!address) continue;
        out.push({
          address,
          asset: { code: 'XLM', decimals: 7 },
          before: before?.balance ?? 0n,
          after: after?.balance ?? 0n,
        });
      } else if (key.switch().name === 'contractData') {
        const before = sacBalance(key, sc.before);
        const after = sacBalance(key, sc.after);
        const any = after ?? before;
        if (!any) continue;
        out.push({
          address: any.holder,
          asset: assetForToken(
            any.contractId,
            metadata.get(any.contractId) ?? null,
            networkPassphrase,
          ),
          before: before?.amount ?? 0n,
          after: after?.amount ?? 0n,
        });
      }
    } catch {
      // An entry this reader cannot parse is not a balance it can vouch for.
    }
  }
  return out;
}

// Observed balance changes as AssetDeltas (`source: 'simulation'`). No
// opIndex is meaningful — the simulation is of the whole transaction.
export function observedDeltas(
  stateChanges: StateChange[],
  metadata: Map<string, TokenMetadata | null>,
  networkPassphrase: string,
): AssetDelta[] {
  return balanceChanges(stateChanges, metadata, networkPassphrase).flatMap((c) => {
    const diff = c.after - c.before;
    if (diff === 0n) return [];
    const abs = diff < 0n ? -diff : diff;
    return [
      {
        address: c.address,
        direction: diff < 0n ? 'out' : 'in',
        asset: c.asset,
        amount: scaleAmount(abs, c.asset.decimals ?? null),
        raw: abs.toString(),
        bound: 'exact',
        opIndex: 0,
        source: 'simulation',
      } satisfies AssetDelta,
    ];
  });
}
