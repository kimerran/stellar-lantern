import { describe, expect, it } from 'vitest';
import { Address, xdr } from '@stellar/stellar-sdk';
import { decodeEntry, entryLedgerKey } from '../scripts/hot-read-blacklist-registry.mjs';
// The doc itself, as text. `?raw` rather than `node:fs` because the node
// polyfills this suite runs under stub the filesystem module out.
import doc from '../docs/blacklist-registry.md?raw';

// The derivation IS the claim this tool makes: that a client can compute where a
// verdict lives without asking anyone. Both functions are pure and offline, so
// there is no excuse for them to be untested — and a silent change to either
// would break every caller's screening path with no network error to notice.

const SUBJECT = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

/**
 * The worked example as the documentation actually publishes it.
 *
 * Copying those values into a constant here would only pin this file against
 * itself. Reading them out of the markdown makes the doc the fixture, so a
 * worked example whose key no longer follows from its contract id fails the
 * build rather than sitting green beside a passing duplicate.
 */
function publishedWorkedExample(): { contract: string; subject: string; key: string } {
  const section = doc.split('### Worked example')[1]?.split('\n## ')[0];
  if (!section) throw new Error('docs/blacklist-registry.md: no "### Worked example" section');

  const contract = /Contract `(C[A-Z2-7]{55})`/.exec(section)?.[1];
  const subject = /subject `(G[A-Z2-7]{55})`/.exec(section)?.[1];
  // The first fenced block in the section is the base64 key, wrapped for width.
  const key = /```\n([A-Za-z0-9+/=\n]+?)\n```/.exec(section)?.[1]?.replace(/\n/g, '');
  if (!contract || !subject || !key) {
    throw new Error('docs/blacklist-registry.md: worked example is not in the expected shape');
  }
  return { contract, subject, key };
}

/**
 * The contract id the deployment table publishes.
 *
 * The re-deploy runbook updates the README and this table before it reaches the
 * worked example, so those two ids disagreeing is what a half-finished re-deploy
 * actually looks like. Parsing both is what lets the runbook promise that
 * skipping its last step fails `npm test`.
 */
function deployedContractId(): string {
  const section = doc.split('## Deployment (testnet)')[1]?.split('\n## ')[0];
  if (!section) throw new Error('docs/blacklist-registry.md: no "## Deployment (testnet)" section');

  const contract = /\| Contract id \| \[`(C[A-Z2-7]{55})`\]/.exec(section)?.[1];
  if (!contract) {
    throw new Error('docs/blacklist-registry.md: deployment table has no contract id row');
  }
  return contract;
}

const { contract: CONTRACT, subject: DOC_SUBJECT, key: PUBLISHED_KEY } = publishedWorkedExample();
const DEPLOYED = deployedContractId();

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
    // Both sides come from docs/blacklist-registry.md, so this fails when the
    // published example goes stale — not only when the derivation regresses.
    expect(DOC_SUBJECT).toBe(SUBJECT);
    expect(entryLedgerKey(CONTRACT, SUBJECT).toXDR('base64')).toBe(PUBLISHED_KEY);
  });

  it('is published against the contract the deployment table names', () => {
    // A re-deploy updates the README and the deployment table first and reaches
    // the worked example last. Without this, stopping in the middle leaves a
    // doc that points at two different contracts and a suite that never notices.
    expect(CONTRACT).toBe(DEPLOYED);
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
