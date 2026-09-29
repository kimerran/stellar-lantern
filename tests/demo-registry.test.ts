import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  countLedgerKey,
  decodeCount,
  decodeIndex,
  entryLedgerKey,
  indexLedgerKey,
  TESTNET_REGISTRY_ID,
  type RegistryEntry,
} from '@lantern/scanner';
import { readRegistry, REGISTRY_WASM_HASH, type RegistryRead } from '../src/demo/registry';
import { EntryRow, RegistryView } from '../src/demo/RegistryPanel';
import recorded from '../packages/lantern-scanner/fixtures/registry-list.json';
import doc from '../docs/blacklist-registry.md?raw';

// The playground's registry panel (#186). Offline: fixtures/registry-list.json
// is the whole testnet registry as three recorded getLedgerEntries bodies, and
// the fetch stub serves them by key.

interface RawEntry {
  key: string;
  xdr: string;
  liveUntilLedgerSeq?: number;
}
const ALL = new Map<string, RawEntry>();
for (const body of [
  recorded.responses.instance,
  recorded.responses.index,
  recorded.responses.entries,
]) {
  for (const e of body.result.entries as RawEntry[]) ALL.set(e.key, e);
}
const LATEST = recorded.responses.entries.result.latestLedger;

function stubRpc(patch: (e: RawEntry) => RawEntry = (e) => e) {
  const requests: string[][] = [];
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const keys = JSON.parse(init.body).params.keys as string[];
    requests.push(keys);
    const entries = keys.flatMap((k) => (ALL.has(k) ? [patch(ALL.get(k)!)] : []));
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { entries, latestLedger: LATEST } }),
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

describe('registry key helpers', () => {
  it('derive the same keys as the recorder’s independent derivation', () => {
    expect(recorded.registry).toBe(TESTNET_REGISTRY_ID);
    expect(countLedgerKey(TESTNET_REGISTRY_ID)).toBe(recorded.keys.instance);
    recorded.keys.index.forEach((k, i) => expect(indexLedgerKey(TESTNET_REGISTRY_ID, i)).toBe(k));
    recorded.subjects.forEach((s, i) =>
      expect(entryLedgerKey(TESTNET_REGISTRY_ID, s)).toBe(recorded.keys.entry[i]),
    );
  });

  it('decode Count from the instance and the subject from an Index entry', () => {
    const instance = recorded.responses.instance.result.entries[0]!;
    expect(decodeCount(instance.xdr)).toBe(recorded.count);
    expect(recorded.count).toBeGreaterThan(0);
    recorded.responses.index.result.entries.forEach((e, i) =>
      expect(decodeIndex(e.xdr)).toBe(recorded.subjects[i]),
    );
  });

  it('refuse to read a Count that is not there, rather than answer zero', () => {
    const anEntry = recorded.responses.entries.result.entries[0]!;
    expect(() => decodeCount(anEntry.xdr)).toThrow();
  });
});

describe('readRegistry', () => {
  it('reads the whole registry newest first in three round-trips, with no account', async () => {
    const { fetchImpl, requests } = stubRpc();
    const read = await readRegistry({ fetchImpl });
    if (!read.ok) throw new Error('read failed');
    expect(read.count).toBe(recorded.count);
    expect(read.rows).toHaveLength(recorded.count);
    expect(read.rows.map((r) => r.index)).toEqual([...Array(recorded.count).keys()].reverse());
    expect(read.calls).toBe(3);
    expect(requests.map((r) => r.length)).toEqual([1, recorded.count, recorded.count]);
    expect(read.reportsComplete).toBe(true);
    const sum = read.rows.reduce((n, r) => n + (r.state === 'unreadable' ? 0 : r.entry.reports), 0);
    expect(read.reportsFiled).toBe(sum);
    expect(read.reportsFiled).toBeGreaterThanOrEqual(read.count);
  });

  it('shows an archived entry as archived, and an unreadable one as unreadable, never dropping either', async () => {
    const [archivedKey, brokenKey] = recorded.keys.entry;
    const { fetchImpl } = stubRpc((e) =>
      e.key === archivedKey
        ? { ...e, liveUntilLedgerSeq: 1 }
        : e.key === brokenKey
          ? { ...e, xdr: 'AAAA' }
          : e,
    );
    const read = await readRegistry({ fetchImpl });
    if (!read.ok) throw new Error('read failed');
    expect(read.rows).toHaveLength(recorded.count);
    expect(read.rows.find((r) => r.index === 0)?.state).toBe('archived');
    expect(read.rows.find((r) => r.index === 1)?.state).toBe('unreadable');
    expect(read.reportsComplete).toBe(false);
    const html = renderToStaticMarkup(createElement(RegistryView, { read }));
    expect(html).toContain('at least ');
    expect(html).toContain('archived on the ledger');
    expect(html).toContain('couldn’t be read from the ledger');
  });

  it.each([
    [
      'a transport failure',
      async () => {
        throw new TypeError('Failed to fetch');
      },
    ],
    ['a 429', async () => new Response('slow down', { status: 429 })],
    [
      'a JSON-RPC error body',
      async () => new Response(JSON.stringify({ error: { message: 'boom' } })),
    ],
  ])('%s is the unavailable state, never an empty list', async (_label, impl) => {
    const read = await readRegistry({ fetchImpl: impl as unknown as typeof fetch });
    expect(read).toEqual({ ok: false });
    const html = renderToStaticMarkup(createElement(RegistryView, { read }));
    expect(html).toContain('Registry unavailable right now');
    expect(html).not.toContain('<ul');
    expect(html).not.toContain('Addresses reported');
  });
});

describe('the panel copy', () => {
  const entry = (status: string): RegistryEntry => ({
    subject: recorded.subjects[0]!,
    reporter: recorded.subjects[1]!,
    reason: 'Scam',
    status,
    evidence: '00',
    reportedAt: 1_790_000_000,
    updatedAt: 1_790_000_000,
    reports: 2,
    index: 0,
  });

  it('labels the second number "Reports filed", never "executions"', async () => {
    const { fetchImpl } = stubRpc();
    const read: RegistryRead = await readRegistry({ fetchImpl });
    const html = renderToStaticMarkup(createElement(RegistryView, { read }));
    expect(html).toContain('Reports filed');
    expect(html).toContain('Addresses reported');
    expect(html).not.toMatch(/execution/i);
  });

  it('prints the full subject address, linked to stellar.expert testnet', () => {
    const html = renderToStaticMarkup(
      createElement(EntryRow, {
        row: { index: 0, subject: recorded.subjects[0]!, state: 'live', entry: entry('Active') },
      }),
    );
    expect(html).toContain(`>${recorded.subjects[0]}</a>`);
    expect(html).toContain(
      `https://stellar.expert/explorer/testnet/account/${recorded.subjects[0]}`,
    );
  });

  it('links a contract (C…) subject to its contract page, not an account page', () => {
    const html = renderToStaticMarkup(
      createElement(EntryRow, {
        row: {
          index: 0,
          subject: TESTNET_REGISTRY_ID,
          state: 'live',
          entry: { ...entry('Active'), subject: TESTNET_REGISTRY_ID },
        },
      }),
    );
    expect(html).toContain(
      `https://stellar.expert/explorer/testnet/contract/${TESTNET_REGISTRY_ID}`,
    );
    expect(html).not.toContain(`/account/${TESTNET_REGISTRY_ID}`);
  });

  it('makes Disputed and Revoked visibly different from Active, and says only Active warns', () => {
    const render = (status: string) =>
      renderToStaticMarkup(
        createElement(EntryRow, {
          row: { index: 0, subject: recorded.subjects[0]!, state: 'live', entry: entry(status) },
        }),
      );
    const active = render('Active');
    const disputed = render('Disputed');
    const revoked = render('Revoked');
    expect(active).toContain('raises a warning');
    expect(active).toContain('text-error');
    expect(disputed).toContain('under dispute: no warning');
    expect(disputed).not.toContain('text-error');
    expect(revoked).toContain('withdrawn: no warning');
    expect(revoked).toContain('line-through');
  });

  it('publishes the WASM hash the deployment doc publishes', () => {
    expect(doc).toContain(REGISTRY_WASM_HASH);
  });
});
