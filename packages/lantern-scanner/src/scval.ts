// Lossless, human-inspectable rendering of Soroban `ScVal`s (#53).
//
// Stages 3, 5 and 6 read contract-call arguments through this shape rather
// than the raw XDR: addresses as G…/C… strings, integers as decimal strings
// (never JS numbers — i128/u256 don't fit), symbols and strings as text,
// bytes as hex, vecs and maps structurally. Anything this file doesn't model
// explicitly is kept as its base64 XDR so nothing is thrown away.

import { Address, xdr } from '@stellar/stellar-sdk';

export type DecodedScVal =
  | { type: 'void' }
  | { type: 'bool'; value: boolean }
  | { type: 'u32' | 'i32'; value: string }
  | { type: 'u64' | 'i64' | 'timepoint' | 'duration'; value: string }
  | { type: 'u128' | 'i128' | 'u256' | 'i256'; value: string }
  | { type: 'symbol' | 'string'; value: string }
  | { type: 'bytes'; hex: string }
  | { type: 'address'; value: string }
  | { type: 'vec'; items: DecodedScVal[] }
  | { type: 'map'; entries: Array<{ key: DecodedScVal; value: DecodedScVal }> }
  | { type: 'error'; value: string }
  // Values with no human form (contract instances, nonces, ledger-key
  // markers): the XDR type name plus the base64 so a later stage can still
  // decode them.
  | { type: 'opaque'; xdrType: string; raw: string };

export function decodeScVal(val: xdr.ScVal): DecodedScVal {
  switch (val.switch().name) {
    case 'scvVoid':
      return { type: 'void' };
    case 'scvBool':
      return { type: 'bool', value: val.b() };
    case 'scvU32':
      return { type: 'u32', value: String(val.u32()) };
    case 'scvI32':
      return { type: 'i32', value: String(val.i32()) };
    case 'scvU64':
      return { type: 'u64', value: val.u64().toString() };
    case 'scvI64':
      return { type: 'i64', value: val.i64().toString() };
    case 'scvTimepoint':
      return { type: 'timepoint', value: val.timepoint().toString() };
    case 'scvDuration':
      return { type: 'duration', value: val.duration().toString() };
    case 'scvU128':
      return { type: 'u128', value: bigIntOf(val).toString() };
    case 'scvI128':
      return { type: 'i128', value: bigIntOf(val).toString() };
    case 'scvU256':
      return { type: 'u256', value: bigIntOf(val).toString() };
    case 'scvI256':
      return { type: 'i256', value: bigIntOf(val).toString() };
    case 'scvSymbol':
      return { type: 'symbol', value: val.sym().toString() };
    case 'scvString':
      return { type: 'string', value: val.str().toString() };
    case 'scvBytes':
      return {
        type: 'bytes',
        hex: Array.from(val.bytes(), (b) => b.toString(16).padStart(2, '0')).join(''),
      };
    case 'scvAddress':
      return { type: 'address', value: Address.fromScVal(val).toString() };
    case 'scvVec':
      return { type: 'vec', items: (val.vec() ?? []).map(decodeScVal) };
    case 'scvMap':
      return {
        type: 'map',
        entries: (val.map() ?? []).map((e) => ({
          key: decodeScVal(e.key()),
          value: decodeScVal(e.val()),
        })),
      };
    case 'scvError':
      return { type: 'error', value: val.error().switch().name };
    default:
      return { type: 'opaque', xdrType: val.switch().name, raw: val.toXDR('base64') };
  }
}

// 128/256-bit parts → bigint. The most significant limb is signed for the
// i-types (the SDK gives it as a signed 64-bit), the rest are unsigned, so
// shifting the signed limb and OR-ing the unsigned ones yields the two's
// complement value directly.
function bigIntOf(val: xdr.ScVal): bigint {
  switch (val.switch().name) {
    case 'scvU128': {
      const p = val.u128();
      return (BigInt(p.hi().toString()) << 64n) | BigInt(p.lo().toString());
    }
    case 'scvI128': {
      const p = val.i128();
      return (BigInt(p.hi().toString()) << 64n) | BigInt(p.lo().toString());
    }
    case 'scvU256': {
      const p = val.u256();
      return (
        (BigInt(p.hiHi().toString()) << 192n) |
        (BigInt(p.hiLo().toString()) << 128n) |
        (BigInt(p.loHi().toString()) << 64n) |
        BigInt(p.loLo().toString())
      );
    }
    case 'scvI256': {
      const p = val.i256();
      return (
        (BigInt(p.hiHi().toString()) << 192n) |
        (BigInt(p.hiLo().toString()) << 128n) |
        (BigInt(p.loHi().toString()) << 64n) |
        BigInt(p.loLo().toString())
      );
    }
    default:
      throw new Error(`not a large int: ${val.switch().name}`);
  }
}
