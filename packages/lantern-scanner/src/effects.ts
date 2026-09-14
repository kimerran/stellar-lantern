// Stage 3a — Effects from classic operations (#54).
//
// Turns the value-moving classic ops — payment, createAccount, both path
// payments, accountMerge — into per-address AssetDeltas and aggregates them
// per (address, asset) into NetDeltas. Exact decimal strings throughout; see
// decimal.ts. Token-interface calls are 3b (#55); everything else is 3c (#56).

import type { AssetDelta, AssetRef, DecodedOp, DecodedTx, NetDelta } from './types';
import { addAmounts } from './decimal';

const ZERO = '0.0000000';

// The account an op acts for: its own source override, else the tx source,
// else the caller-supplied fallback (a hand-built DecodedTx without `source`).
export function opSource(tx: DecodedTx, op: DecodedOp, fallback: string): string {
  return op.sourceAccount ?? tx.source ?? fallback;
}

function asset(code: string | undefined, issuer: string | undefined): AssetRef {
  const c = code ?? 'XLM';
  return c === 'XLM' && !issuer ? { code: 'XLM' } : { code: c, ...(issuer ? { issuer } : {}) };
}

// Per-op deltas for the classic ops. Ops this stage does not cover produce
// nothing here; they are reported by the coarse `effects[]` list and, for
// contract calls, by 3b/3c.
export function classicDeltas(tx: DecodedTx, fallbackSource: string): AssetDelta[] {
  const out: AssetDelta[] = [];
  tx.operations.forEach((op, opIndex) => {
    const from = opSource(tx, op, fallbackSource);
    switch (op.type) {
      case 'payment':
      case 'createAccount': {
        if (!op.destination || !op.amount) return;
        const a = asset(op.assetCode, op.assetIssuer);
        out.push(delta(from, 'out', a, op.amount, 'exact', opIndex));
        out.push(delta(op.destination, 'in', a, op.amount, 'exact', opIndex));
        return;
      }
      case 'pathPaymentStrictSend': {
        // Spend exactly sendAmount; the destination receives at least destMin.
        if (!op.destination || !op.sendAmount) return;
        out.push(
          delta(
            from,
            'out',
            asset(op.sendAssetCode, op.sendAssetIssuer),
            op.sendAmount,
            'exact',
            opIndex,
          ),
        );
        if (op.destMin) {
          out.push(
            delta(
              op.destination,
              'in',
              asset(op.destAssetCode, op.destAssetIssuer),
              op.destMin,
              'min',
              opIndex,
            ),
          );
        }
        return;
      }
      case 'pathPaymentStrictReceive': {
        // The destination receives exactly `amount`; spend at most sendMax
        // (decoded into `sendAmount`) — the risk-relevant number.
        if (!op.destination || !op.amount) return;
        if (op.sendAmount) {
          out.push(
            delta(
              from,
              'out',
              asset(op.sendAssetCode, op.sendAssetIssuer),
              op.sendAmount,
              'max',
              opIndex,
            ),
          );
        }
        out.push(
          delta(
            op.destination,
            'in',
            asset(op.destAssetCode ?? op.assetCode, op.destAssetIssuer ?? op.assetIssuer),
            op.amount,
            'exact',
            opIndex,
          ),
        );
        return;
      }
      case 'accountMerge': {
        // The entire XLM balance leaves and the account closes. There is no
        // amount to report; `bound: 'total'` says so instead of pretending 0.
        if (!op.destination) return;
        out.push(delta(from, 'out', { code: 'XLM' }, null, 'total', opIndex));
        out.push(delta(op.destination, 'in', { code: 'XLM' }, null, 'total', opIndex));
        return;
      }
      default:
        return;
    }
  });
  return out;
}

function delta(
  address: string,
  direction: 'in' | 'out',
  a: AssetRef,
  amount: string | null,
  bound: AssetDelta['bound'],
  opIndex: number,
): AssetDelta {
  return { address, direction, asset: a, amount, bound, opIndex, source: 'classic' };
}

export function assetKey(a: AssetRef): string {
  return a.contractId ?? `${a.code}:${a.issuer ?? 'native'}`;
}

// Aggregate deltas per (address, asset). `total` outflows set `outIsTotal`
// and add nothing to `out` (there is no number to add); a `total` inflow is
// unknowable here and is left out of `in` but still keeps the row.
export function aggregate(deltas: AssetDelta[]): NetDelta[] {
  const rows = new Map<string, NetDelta>();
  for (const d of deltas) {
    const key = `${d.address}|${assetKey(d.asset)}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        address: d.address,
        asset: d.asset,
        in: ZERO,
        inAtLeast: false,
        out: ZERO,
        outUpTo: false,
        outIsTotal: false,
      };
      rows.set(key, row);
    }
    if (d.bound === 'total') {
      if (d.direction === 'out') row.outIsTotal = true;
      continue;
    }
    if (d.amount === null) continue;
    if (d.direction === 'in') {
      row.in = addAmounts(row.in, d.amount);
      if (d.bound === 'min') row.inAtLeast = true;
    } else {
      row.out = addAmounts(row.out, d.amount);
      if (d.bound === 'max') row.outUpTo = true;
    }
  }
  return [...rows.values()];
}
