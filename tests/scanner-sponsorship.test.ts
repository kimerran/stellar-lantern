import { describe, it, expect } from 'vitest';
import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  LiquidityPoolAsset,
  MuxedAccount,
  Networks,
  Operation,
  TransactionBuilder,
  type xdr,
} from '@stellar/stellar-sdk';
import {
  scan,
  runPipeline,
  decodeTransaction,
  explainTransaction,
  signingRequirements,
  sponsoredSetup,
  DEMO_FLAGGED_ADDRESSES,
  type ScreenLookup,
} from '@lantern/scanner';

// Sponsored account + trustline setup, and transactions whose source isn't the
// user (#261). The fixtures are Centient's payout-setup envelope
// (artisam-centient/centient lib/stellar/client.ts `composeSponsoredTrustlineTx`),
// rebuilt here with the SDK exactly as Centient builds it on testnet:
//
//   new TransactionBuilder(sponsorAccount, { fee: BASE_FEE, networkPassphrase })
//     .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: user }))
//     [.addOperation(Operation.createAccount({ destination: user, startingBalance: "0" }))]
//     .addOperation(Operation.changeTrust({ asset: usdc, source: user }))
//     .addOperation(Operation.endSponsoringFutureReserves({ source: user }))
//     .setTimeout(180).build()

const pp = Networks.TESTNET;
// Deterministic keys so the expected sentences can name them.
const SPONSOR_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const SPONSOR = SPONSOR_KP.publicKey();
const USER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
const ATTACKER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();
// Circle's testnet USDC issuer: what Centient's `usdcAsset()` resolves to.
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);
const FLAGGED = [...DEMO_FLAGGED_ADDRESSES][0]!;
const short = (a: string) => `${a.slice(0, 4)}...${a.slice(-4)}`;

function build(
  source: string,
  ops: xdr.Operation[],
  opts: { sign?: Keypair } = {},
): string {
  const b = new TransactionBuilder(new Account(source, '1234'), { fee: BASE_FEE, networkPassphrase: pp });
  for (const op of ops) b.addOperation(op);
  const tx = b.setTimeout(180).build();
  if (opts.sign) tx.sign(opts.sign);
  return tx.toXDR();
}

function centient(opts: { exists: boolean; extra?: xdr.Operation[]; asset?: Asset; sign?: boolean }): string {
  return build(
    SPONSOR,
    [
      Operation.beginSponsoringFutureReserves({ sponsoredId: USER }),
      ...(opts.exists ? [] : [Operation.createAccount({ destination: USER, startingBalance: '0' })]),
      Operation.changeTrust({ asset: opts.asset ?? USDC, source: USER }),
      ...(opts.extra ?? []),
      Operation.endSponsoringFutureReserves({ source: USER }),
    ],
    opts.sign ? { sign: SPONSOR_KP } : {},
  );
}

const ctx = { network: 'TESTNET' as const, fromAddress: USER, destinationFunded: true, spendableXlm: '100' };
const legacy = (txXdr: string) => scan({ xdr: txXdr, networkPassphrase: pp, context: ctx });
const clean: ScreenLookup = async () => ({ outcome: 'not_flagged', source: 'registry' });
const pipeline = (txXdr: string, screen: ScreenLookup = clean) =>
  runPipeline({ xdr: txXdr, networkPassphrase: pp, context: ctx }, { screen });
const codes = (rs: ReadonlyArray<{ code: string }>) => rs.map((r) => r.code);

describe('decode: sponsorship + trustline ops (#261)', () => {
  it('beginSponsoringFutureReserves carries the sponsored account', () => {
    const op = decodeTransaction(build(SPONSOR, [Operation.beginSponsoringFutureReserves({ sponsoredId: USER })]), pp)!
      .operations[0];
    expect(op).toEqual({ type: 'beginSponsoringFutureReserves', sponsoredId: USER });
  });

  it('endSponsoringFutureReserves carries its (user) source', () => {
    const op = decodeTransaction(build(SPONSOR, [Operation.endSponsoringFutureReserves({ source: USER })]), pp)!
      .operations[0];
    expect(op).toEqual({ type: 'endSponsoringFutureReserves', sourceAccount: USER });
  });

  it('changeTrust: asset, issuer and limit (default = no limit)', () => {
    const op = decodeTransaction(build(USER, [Operation.changeTrust({ asset: USDC })]), pp)!.operations[0];
    expect(op).toEqual({
      type: 'changeTrust',
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUER,
      trustLimit: '922337203685.4775807',
    });
  });

  it('changeTrust: an explicit limit, a removal (limit 0), and a pool-share line', () => {
    const ops = decodeTransaction(
      build(USER, [
        Operation.changeTrust({ asset: USDC, limit: '500' }),
        Operation.changeTrust({ asset: USDC, limit: '0' }),
        Operation.changeTrust({ asset: new LiquidityPoolAsset(Asset.native(), USDC, 30) }),
      ]),
      pp,
    )!.operations;
    expect(ops[0]!.trustLimit).toBe('500.0000000');
    expect(ops[1]!.trustLimit).toBe('0.0000000');
    expect(ops[2]!.assetCode).toBe('liquidity pool share');
    expect(ops[2]!.assetIssuer).toBeUndefined();
  });

  it('folds every revoke…Sponsorship into revokeSponsorship with the entry and its account', () => {
    const ops = decodeTransaction(
      build(SPONSOR, [
        Operation.revokeAccountSponsorship({ account: USER }),
        Operation.revokeTrustlineSponsorship({ account: USER, asset: USDC }),
        Operation.revokeDataSponsorship({ account: USER, name: 'x' }),
        Operation.revokeSignerSponsorship({ account: USER, signer: { ed25519PublicKey: ATTACKER } }),
        Operation.revokeOfferSponsorship({ seller: USER, offerId: '12' }),
        Operation.revokeClaimableBalanceSponsorship({
          balanceId: '00000000da0d57da7d4850e7fc10d2a9d0ebc731f7afb40574c03395b17d49149b91f5be',
        }),
      ]),
      pp,
    )!.operations;
    expect(ops.map((o) => [o.type, o.revokeEntry, o.revokeAccount])).toEqual([
      ['revokeSponsorship', 'account', USER],
      ['revokeSponsorship', 'trustline', USER],
      ['revokeSponsorship', 'data', USER],
      ['revokeSponsorship', 'signer', USER],
      ['revokeSponsorship', 'offer', USER],
      ['revokeSponsorship', 'claimableBalance', undefined],
    ]);
    expect(ops[1]).toMatchObject({ assetCode: 'USDC', assetIssuer: USDC_ISSUER });
  });
});

describe('explain: the new op types on their own (#261)', () => {
  const one = (op: xdr.Operation, source = USER) => explainTransaction(decodeTransaction(build(source, [op]), pp));
  it('changeTrust', () => {
    expect(one(Operation.changeTrust({ asset: USDC }))).toBe(
      `This adds a USDC trustline (issuer ${short(USDC_ISSUER)}), so the account can hold USDC.`,
    );
    expect(one(Operation.changeTrust({ asset: USDC, limit: '500' }))).toBe(
      `This adds a USDC trustline (issuer ${short(USDC_ISSUER)}), with a limit of 500 USDC, so the account can hold USDC.`,
    );
    expect(one(Operation.changeTrust({ asset: USDC, limit: '0' }))).toBe(
      `This removes the USDC trustline (issuer ${short(USDC_ISSUER)}).`,
    );
  });
  it('begin / end / revoke sponsorship', () => {
    expect(one(Operation.beginSponsoringFutureReserves({ sponsoredId: USER }), SPONSOR)).toBe(
      `This has ${short(SPONSOR)} pay the reserves for anything ${short(USER)} adds next, until ${short(USER)} ends the sponsorship.`,
    );
    expect(one(Operation.endSponsoringFutureReserves({}))).toBe(
      `This ends the reserve sponsorship for ${short(USER)}.`,
    );
    expect(one(Operation.revokeTrustlineSponsorship({ account: USER, asset: USDC }), SPONSOR)).toBe(
      `This stops sponsoring the reserve for the USDC trustline of ${short(USER)}; that account must then hold the reserve itself.`,
    );
  });
});

describe('the Centient sponsored-setup pattern (#261)', () => {
  it('with createAccount: one plain sentence, low risk, user signs only their own ops', async () => {
    const txXdr = centient({ exists: false });
    const expected = `${short(SPONSOR)} pays to create your account and add a USDC trustline (issuer ${short(USDC_ISSUER)}). You pay nothing.`;
    expect(sponsoredSetup(decodeTransaction(txXdr, pp))).toMatchObject({
      sponsor: SPONSOR,
      sponsored: USER,
      createsAccount: true,
      sponsorPaysFee: true,
    });

    const v = legacy(txXdr);
    expect(v.explanation).toBe(expected);
    expect(v.risk).toBe('low');
    expect(v.reasons).toEqual([]);
    expect(v.signing).toMatchObject({
      user: USER,
      txSource: SPONSOR,
      userIsTxSource: false,
      userOps: [2, 3],
      otherOps: [0, 1],
      otherSigners: [SPONSOR],
    });

    const r = await pipeline(txXdr);
    expect(r.explanation).toBe(expected);
    expect(r.risk).toBe('low');
    expect(r.reasons).toEqual([]);
    expect(r.effects.coverage).toBe('full');
    expect(r.signing).toMatchObject({ userOps: [2, 3], otherOps: [0, 1], otherSigners: [SPONSOR] });
    expect(r.signing!.ops.map((o) => [o.type, o.explicitSource, o.byUser])).toEqual([
      ['beginSponsoringFutureReserves', false, false],
      ['createAccount', false, false],
      ['changeTrust', true, true],
      ['endSponsoringFutureReserves', true, true],
    ]);
    // The trustline's issuer and the sponsor are screened like any counterparty.
    expect(r.screen.checked).toEqual(expect.arrayContaining([USDC_ISSUER, SPONSOR]));
  });

  it('without createAccount (the account exists): reserve-only sentence, low risk', async () => {
    const txXdr = centient({ exists: true });
    const expected = `${short(SPONSOR)} pays the reserve to add a USDC trustline (issuer ${short(USDC_ISSUER)}) to your account. You pay nothing.`;
    const v = legacy(txXdr);
    expect(v.explanation).toBe(expected);
    expect(v.risk).toBe('low');
    expect(v.signing).toMatchObject({ userOps: [1, 2], otherOps: [0] });
    const r = await pipeline(txXdr);
    expect(r.explanation).toBe(expected);
    expect(r.risk).toBe('low');
  });

  it('several trustlines in one sandwich are named together', () => {
    const EURC = new Asset('EURC', ATTACKER);
    const txXdr = build(SPONSOR, [
      Operation.beginSponsoringFutureReserves({ sponsoredId: USER }),
      Operation.changeTrust({ asset: USDC, source: USER }),
      Operation.changeTrust({ asset: EURC, source: USER }),
      Operation.endSponsoringFutureReserves({ source: USER }),
    ]);
    expect(legacy(txXdr).explanation).toBe(
      `${short(SPONSOR)} pays the reserve to add trustlines for USDC (issuer ${short(USDC_ISSUER)}) and EURC (issuer ${short(ATTACKER)}) to your account. You pay nothing.`,
    );
  });

  it('a sponsor-signed envelope reads the same (signatures do not change the scan)', () => {
    expect(legacy(centient({ exists: false, sign: true })).explanation).toBe(
      legacy(centient({ exists: false })).explanation,
    );
  });

  it('names the account when the reviewer is not the one being set up', () => {
    const txXdr = centient({ exists: true });
    expect(explainTransaction(decodeTransaction(txXdr, pp), ATTACKER)).toBe(
      `${short(SPONSOR)} pays the reserve to add a USDC trustline (issuer ${short(USDC_ISSUER)}) to account ${short(USER)}. That account pays nothing.`,
    );
  });

  it('MALICIOUS: the same pattern plus a payment from the user is high, never low', async () => {
    const txXdr = centient({
      exists: false,
      extra: [Operation.payment({ destination: ATTACKER, asset: Asset.native(), amount: '25', source: USER })],
    });
    const v = legacy(txXdr);
    expect(v.risk).toBe('high');
    expect(v.action).toBe('block_confirm');
    expect(codes(v.reasons)).toContain('authorizes_beyond_setup');
    const reason = v.reasons.find((x) => x.code === 'authorizes_beyond_setup')!;
    expect(reason.detail).toContain('sending 25.0000000 XLM to');
    expect(v.signing!.userOps).toEqual([2, 3, 4]);
    // Not summarised as a setup: every op listed, each saying whose signature.
    expect(v.explanation).not.toMatch(/You pay nothing/);
    expect(v.explanation).toContain('This transaction has 5 operations:');
    expect(v.explanation).toContain(`4. Sends 25 XLM to ${short(ATTACKER)} — needs your signature.`);
    expect(v.explanation).toContain(`2. Creates a new account ${short(USER)} with no starting balance — signed by ${short(SPONSOR)}.`);

    const r = await pipeline(txXdr);
    expect(r.risk).toBe('high');
    expect(codes(r.reasons)).toContain('authorizes_beyond_setup');
    expect(r.reasons.find((x) => x.code === 'authorizes_beyond_setup')!.ref).toBe('ops[3]');
  });

  it.each([
    ['setOptions', Operation.setOptions({ signer: { ed25519PublicKey: ATTACKER, weight: 1 }, source: USER })],
    ['accountMerge', Operation.accountMerge({ destination: ATTACKER, source: USER })],
    ['user sponsors someone else', Operation.beginSponsoringFutureReserves({ sponsoredId: ATTACKER, source: USER })],
    ['manageData', Operation.manageData({ name: 'x', value: 'y', source: USER })],
  ])('MALICIOUS: %s by the user inside the sandwich is high', async (_name, op) => {
    const txXdr = centient({ exists: true, extra: [op] });
    expect(legacy(txXdr).risk).toBe('high');
    expect(codes(legacy(txXdr).reasons)).toContain('authorizes_beyond_setup');
    const r = await pipeline(txXdr);
    expect(r.risk).toBe('high');
    expect(codes(r.reasons)).toContain('authorizes_beyond_setup');
  });

  it('a payment by the SPONSOR to the user is not the user authorizing anything', async () => {
    const txXdr = centient({
      exists: true,
      extra: [Operation.payment({ destination: USER, asset: Asset.native(), amount: '1' })],
    });
    expect(codes(legacy(txXdr).reasons)).not.toContain('authorizes_beyond_setup');
    expect(codes((await pipeline(txXdr)).reasons)).not.toContain('authorizes_beyond_setup');
  });
});

describe('someone else is the source, no sponsorship (#261)', () => {
  it('flags a payment from the user in a transaction a third party built', () => {
    const txXdr = build(SPONSOR, [
      Operation.payment({ destination: ATTACKER, asset: Asset.native(), amount: '5', source: USER }),
    ]);
    const v = legacy(txXdr);
    expect(v.risk).toBe('high');
    expect(v.reasons.find((r) => r.code === 'authorizes_beyond_setup')!.detail).toMatch(
      new RegExp(`^${SPONSOR.slice(0, 4)}…${SPONSOR.slice(-4)} built this transaction`),
    );
    expect(v.signing).toMatchObject({ userOps: [0], otherOps: [], otherSigners: [SPONSOR], userIsTxSource: false });
  });

  it('leaves a fee-sponsored contract call to the contract rules (no setup flag)', () => {
    const txXdr = build(SPONSOR, [
      Operation.invokeContractFunction({
        contract: 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE',
        function: 'hello',
        args: [],
        source: USER,
      }),
    ]);
    expect(codes(legacy(txXdr).reasons)).not.toContain('authorizes_beyond_setup');
  });

  it("the user's own multi-op transaction is unaffected by the rule", () => {
    const txXdr = build(USER, [
      Operation.payment({ destination: ATTACKER, asset: Asset.native(), amount: '1' }),
      Operation.changeTrust({ asset: USDC }),
    ]);
    const v = legacy(txXdr);
    expect(codes(v.reasons)).not.toContain('authorizes_beyond_setup');
    expect(v.signing).toMatchObject({ userIsTxSource: true, userOps: [0, 1], otherSigners: [] });
    // Same signer throughout: no per-line signature notes.
    expect(v.explanation).toBe(
      `This transaction has 2 operations:\n1. Sends 1 XLM to ${short(ATTACKER)}.\n2. Adds a USDC trustline (issuer ${short(USDC_ISSUER)}), so the account can hold USDC.`,
    );
  });

  it('signingRequirements compares muxed sources by their base account', () => {
    const muxed = new MuxedAccount(new Account(USER, '0'), '7').accountId();
    const decoded = decodeTransaction(
      build(SPONSOR, [
        Operation.beginSponsoringFutureReserves({ sponsoredId: USER }),
        Operation.changeTrust({ asset: USDC, source: muxed }),
        Operation.endSponsoringFutureReserves({ source: USER }),
      ]),
      pp,
    )!;
    expect(decoded.operations[1]!.sourceAccount).toBe(muxed);
    const s = signingRequirements(decoded, USER);
    expect(s.userOps).toEqual([1, 2]);
    expect(s.otherSigners).toEqual([SPONSOR]);
    expect(sponsoredSetup(decoded)).not.toBeNull();
  });
});

describe('risk registry: trustline to a flagged issuer (#261)', () => {
  const BAD = new Asset('USDC', FLAGGED);

  it('pipeline: the issuer is screened and a registry hit flags the trustline', async () => {
    const flagIssuer: ScreenLookup = async (a) =>
      a === FLAGGED
        ? {
            outcome: 'flagged',
            source: 'registry',
            entry: { reporter: ATTACKER, reason: 'Scam', reports: 3, status: 'Active' } as never,
          }
        : { outcome: 'not_flagged', source: 'registry' };
    const r = await pipeline(centient({ exists: true, asset: BAD }), flagIssuer);
    expect(r.risk).toBe('high');
    expect(codes(r.reasons)).toEqual(expect.arrayContaining(['reported_address', 'flagged_trustline_issuer']));
    expect(r.reasons.find((x) => x.code === 'flagged_trustline_issuer')!.ref).toMatch(/^screen\.hits\[\d+\]$/);
  });

  it('pipeline: the same pattern with a clean issuer stays low', async () => {
    expect((await pipeline(centient({ exists: true }))).risk).toBe('low');
  });

  it('legacy engine: the deny-list is consulted for the issuer too', () => {
    const v = legacy(centient({ exists: true, asset: BAD }));
    expect(v.risk).toBe('high');
    expect(codes(v.reasons)).toContain('flagged_trustline_issuer');
  });

  it('removing a trustline to a flagged issuer is not flagged as adding one', () => {
    const v = legacy(build(USER, [Operation.changeTrust({ asset: BAD, limit: '0' })]));
    expect(codes(v.reasons)).not.toContain('flagged_trustline_issuer');
  });
});

describe('sponsorship abuse (#261)', () => {
  it("revoking a sponsorship of the user's own entries warns: the reserve moves to them", async () => {
    const txXdr = build(SPONSOR, [Operation.revokeTrustlineSponsorship({ account: USER, asset: USDC })]);
    const v = legacy(txXdr);
    expect(v.risk).toBe('medium');
    expect(codes(v.reasons)).toEqual(['sponsorship_revoked']);
    const r = await pipeline(txXdr);
    expect(codes(r.reasons)).toContain('sponsorship_revoked');
  });

  it('a sandwich missing its endSponsoring is not read as a setup', () => {
    const txXdr = build(SPONSOR, [
      Operation.beginSponsoringFutureReserves({ sponsoredId: USER }),
      Operation.createAccount({ destination: USER, startingBalance: '0' }),
      Operation.changeTrust({ asset: USDC, source: USER }),
    ]);
    expect(sponsoredSetup(decodeTransaction(txXdr, pp))).toBeNull();
    expect(legacy(txXdr).explanation).toMatch(/^This transaction has 3 operations:/);
  });

  it('the new op types are modelled: no "unrecognized operation" warning', () => {
    expect(codes(legacy(centient({ exists: false })).reasons)).not.toContain('unrecognized_op');
  });
});
