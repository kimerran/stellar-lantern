// Strict validation of the scanner's ExplainInput. Hand-rolled on purpose:
// the shape is small and fixed, and "reject anything the scanner did not
// produce" is the whole point — unknown fields are errors, every string is
// length-capped, every array is count-capped. Whatever passes is exactly the
// `{ verdict, effects }` that buildPrompt reads; nothing else is forwarded.

import type { ExplainInput } from '@lantern/scanner';

export class BadInput extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadInput';
  }
}

const MAX_STR = 200;
const MAX_ARR = 64;
const MAX_ARGS_DEPTH = 4;
const RISKS = new Set(['low', 'medium', 'high']);
const ACTIONS = new Set(['allow', 'warn', 'block_confirm']);
const DIRECTIONS = new Set(['in', 'out']);
const BOUNDS = new Set(['exact', 'max', 'min', 'total']);
const SOURCES = new Set(['classic', 'token', 'simulation']);

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new BadInput(`${path}: object expected`);
  return v as Obj;
}
function onlyKeys(o: Obj, allowed: string[], path: string): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) throw new BadInput(`${path}.${k}: unknown field`);
  }
}
function str(v: unknown, path: string, max = MAX_STR): string {
  if (typeof v !== 'string') throw new BadInput(`${path}: string expected`);
  if (v.length > max) throw new BadInput(`${path}: too long`);
  return v;
}
function optStr(o: Obj, k: string, path: string): string | undefined {
  return o[k] === undefined ? undefined : str(o[k], `${path}.${k}`);
}
function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new BadInput(`${path}: number expected`);
  return v;
}
function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new BadInput(`${path}: boolean expected`);
  return v;
}
function oneOf(v: unknown, set: Set<string>, path: string): string {
  const s = str(v, path);
  if (!set.has(s)) throw new BadInput(`${path}: unexpected value`);
  return s;
}
function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new BadInput(`${path}: array expected`);
  if (v.length > MAX_ARR) throw new BadInput(`${path}: too many items`);
  return v;
}
function strip<T extends Obj>(o: T): T {
  // Drop undefined so the output is a clean object.
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function asset(v: unknown, path: string) {
  const o = obj(v, path);
  onlyKeys(o, ['code', 'issuer', 'contractId', 'decimals'], path);
  const decimals =
    o.decimals === undefined || o.decimals === null
      ? o.decimals
      : num(o.decimals, `${path}.decimals`);
  return strip({
    code: str(o.code, `${path}.code`),
    issuer: optStr(o, 'issuer', path),
    contractId: optStr(o, 'contractId', path),
    decimals: decimals as number | null | undefined,
  });
}

function delta(v: unknown, path: string) {
  const o = obj(v, path);
  onlyKeys(
    o,
    ['address', 'direction', 'asset', 'amount', 'raw', 'bound', 'opIndex', 'depth', 'source'],
    path,
  );
  return strip({
    address: str(o.address, `${path}.address`),
    direction: oneOf(o.direction, DIRECTIONS, `${path}.direction`) as 'in' | 'out',
    asset: asset(o.asset, `${path}.asset`),
    amount: o.amount === null ? null : str(o.amount, `${path}.amount`),
    raw: optStr(o, 'raw', path),
    bound: oneOf(o.bound, BOUNDS, `${path}.bound`) as 'exact' | 'max' | 'min' | 'total',
    opIndex: num(o.opIndex, `${path}.opIndex`),
    depth: o.depth === undefined ? undefined : num(o.depth, `${path}.depth`),
    source: oneOf(o.source, SOURCES, `${path}.source`) as 'classic' | 'token' | 'simulation',
  });
}

function approval(v: unknown, path: string) {
  const o = obj(v, path);
  onlyKeys(
    o,
    [
      'owner',
      'spender',
      'asset',
      'amount',
      'amountScaled',
      'expirationLedger',
      'unlimited',
      'opIndex',
      'depth',
    ],
    path,
  );
  return {
    owner: str(o.owner, `${path}.owner`),
    spender: str(o.spender, `${path}.spender`),
    asset: asset(o.asset, `${path}.asset`),
    amount: str(o.amount, `${path}.amount`),
    amountScaled: o.amountScaled === null ? null : str(o.amountScaled, `${path}.amountScaled`),
    expirationLedger: num(o.expirationLedger, `${path}.expirationLedger`),
    unlimited: bool(o.unlimited, `${path}.unlimited`),
    opIndex: num(o.opIndex, `${path}.opIndex`),
    depth: num(o.depth, `${path}.depth`),
  };
}

// Decoded ScVals are only echoed structurally; the prompt never reads them,
// but they are part of the shape, so they are bounded rather than trusted.
function scval(v: unknown, path: string, depth = 0): unknown {
  if (depth > MAX_ARGS_DEPTH) throw new BadInput(`${path}: too deep`);
  const o = obj(v, path);
  const type = str(o.type, `${path}.type`, 32);
  switch (type) {
    case 'vec':
      return {
        type,
        items: arr(o.items, `${path}.items`).map((x, i) =>
          scval(x, `${path}.items[${i}]`, depth + 1),
        ),
      };
    case 'map':
      return {
        type,
        entries: arr(o.entries, `${path}.entries`).map((e, i) => {
          const eo = obj(e, `${path}.entries[${i}]`);
          onlyKeys(eo, ['key', 'value'], `${path}.entries[${i}]`);
          return {
            key: scval(eo.key, `${path}.entries[${i}].key`, depth + 1),
            value: scval(eo.value, `${path}.entries[${i}].value`, depth + 1),
          };
        }),
      };
    default: {
      onlyKeys(o, ['type', 'value', 'hex', 'xdrType', 'raw'], path);
      const out: Obj = { type };
      for (const k of ['value', 'hex', 'xdrType', 'raw']) {
        if (o[k] === undefined) continue;
        out[k] = typeof o[k] === 'boolean' ? o[k] : str(o[k], `${path}.${k}`, 4096);
      }
      return out;
    }
  }
}

function unverified(v: unknown, path: string) {
  const o = obj(v, path);
  onlyKeys(
    o,
    ['label', 'contractId', 'functionName', 'args', 'depth', 'entryIndex', 'path', 'credentials'],
    path,
  );
  const credentials =
    o.credentials === undefined ? undefined : obj(o.credentials, `${path}.credentials`);
  if (credentials)
    onlyKeys(
      credentials,
      ['kind', 'address', 'nonce', 'signatureExpirationLedger'],
      `${path}.credentials`,
    );
  return strip({
    label: 'unverified contract — semantics unknown' as const,
    contractId: str(o.contractId, `${path}.contractId`),
    functionName: str(o.functionName, `${path}.functionName`),
    args: arr(o.args, `${path}.args`).map((a, i) => scval(a, `${path}.args[${i}]`)),
    depth: num(o.depth, `${path}.depth`),
    entryIndex: o.entryIndex === undefined ? undefined : num(o.entryIndex, `${path}.entryIndex`),
    path:
      o.path === undefined
        ? undefined
        : arr(o.path, `${path}.path`).map((p, i) => num(p, `${path}.path[${i}]`)),
    credentials: credentials as { kind: 'source_account' } | undefined,
  });
}

function reason(v: unknown, path: string) {
  const o = obj(v, path);
  onlyKeys(o, ['code', 'severity', 'title', 'detail', 'ref'], path);
  return strip({
    code: str(o.code, `${path}.code`, 64),
    severity: oneOf(o.severity, RISKS, `${path}.severity`) as 'low' | 'medium' | 'high',
    title: str(o.title, `${path}.title`),
    detail: str(o.detail, `${path}.detail`, 600),
    ref: optStr(o, 'ref', path),
  });
}

export function validateExplainInput(raw: unknown): ExplainInput {
  const root = obj(raw, 'body');
  onlyKeys(root, ['verdict', 'effects'], 'body');
  const v = obj(root.verdict, 'verdict');
  onlyKeys(v, ['risk', 'action', 'reasons', 'signals', 'scope'], 'verdict');
  const e = obj(root.effects, 'effects');
  onlyKeys(
    e,
    [
      'source',
      'effects',
      'deltas',
      'net',
      'closes',
      'contractsTouched',
      'approvals',
      'unverified',
      'observed',
      'observedNet',
      'coverage',
    ],
    'effects',
  );
  const verdict = {
    risk: oneOf(v.risk, RISKS, 'verdict.risk') as 'low' | 'medium' | 'high',
    action: oneOf(v.action, ACTIONS, 'verdict.action') as 'allow' | 'warn' | 'block_confirm',
    reasons: arr(v.reasons, 'verdict.reasons').map((r, i) => reason(r, `verdict.reasons[${i}]`)),
    // Signals are provenance for reviewers; the prompt does not read them.
    signals: [],
    scope: 'effects shown, terms not judged' as const,
  };
  const closes = arr(e.closes ?? [], 'effects.closes').map((c, i) => {
    const o = obj(c, `effects.closes[${i}]`);
    onlyKeys(o, ['address', 'destination', 'opIndex'], `effects.closes[${i}]`);
    return {
      address: str(o.address, 'effects.closes.address'),
      destination: str(o.destination, 'effects.closes.destination'),
      opIndex: num(o.opIndex, 'effects.closes.opIndex'),
    };
  });
  const effects = {
    // The decoded tx is not needed by the prompt and is never forwarded.
    source: null,
    effects: [],
    deltas: arr(e.deltas ?? [], 'effects.deltas').map((d, i) => delta(d, `effects.deltas[${i}]`)),
    net: [],
    closes,
    contractsTouched: arr(e.contractsTouched ?? [], 'effects.contractsTouched').map((c, i) =>
      str(c, `effects.contractsTouched[${i}]`),
    ),
    approvals: arr(e.approvals ?? [], 'effects.approvals').map((a, i) =>
      approval(a, `effects.approvals[${i}]`),
    ),
    unverified: arr(e.unverified ?? [], 'effects.unverified').map((u, i) =>
      unverified(u, `effects.unverified[${i}]`),
    ),
    observed: arr(e.observed ?? [], 'effects.observed').map((d, i) =>
      delta(d, `effects.observed[${i}]`),
    ),
    observedNet: [],
    coverage: (e.coverage === undefined
      ? 'partial'
      : oneOf(e.coverage, new Set(['none', 'partial', 'full']), 'effects.coverage')) as
      | 'none'
      | 'partial'
      | 'full',
  };
  return { verdict, effects } as unknown as ExplainInput;
}
