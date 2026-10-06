import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  type Transaction,
  type xdr,
} from '@stellar/stellar-sdk';
import type { ScanVerdict, ScreenAnswer } from '@lantern/scanner';
import { __setKV, type KV } from '@shared/kv';
import { handle, lock } from '@core/session/handler';
import { checkSigned, signXdrScanInput, signXdrWith, validateSignXdr } from '@core/dapp/sign-xdr';
import {
  beginSignXdr,
  BUSY_ERROR,
  bridgeRequestId,
  refuseWhileBusy,
  withRequestId,
  type SignXdrBridge,
  type SignXdrReview,
} from '@core/miniapps/bridge';
import { scanTx } from '@core/scan/wallet';
import { decideRecheck, recheckTx } from '@core/scan/recheck';
import appsSrc from '../src/popup/screens/Apps.tsx?raw';

// lantern:signXdr (#262): sign a transaction a dApp built — Centient's
// sponsored account + USDC trustline setup — without submitting it.

const pp = Networks.TESTNET;
const SPONSOR_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const SPONSOR = SPONSOR_KP.publicKey();
const USER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
const USER = USER_KP.publicKey();
const OTHER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();
const USDC = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');

function build(source: string, ops: xdr.Operation[], sign?: Keypair): string {
  const b = new TransactionBuilder(new Account(source, '1234'), { fee: BASE_FEE, networkPassphrase: pp });
  for (const op of ops) b.addOperation(op);
  const tx = b.setTimeout(180).build();
  if (sign) tx.sign(sign);
  return tx.toXDR();
}

// Centient's payout setup for a brand-new wallet (lib/stellar/client.ts
// composeSponsoredTrustlineTx), signed by the sponsor before it reaches us.
function centient(user = USER, opts: { sign?: boolean } = { sign: true }): string {
  return build(
    SPONSOR,
    [
      Operation.beginSponsoringFutureReserves({ sponsoredId: user }),
      Operation.createAccount({ destination: user, startingBalance: '0' }),
      Operation.changeTrust({ asset: USDC, source: user }),
      Operation.endSponsoringFutureReserves({ source: user }),
    ],
    opts.sign ? SPONSOR_KP : undefined,
  );
}

const active = { networkPassphrase: pp, address: USER };

describe('validateSignXdr (#262): reject before review', () => {
  it('accepts the sponsor-signed Centient envelope and says who signs what', () => {
    const v = validateSignXdr({ xdr: centient(), networkPassphrase: pp }, active);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.operationCount).toBe(4);
    expect(v.value.existingSignatures).toBe(1);
    expect(v.value.fee).toBe(String(Number(BASE_FEE) * 4));
    expect(v.value.signing).toMatchObject({
      txSource: SPONSOR,
      userIsTxSource: false,
      userOps: [2, 3],
      otherOps: [0, 1],
      otherSigners: [SPONSOR],
    });
  });

  it('rejects a network mismatch', () => {
    const v = validateSignXdr({ xdr: centient(), networkPassphrase: Networks.PUBLIC }, active);
    expect(v).toMatchObject({ ok: false, code: 'network_mismatch' });
  });

  it('rejects XDR that does not decode', () => {
    expect(validateSignXdr({ xdr: 'not-xdr', networkPassphrase: pp }, active)).toMatchObject({
      ok: false,
      code: 'bad_xdr',
    });
    expect(validateSignXdr({ xdr: 'AAAA', networkPassphrase: pp }, active)).toMatchObject({
      ok: false,
      code: 'bad_xdr',
    });
  });

  it('rejects a malformed request', () => {
    expect(validateSignXdr({ networkPassphrase: pp }, active)).toMatchObject({ code: 'invalid_request' });
    expect(validateSignXdr({ xdr: 42, networkPassphrase: pp }, active)).toMatchObject({ code: 'invalid_request' });
    expect(validateSignXdr({ xdr: centient() }, active)).toMatchObject({ code: 'invalid_request' });
    expect(validateSignXdr({ xdr: 'A'.repeat(200_001), networkPassphrase: pp }, active)).toMatchObject({
      code: 'invalid_request',
    });
  });

  it('rejects a fee-bump envelope (documented decision)', () => {
    const inner = TransactionBuilder.fromXDR(centient(), pp) as Transaction;
    const bump = TransactionBuilder.buildFeeBumpTransaction(SPONSOR_KP, '1000', inner, pp);
    const v = validateSignXdr({ xdr: bump.toXDR(), networkPassphrase: pp }, active);
    expect(v).toMatchObject({ ok: false, code: 'fee_bump' });
  });

  it('rejects a transaction that needs nothing from the user', () => {
    const txXdr = build(SPONSOR, [Operation.payment({ destination: OTHER, asset: Asset.native(), amount: '1' })]);
    expect(validateSignXdr({ xdr: txXdr, networkPassphrase: pp }, active)).toMatchObject({
      ok: false,
      code: 'not_a_signer',
    });
  });

  it('accepts a transaction the user is the source of', () => {
    const txXdr = build(USER, [Operation.payment({ destination: OTHER, asset: Asset.native(), amount: '1' })]);
    const v = validateSignXdr({ xdr: txXdr, networkPassphrase: pp }, active);
    expect(v.ok && v.value.signing.userIsTxSource).toBe(true);
  });
});

// ── The bridge: ack first, then exactly one answer ───────────────────────────

function bridge(over: Partial<SignXdrBridge> = {}) {
  const posts: Array<{ type: string; [k: string]: unknown }> = [];
  const b: SignXdrBridge = {
    post: (m) => posts.push(m),
    connected: true,
    address: USER,
    network: 'TESTNET',
    networkPassphrase: pp,
    origin: 'Centient',
    scan: vi.fn(async () => ({ risk: 'low', action: 'allow' }) as unknown as ScanVerdict),
    ...over,
  };
  return { b, posts };
}

describe('beginSignXdr (#262)', () => {
  it('acks with lantern:signing synchronously, before any await', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { b, posts } = bridge({
      post: (m) => {
        order.push(`post:${m.type}`);
        posts.push(m);
      },
      scan: async () => {
        order.push('scan');
        await gate;
        return { risk: 'low', action: 'allow' } as unknown as ScanVerdict;
      },
    });
    const pending = beginSignXdr({ type: 'lantern:signXdr', xdr: centient(), networkPassphrase: pp }, b);
    // No microtask has run yet: the ack must already be out.
    expect(posts).toEqual([{ type: 'lantern:signing' }]);
    expect(order[0]).toBe('post:lantern:signing');
    release();
    const review = await pending;
    expect(order).toEqual(['post:lantern:signing', 'scan']);
    expect(review?.value.signing.userOps).toEqual([2, 3]);
    expect(posts).toHaveLength(1); // nothing more until the user decides
  });

  it('acks a network mismatch, then answers txError without scanning', async () => {
    const { b, posts } = bridge();
    const review = await beginSignXdr(
      { type: 'lantern:signXdr', xdr: centient(), networkPassphrase: Networks.PUBLIC },
      b,
    );
    expect(review).toBeNull();
    expect(b.scan).not.toHaveBeenCalled();
    expect(posts.map((p) => p.type)).toEqual(['lantern:signing', 'lantern:txError']);
    expect(posts[1]!.error).toMatch(/different network/);
  });

  it('acks bad XDR, then answers txError', async () => {
    const { b, posts } = bridge();
    expect(await beginSignXdr({ type: 'lantern:signXdr', xdr: '@@', networkPassphrase: pp }, b)).toBeNull();
    expect(posts.map((p) => p.type)).toEqual(['lantern:signing', 'lantern:txError']);
  });

  it('refuses a site that is not connected, like signAndSubmit', async () => {
    const { b, posts } = bridge({ connected: false });
    expect(await beginSignXdr({ type: 'lantern:signXdr', xdr: centient(), networkPassphrase: pp }, b)).toBeNull();
    expect(posts).toEqual([{ type: 'lantern:txError', error: 'Connect the wallet first.' }]);
  });

  it('answers txError when the scan throws', async () => {
    const { b, posts } = bridge({ scan: async () => Promise.reject(new Error('boom')) });
    expect(await beginSignXdr({ type: 'lantern:signXdr', xdr: centient(), networkPassphrase: pp }, b)).toBeNull();
    expect(posts.map((p) => p.type)).toEqual(['lantern:signing', 'lantern:txError']);
  });

  it('echoes the request id on every reply', async () => {
    const { b, posts } = bridge();
    const review = await beginSignXdr(
      { type: 'lantern:signXdr', xdr: centient(), networkPassphrase: Networks.PUBLIC, id: 'r1' },
      b,
    );
    expect(review).toBeNull();
    expect(posts.every((p) => p.id === 'r1')).toBe(true);
    const ok = bridge();
    const r = await beginSignXdr({ type: 'lantern:signXdr', xdr: centient(), networkPassphrase: pp, id: 7 }, ok.b);
    expect(r?.id).toBe(7);
    expect(ok.posts[0]).toEqual({ type: 'lantern:signing', id: 7 });
  });

  it('only echoes string / finite-number ids', () => {
    expect(bridgeRequestId({ id: 'x' })).toBe('x');
    expect(bridgeRequestId({ id: 3 })).toBe(3);
    expect(bridgeRequestId({ id: {} })).toBeUndefined();
    expect(bridgeRequestId({ id: NaN })).toBeUndefined();
    expect(bridgeRequestId({ id: '' })).toBeUndefined();
    expect(withRequestId({ type: 'lantern:signRejected' }, undefined)).toEqual({ type: 'lantern:signRejected' });
  });

  it('scans without destinationFunded / spendableXlm (the user may not exist yet)', () => {
    const v = validateSignXdr({ xdr: centient(), networkPassphrase: pp }, active);
    if (!v.ok) throw new Error('invalid');
    const input = signXdrScanInput(v.value, { network: 'TESTNET', address: USER, rpcUrl: 'https://rpc' });
    expect(input.context).toEqual({ network: 'TESTNET', fromAddress: USER });
    expect(input.rpcUrl).toBe('https://rpc');
  });
});

// ── Scan + the re-check before signing (#121) for a 0-XLM brand-new wallet ──

const notFlagged = async (_a: string): Promise<ScreenAnswer> => ({ outcome: 'not_flagged', source: 'stub' });

describe('review + re-check for an account that does not exist yet (#262)', () => {
  it('a brand-new user (never funded) scans low and the re-check lets it proceed', async () => {
    const fresh = Keypair.random().publicKey(); // no account on any ledger
    const v = validateSignXdr({ xdr: centient(fresh), networkPassphrase: pp }, { networkPassphrase: pp, address: fresh });
    if (!v.ok) throw new Error(v.error);
    const input = signXdrScanInput(v.value, { network: 'TESTNET', address: fresh, rpcUrl: 'https://rpc.invalid' });
    const reviewed = await scanTx(input, { screen: notFlagged });
    expect(reviewed.risk).toBe('low');
    expect(reviewed.action).toBe('allow');
    expect(reviewed.signing).toMatchObject({ userOps: [2, 3], otherSigners: [SPONSOR] });
    // The re-check never loads the user's account: no account is not a failure.
    const result = await recheckTx(reviewed, input, { depsOverride: { screen: notFlagged } });
    expect(result.ok).toBe(true);
    const decision = decideRecheck(reviewed, result, false);
    expect(decision.proceed).toBe(true);
    expect(decision.state.kind).toBe('passed');
  });
});

// ── SIGN_ONLY keeps the sponsor's signature and adds ours ────────────────────

function memoryKV(): KV {
  const store = new Map<string, string>();
  return {
    get: async (k) => (store.has(k) ? store.get(k)! : null),
    set: async (k, v) => void store.set(k, v),
    remove: async (k) => void store.delete(k),
  };
}

async function unlockedWallet(): Promise<string> {
  const gen = await handle({ type: 'GENERATE_MNEMONIC', strength: 128 });
  if (!gen.ok) throw new Error('mnemonic');
  const created = await handle({
    type: 'CREATE_WALLET',
    mnemonic: (gen.data as { mnemonic: string }).mnemonic,
    password: 'pw',
  });
  if (!created.ok) throw new Error('create');
  return (created.data as { address: string }).address;
}

describe('signXdrWith via SIGN_ONLY (#262)', () => {
  beforeEach(() => {
    __setKV(memoryKV());
    lock();
  });

  it('returns the envelope with both signatures, both verifying, unsubmitted', async () => {
    const me = await unlockedWallet();
    const sponsorSigned = centient(me);
    const send = vi.fn((req: { type: 'SIGN_ONLY'; xdr: string; networkPassphrase: string }) =>
      handle(req) as Promise<{ ok: true; data: { signedXdr: string } }>,
    );
    const res = await signXdrWith(send, { xdr: sponsorSigned, networkPassphrase: pp }, me);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].type).toBe('SIGN_ONLY');

    const signed = TransactionBuilder.fromXDR(res.data.signedXdr, pp);
    expect(signed.signatures).toHaveLength(2);
    const hash = signed.hash();
    const [first, second] = signed.signatures;
    expect(SPONSOR_KP.verify(hash, first!.signature())).toBe(true);
    expect(Keypair.fromPublicKey(me).verify(hash, second!.signature())).toBe(true);
    // Same transaction as the one reviewed.
    expect(hash.equals(TransactionBuilder.fromXDR(sponsorSigned, pp).hash())).toBe(true);
  });

  it('passes a LOCKED wallet through as an error', async () => {
    const res = await signXdrWith(handle as never, { xdr: centient(), networkPassphrase: pp }, USER);
    expect(res).toMatchObject({ ok: false, code: 'LOCKED' });
  });

  it('checkSigned catches a lost signature, a different tx and a missing signature', () => {
    const sponsorSigned = centient(USER);
    const unsigned = centient(USER, { sign: false });
    const ours = TransactionBuilder.fromXDR(unsigned, pp);
    ours.sign(USER_KP); // our signature but the sponsor's dropped
    expect(checkSigned(sponsorSigned, ours.toXDR(), pp, USER)).toMatch(/lost/);
    expect(checkSigned(sponsorSigned, sponsorSigned, pp, USER)).toMatch(/missing/);
    const other = TransactionBuilder.fromXDR(centient(OTHER), pp);
    other.sign(USER_KP);
    expect(checkSigned(sponsorSigned, other.toXDR(), pp, USER)).toMatch(/does not match/);
    const good = TransactionBuilder.fromXDR(sponsorSigned, pp);
    good.sign(USER_KP);
    expect(checkSigned(sponsorSigned, good.toXDR(), pp, USER)).toBeNull();
  });
});

// ── One request at a time (review F1) ────────────────────────────────────────
//
// Apps.tsx can't be rendered under the node test env, so this mirrors its
// flow with the same pieces: beginSignXdr → refuseWhileBusy → open review;
// approve → SIGN_ONLY → xdrSigned → close only the reviewed xdr. The wiring
// test below pins Apps.tsx to that shape.

describe('a second request while one is under review (review F1)', () => {
  beforeEach(() => {
    __setKV(memoryKV());
    lock();
  });

  function appsLike(
    me: string,
    send: (req: { type: 'SIGN_ONLY'; xdr: string; networkPassphrase: string }) => Promise<unknown>,
  ) {
    const { b, posts } = bridge({ address: me });
    let open: SignXdrReview | null = null;
    let submitting = false;
    const busy = () => open !== null || submitting;
    return {
      posts,
      get open() {
        return open;
      },
      async request(data: unknown) {
        const review = await beginSignXdr(data, b);
        if (!review) return;
        if (refuseWhileBusy(busy(), review.id, b.post)) return;
        open = review;
      },
      async approve() {
        const req = open!;
        submitting = true;
        const res = await signXdrWith(
          send as never,
          { xdr: req.value.xdr, networkPassphrase: pp },
          me,
        );
        submitting = false;
        if (res.ok) {
          b.post(
            withRequestId({ type: 'lantern:xdrSigned', signedXdr: res.data.signedXdr }, req.id),
          );
          if (open?.value.xdr === req.value.xdr) open = null;
        }
      },
    };
  }

  it('refuses the second with txError and its own id; the first completes with one xdrSigned', async () => {
    const me = await unlockedWallet();
    const first = centient(me);
    const second = build(me, [
      Operation.payment({ destination: OTHER, asset: Asset.native(), amount: '1' }),
    ]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const send = vi.fn(
      async (req: { type: 'SIGN_ONLY'; xdr: string; networkPassphrase: string }) => {
        await gate;
        return handle(req);
      },
    );
    const app = appsLike(me, send);

    await app.request({ type: 'lantern:signXdr', xdr: first, networkPassphrase: pp, id: 'a' });
    expect(app.open?.id).toBe('a');

    // While the review is open: refused, review unchanged.
    await app.request({ type: 'lantern:signXdr', xdr: second, networkPassphrase: pp, id: 'b' });
    expect(app.open?.id).toBe('a');
    expect(app.open?.value.xdr).toBe(first);

    // While the first is being signed: refused too.
    const approving = app.approve();
    await app.request({ type: 'lantern:signXdr', xdr: second, networkPassphrase: pp, id: 'c' });
    release();
    await approving;

    const types = app.posts.map((m) => `${m.type}:${String(m.id)}`);
    expect(types).toEqual([
      'lantern:signing:a',
      'lantern:signing:b',
      'lantern:txError:b',
      'lantern:signing:c',
      'lantern:txError:c',
      'lantern:xdrSigned:a',
    ]);
    expect(
      app.posts.filter((m) => m.type === 'lantern:txError').every((m) => m.error === BUSY_ERROR),
    ).toBe(true);
    // Only the first was ever signed.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].xdr).toBe(first);
    const signed = app.posts.filter((m) => m.type === 'lantern:xdrSigned');
    expect(signed).toHaveLength(1);
    expect(TransactionBuilder.fromXDR(signed[0]!.signedXdr as string, pp).hash()).toEqual(
      TransactionBuilder.fromXDR(first, pp).hash(),
    );
    expect(app.open).toBeNull();
  });

  it('refuseWhileBusy replies nothing when idle and echoes only a valid id', () => {
    const posts: unknown[] = [];
    expect(refuseWhileBusy(false, 'x', (m) => posts.push(m))).toBe(false);
    expect(posts).toEqual([]);
    expect(refuseWhileBusy(true, undefined, (m) => posts.push(m))).toBe(true);
    expect(posts).toEqual([
      { type: 'lantern:txError', error: 'Another request is waiting for review.' },
    ]);
  });
});

describe('Apps.tsx wiring (#262)', () => {
  it('refuses a new request while a review is open or signing, never replaces it (review F1)', () => {
    expect(appsSrc).not.toMatch(/replacePending/);
    expect(appsSrc).toMatch(/signReqRef\.current !== null \|\| submittingRef\.current/);
    // signXdr: checked after beginSignXdr resolves, before any review state changes.
    const xdrFn = appsSrc.slice(appsSrc.indexOf('async function prepareSignXdr('));
    const begin = xdrFn.indexOf('await beginSignXdr(');
    const gate = xdrFn.indexOf('refuseWhileBusy(reviewBusy(), review.id, postToApp)');
    expect(begin).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(begin);
    expect(gate).toBeLessThan(xdrFn.indexOf("setConfirmText('')"));
    expect(gate).toBeLessThan(xdrFn.indexOf('setSignReq('));
    // Intents: the same rule, with the request's own id.
    const intentFn = appsSrc.slice(
      appsSrc.indexOf('async function prepareSign('),
      appsSrc.indexOf('function reviewBusy('),
    );
    const igate = intentFn.indexOf('refuseWhileBusy(reviewBusy(), id, postToApp)');
    expect(igate).toBeGreaterThan(intentFn.indexOf('await scanTx('));
    expect(igate).toBeLessThan(intentFn.indexOf("setConfirmText('')"));
    expect(appsSrc).toMatch(/prepareSign\(data\.intent, bridgeRequestId\(data\)\)/);
    // approveSign closes only the review it signed.
    const approve = appsSrc.slice(
      appsSrc.indexOf('async function approveSign('),
      appsSrc.indexOf('function rejectSign('),
    );
    expect(approve).not.toMatch(/setSignReq\(null\)/);
    expect(
      approve.match(/setSignReq\(\(cur\) => \(cur\?\.xdr === signReq\.xdr \? null : cur\)\)/g),
    ).toHaveLength(2);
  });

  it('handles lantern:signXdr through beginSignXdr and signs with SIGN_ONLY, never SIGN_AND_SUBMIT', () => {
    expect(appsSrc).toMatch(/data\?\.type === 'lantern:signXdr'/);
    expect(appsSrc).toMatch(/beginSignXdr\(data,/);
    // The xdr branch signs via signXdrWith (SIGN_ONLY) and returns before the submit path.
    const xdrBranch = appsSrc.slice(appsSrc.indexOf("if (signReq.kind === 'xdr') {"));
    const ret = xdrBranch.indexOf('return;');
    expect(xdrBranch.slice(0, ret)).toMatch(/signXdrWith\(/);
    expect(xdrBranch.slice(0, ret)).not.toMatch(/SIGN_AND_SUBMIT/);
    expect(xdrBranch.slice(0, ret)).toMatch(/lantern:xdrSigned/);
    // The re-check guard runs before it.
    expect(appsSrc.indexOf('await recheck.guard(')).toBeLessThan(appsSrc.indexOf('signXdrWith('));
  });
});
