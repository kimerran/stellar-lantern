// Stage 3a — Effects from classic operations (#54).
//
// Turns the value-moving classic ops — payment, createAccount, both path
// payments, accountMerge — into per-address AssetDeltas and aggregates them
// per (address, asset) into NetDeltas. Exact decimal strings throughout; see
// decimal.ts. Token-interface calls are 3b (#55); everything else is 3c (#56).

import type { AssetDelta, AssetRef, DecodedOp, DecodedTx, NetDelta } from './types';
import { toStroops } from './decimal';
import { scaleAmount } from './token';

// The account an op acts for: its own source override, else the tx source,
// else the caller-supplied fallback (a hand-built DecodedTx without `source`).
export function opSource(tx: DecodedTx, op: DecodedOp, fallback: string): string {
  return op.sourceAccount ?? tx.source ?? fallback;
}

function asset(code: string | undefined, issuer: string | undefined): AssetRef {
  const c = code ?? 'XLM';
  return c === 'XLM' && !issuer
    ? { code: 'XLM', decimals: 7 }
    : { code: c, ...(issuer ? { issuer } : {}), decimals: 7 };
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

// Native XLM moved by a classic op and by the native SAC are the same asset,
// so both key as XLM:native; other tokens key by contract id.
export function assetKey(a: AssetRef): string {
  if (a.code === 'XLM' && !a.issuer) return 'XLM:native';
  return a.contractId ?? `${a.code}:${a.issuer ?? 'native'}`;
}

// Base units of a delta: stroops for a classic amount, the raw i128 for a
// token call. Null when nothing can be summed (a `total`, or an amount that
// is neither).
function units(d: AssetDelta): bigint | null {
  if (d.raw !== undefined) return BigInt(d.raw);
  if (d.amount === null) return null;
  return toStroops(d.amount);
}

function render(sum: bigint, decimals: number | null | undefined): string {
  return decimals === null ? sum.toString() : scaleAmount(sum, decimals ?? 7)!;
}

// Aggregate deltas per (address, asset). `total` outflows set `outIsTotal`
// and add nothing to `out` (there is no number to add); a `total` inflow is
// unknowable here and is left out of `in` but still keeps the row. Sums are
// bigint base units, rendered once at the end by the asset's decimals.
export function aggregate(deltas: AssetDelta[]): NetDelta[] {
  interface Acc {
    row: NetDelta;
    inUnits: bigint;
    outUnits: bigint;
  }
  const rows = new Map<string, Acc>();
  for (const d of deltas) {
    const key = `${d.address}|${assetKey(d.asset)}`;
    let acc = rows.get(key);
    if (!acc) {
      acc = {
        row: {
          address: d.address,
          asset: d.asset,
          in: '',
          inAtLeast: false,
          out: '',
          outUpTo: false,
          outIsTotal: false,
        },
        inUnits: 0n,
        outUnits: 0n,
      };
      rows.set(key, acc);
    }
    if (d.bound === 'total') {
      if (d.direction === 'out') acc.row.outIsTotal = true;
      continue;
    }
    const u = units(d);
    if (u === null) continue;
    if (d.direction === 'in') {
      acc.inUnits += u;
      if (d.bound === 'min') acc.row.inAtLeast = true;
    } else {
      acc.outUnits += u;
      if (d.bound === 'max') acc.row.outUpTo = true;
    }
  }
  return [...rows.values()].map(({ row, inUnits, outUnits }) => ({
    ...row,
    in: render(inUnits, row.asset.decimals),
    out: render(outUnits, row.asset.decimals),
  }));
}
