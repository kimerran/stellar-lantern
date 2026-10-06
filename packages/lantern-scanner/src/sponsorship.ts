// Sponsorship, trustlines and transactions someone else built (#261).
//
// A dApp that sets a user up (Centient's payout setup, lib/stellar/client.ts)
// hands over a transaction whose SOURCE is the dApp's sponsor, wrapping the
// user's own operations in a sponsorship sandwich:
//
//   beginSponsoringFutureReserves({ sponsoredId: user })   source: sponsor
//   createAccount({ destination: user, startingBalance })  source: sponsor (only if new)
//   changeTrust({ asset })                                 source: user
//   endSponsoringFutureReserves()                          source: user
//
// The user signs only for the ops whose source is them. This module works out
// who signs what, recognises that pattern, and finds what else a user's
// signature would authorize. Pure: no I/O, no clock.

import { MuxedAccount, StrKey } from '@stellar/stellar-sdk';
import type { DecodedOp, DecodedTx, OpSigner, SigningRequirements } from './types';

export const SPONSORSHIP_OP_TYPES: ReadonlySet<string> = new Set([
  'beginSponsoringFutureReserves',
  'endSponsoringFutureReserves',
  'revokeSponsorship',
]);

// What a user's signature may authorize in a transaction someone else built
// (or one that uses sponsorship) without that being a red flag: adding or
// removing their own trustline, and closing the sponsorship around it.
// Creating the user's account is the sponsor's op (its source is the sponsor).
const SETUP_OP_TYPES: ReadonlySet<string> = new Set(['changeTrust', 'endSponsoringFutureReserves']);

// M… → its base G…; anything else unchanged.
export function baseAccount(address: string): string {
  try {
    return StrKey.isValidMed25519PublicKey(address)
      ? MuxedAccount.fromAddress(address, '0').baseAccount().accountId()
      : address;
  } catch {
    return address;
  }
}

/**
 * Which ops need `user`'s signature (their source, explicit or inherited, is
 * the user) and which are someone else's. See `SigningRequirements`.
 */
export function signingRequirements(tx: DecodedTx, user: string): SigningRequirements {
  const me = baseAccount(user);
  const txSource = baseAccount(tx.source ?? user);
  const ops: OpSigner[] = tx.operations.map((op, opIndex) => {
    const source = baseAccount(op.sourceAccount ?? txSource);
    return {
      opIndex,
      type: op.type,
      source,
      explicitSource: op.sourceAccount !== undefined,
      byUser: source === me,
    };
  });
  const others: string[] = [];
  for (const a of [txSource, ...ops.map((o) => o.source)]) {
    if (a !== me && !others.includes(a)) others.push(a);
  }
  return {
    user: me,
    txSource,
    userIsTxSource: txSource === me,
    userOps: ops.filter((o) => o.byUser).map((o) => o.opIndex),
    otherOps: ops.filter((o) => !o.byUser).map((o) => o.opIndex),
    otherSigners: others,
    ops,
  };
}

/** A recognised sponsored-setup transaction (the Centient pattern). */
export interface SponsoredSetup {
  sponsor: string; // pays the reserves (and, as tx source, the fee)
  sponsored: string; // the account being set up
  // The sponsor creates the sponsored account in this transaction.
  createsAccount: boolean;
  startingBalance?: string; // when createsAccount; usually "0"
  trustlines: Array<{ code: string; issuer?: string }>;
  // The sponsor is also the transaction source, so it pays the fee too.
  sponsorPaysFee: boolean;
}

/**
 * The sponsored-setup pattern, exactly: one `beginSponsoringFutureReserves`
 * first, optionally the sponsor's `createAccount` of the sponsored account,
 * one or more `changeTrust` ADDING a trustline for the sponsored account, and
 * the sponsored account's `endSponsoringFutureReserves` last. Anything else in
 * the transaction — a payment, a second sandwich, a trustline removal — and
 * it is not this pattern (null), so the explainer falls back to the per-op
 * list and nothing is summarised away.
 */
export function sponsoredSetup(tx: DecodedTx | null): SponsoredSetup | null {
  if (!tx || tx.operations.length < 3) return null;
  const ops = tx.operations;
  const txSource = tx.source ? baseAccount(tx.source) : undefined;
  const src = (op: DecodedOp): string | undefined =>
    op.sourceAccount ? baseAccount(op.sourceAccount) : txSource;
  const begin = ops[0]!;
  const end = ops[ops.length - 1]!;
  if (begin.type !== 'beginSponsoringFutureReserves' || !begin.sponsoredId) return null;
  if (end.type !== 'endSponsoringFutureReserves') return null;
  const sponsor = src(begin);
  const sponsored = baseAccount(begin.sponsoredId);
  if (!sponsor || sponsor === sponsored || src(end) !== sponsored) return null;

  let i = 1;
  let createsAccount = false;
  let startingBalance: string | undefined;
  const middle = ops[i]!;
  if (middle.type === 'createAccount') {
    if (!middle.destination || baseAccount(middle.destination) !== sponsored) return null;
    if (src(middle) !== sponsor) return null;
    createsAccount = true;
    startingBalance = middle.amount;
    i += 1;
  }
  const trustlines: SponsoredSetup['trustlines'] = [];
  for (; i < ops.length - 1; i += 1) {
    const op = ops[i]!;
    if (op.type !== 'changeTrust' || src(op) !== sponsored || isRemoval(op)) return null;
    trustlines.push({
      code: op.assetCode ?? 'an asset',
      ...(op.assetIssuer ? { issuer: op.assetIssuer } : {}),
    });
  }
  if (trustlines.length === 0) return null;
  return {
    sponsor,
    sponsored,
    createsAccount,
    ...(startingBalance !== undefined ? { startingBalance } : {}),
    trustlines,
    sponsorPaysFee: txSource === sponsor,
  };
}

/** A changeTrust with a zero limit removes the trustline. */
export function isRemoval(op: DecodedOp): boolean {
  return op.type === 'changeTrust' && op.trustLimit !== undefined && Number(op.trustLimit) === 0;
}

/**
 * The ops a user's signature would authorize beyond setting up their account
 * (#261): in a transaction someone else is the source of, or one that uses
 * sponsorship, every op acting for the user other than `changeTrust` and
 * `endSponsoringFutureReserves` — a payment from the user, a setOptions, an
 * accountMerge, the user sponsoring someone else's reserves. Empty for a
 * transaction the user built for themselves without sponsorship: that is an
 * ordinary transaction the other rules judge.
 *
 * One carve-out: a contract call (`invokeHostFunction`) in a transaction
 * that only has someone else as its FEE source (no sponsorship) is how a
 * fee-sponsored Soroban dApp works; the pipeline's auth and effects stages
 * judge what that call authorizes, so it is not flagged here. Inside a
 * sponsorship sandwich nothing but setup is expected, so it is.
 */
export function beyondSetup(tx: DecodedTx, signing: SigningRequirements): number[] {
  const foreign = !signing.userIsTxSource;
  const sponsored = tx.operations.some((op) => SPONSORSHIP_OP_TYPES.has(op.type));
  if (!foreign && !sponsored) return [];
  return signing.ops
    .filter((o) => o.byUser && !SETUP_OP_TYPES.has(o.type))
    .filter((o) => sponsored || o.type !== 'invokeHostFunction')
    .map((o) => o.opIndex);
}

const shortAddr = (a: string): string => (a.length > 8 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

/**
 * What one op the user's signature would authorize does, as a short noun
 * phrase for a reason's detail: "sending 100 XLM to GATT…ACKR".
 */
export function authorizedAction(op: DecodedOp): string {
  const to = op.destination ? shortAddr(op.destination) : 'another account';
  switch (op.type) {
    case 'payment':
      return `sending ${op.amount ?? 'an amount of'} ${op.assetCode ?? 'XLM'} to ${to}`;
    case 'pathPaymentStrictSend':
    case 'pathPaymentStrictReceive':
      return `spending ${op.type === 'pathPaymentStrictReceive' ? 'up to ' : ''}${op.sendAmount ?? 'an amount of'} ${op.sendAssetCode ?? 'XLM'} in a swap paid to ${to}`;
    case 'createAccount':
      return `funding a new account ${to} with ${op.amount ?? 'some'} XLM`;
    case 'accountMerge':
      return `closing your account and sending everything to ${to}`;
    case 'setOptions':
      return 'changing your account’s settings or who controls it';
    case 'beginSponsoringFutureReserves':
      return `paying the reserves for ${op.sponsoredId ? shortAddr(op.sponsoredId) : 'another account'}`;
    case 'revokeSponsorship':
      return 'ending a reserve sponsorship you pay for';
    case 'invokeHostFunction':
      return op.contractFunction
        ? `calling “${op.contractFunction}” on a smart contract`
        : 'a smart contract call';
    default:
      return `a “${op.type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}” operation`;
  }
}

/** The reason detail for `beyondSetup` ops (shared by both verdict engines). */
export function beyondSetupDetail(
  tx: DecodedTx,
  signing: SigningRequirements,
  opIndexes: number[],
): string {
  const actions = opIndexes.slice(0, 3).map((i) => authorizedAction(tx.operations[i]!));
  const more = opIndexes.length - actions.length;
  const list = actions.join('; ') + (more > 0 ? `; and ${more} more` : '');
  const lead = signing.userIsTxSource
    ? 'This transaction uses reserve sponsorship, and besides setting up your account your signature would also approve'
    : `${shortAddr(signing.txSource)} built this transaction, and besides setting up your account your signature would also approve`;
  return `${lead}: ${list}. Only continue if you set this up yourself.`;
}
