import { describe, expect, it } from 'vitest';
import { Address, xdr } from '@stellar/stellar-sdk';
import { decodeEntry, entryLedgerKey } from '../scripts/hot-read-blacklist-registry.mjs';

// The derivation IS the claim this tool makes: that a client can compute where a
// verdict lives without asking anyone. Both functions are pure and offline, so
// there is no excuse for them to be untested — and a silent change to either
// would break every caller's screening path with no network error to notice.

const CONTRACT = 'CDZSDRDWHL3LRK5PRQ6EJR74OYSQ4FE7OOZH37KIXN7GQ3HZ3N4MSAFK';
const SUBJECT = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

// Published verbatim in docs/blacklist-registry.md and verified against a live
// testnet read. If this assertion ever fails, the derivation regressed — the
// expected value is not the thing to update.
const PUBLISHED_KEY =
  'AAAABgAAAAHzIcR2Ova4q6+MPETH/HYlDhSfc7J9/Ui7fmhs+dt4yQAAABAAAAABAAAAAgAAAA8A' +
  'AAAFRW50cnkAAAAAAAASAAAAAAAAAAABlHJijueOuScU0i0DkJY8JNkn6gCZmUhuiR+sLaqcIQAA' +
  'AAE=';

const REPORTER = 'GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK';

/** A `#[contracttype]` unit-variant enum on the wire: a one-element vec. */
const unitVariant = (name: string) => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);

const field = (key: string, val: xdr.ScVal) =>
  new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });

/** An `Entry` as the ledger actually returns it: an ScMap keyed by field name. */
function entryScVal(): xdr.ScVal {
  return xdr.ScVal.scvMap([
    field('evidence', xdr.ScVal.scvBytes(Buffer.alloc(32, 0x77))),
    field('index', xdr.ScVal.scvU32(3)),
    field('reason', unitVariant('Drainer')),
    field('reported_at', xdr.ScVal.scvU64(new xdr.Uint64(1_700_000_000n))),
    field('reporter', new Address(REPORTER).toScVal()),
    field('reports', xdr.ScVal.scvU32(2)),
    field('status', unitVariant('Disputed')),
    field('subject', new Address(SUBJECT).toScVal()),
    field('updated_at', xdr.ScVal.scvU64(new xdr.Uint64(1_700_000_500n))),
  ]);
}

describe('entryLedgerKey', () => {
  it('matches the key published in the docs', () => {
    expect(entryLedgerKey(CONTRACT, SUBJECT).toXDR('base64')).toBe(PUBLISHED_KEY);
  });

  it('is deterministic and offline', () => {
    // Same inputs, same key, every time — that is what makes it cacheable and
    // what lets a caller derive it before it has any network at all.
    expect(entryLedgerKey(CONTRACT, SUBJECT).toXDR('base64')).toBe(
      entryLedgerKey(CONTRACT, SUBJECT).toXDR('base64'),
    );
  });

  it('derives a different key per subject', () => {
    expect(entryLedgerKey(CONTRACT, REPORTER).toXDR('base64')).not.toBe(PUBLISHED_KEY);
  });

  it('builds a persistent ContractData key for the right contract', () => {
    const cd = entryLedgerKey(CONTRACT, SUBJECT).contractData();
    expect(cd.durability()).toEqual(xdr.ContractDataDurability.persistent());
    expect(Address.fromScAddress(cd.contract()).toString()).toBe(CONTRACT);
    // The key is the enum variant: [symbol("Entry"), address(subject)].
    // `vec()` is optional because an ScVal need not be a vector at all, and
    // indexed access is checked — so narrow rather than assert.
    const parts = cd.key().vec() ?? [];
    expect(parts).toHaveLength(2);
    const [variant, addr] = parts;
    if (!variant || !addr) throw new Error('expected a two-element key vector');
    expect(variant.sym().toString()).toBe('Entry');
    expect(Address.fromScVal(addr).toString()).toBe(SUBJECT);
  });
});

describe('decodeEntry', () => {
  it('maps all nine fields, with enums unwrapped to plain strings', () => {
    expect(decodeEntry(entryScVal())).toEqual({
      subject: SUBJECT,
      reporter: REPORTER,
      reason: 'Drainer',
      status: 'Disputed',
      evidence: '77'.repeat(32),
      reported_at: 1_700_000_000,
      updated_at: 1_700_000_500,
      reports: 2,
      // Added in #32; a decoder written against the original 8-field schema
      // drops it silently, which is exactly what this pins.
      index: 3,
    });
  });

  it('leaves the caller a plain string to compare against', () => {
    // `scValToNative` hands back ["Active"], not "Active". Getting this wrong
    // makes `status === 'Active'` always false — every subject reads as clean.
    const decoded = decodeEntry(entryScVal());
    expect(typeof decoded.status).toBe('string');
    expect(typeof decoded.reason).toBe('string');
  });
});
