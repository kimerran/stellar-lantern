// The live registry panel (#186): what's in the on-chain scam registry right
// now, read without an account. Loads once on open and on Refresh, never on a
// timer: this is a public page on a rate-limited public RPC.

import { useCallback, useEffect, useRef, useState } from 'react';
import { TESTNET_REGISTRY_ID, type RegistryEntry } from '@lantern/scanner';
import {
  PAGE_SIZE,
  readRegistry,
  REGISTRY_WASM_HASH,
  type RegistryRead,
  type Row,
} from './registry';
import { REGISTRY_CHANGED } from './report';

const EXPLORER = 'https://stellar.expert/explorer/testnet';
// A registry subject or reporter is a Soroban Address: an account (G…) or a
// contract (C…), and stellar.expert has a different page for each.
const explorerHref = (a: string) =>
  `${EXPLORER}/${a.startsWith('C') ? 'contract' : 'account'}/${a}`;

type State = { kind: 'loading' } | { kind: 'loaded'; read: RegistryRead; ticket: number };

const STATUS: Record<string, { cls: string; note: string }> = {
  Active: { cls: 'border-error/40 bg-error-container/15 text-error', note: 'raises a warning' },
  Disputed: {
    cls: 'border-outline-variant bg-surface-container-high text-on-surface-variant',
    note: 'under dispute: no warning',
  },
  Revoked: {
    cls: 'border-outline-variant bg-surface-container-high text-on-surface-variant line-through',
    note: 'withdrawn: no warning',
  },
};

function when(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

function short(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function EntryRow({ row }: { row: Row }) {
  if (row.state === 'unreadable') {
    return (
      <li data-state="unreadable" className="rounded-xl border border-outline-variant p-3 text-sm">
        <p className="break-all font-mono text-xs text-on-surface">
          {row.subject ?? `Index ${row.index}`}
        </p>
        <p className="mt-1 text-on-surface-variant">This entry couldn’t be read from the ledger.</p>
      </li>
    );
  }
  const e: RegistryEntry = row.entry;
  const status = STATUS[e.status] ?? {
    cls: 'border-outline-variant text-on-surface-variant',
    note: 'unrecognised status: no warning',
  };
  return (
    <li
      data-state={row.state}
      data-status={e.status}
      className="rounded-xl border border-outline-variant p-3 text-sm"
    >
      <a
        href={explorerHref(e.subject)}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all font-mono text-xs text-on-surface hover:underline"
      >
        {e.subject}
      </a>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-xs text-on-surface">
          {e.reason}
        </span>
        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${status.cls}`}>
          {e.status}
        </span>
        <span className="text-xs text-on-surface-variant">{status.note}</span>
        {row.state === 'archived' && (
          <span className="rounded-full border border-secondary/40 px-2 py-0.5 text-xs text-secondary">
            archived on the ledger
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-on-surface-variant">
        {e.reports} report{e.reports === 1 ? '' : 's'} · reported by{' '}
        <a
          href={explorerHref(e.reporter)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono hover:underline"
          title={e.reporter}
        >
          {short(e.reporter)}
        </a>{' '}
        · first reported {when(e.reportedAt)} · updated {when(e.updatedAt)}
      </p>
    </li>
  );
}

/** The loaded state: headline numbers, the paged list, or the unavailable notice. */
export function RegistryView({ read }: { read: RegistryRead }) {
  const [page, setPage] = useState(0);
  if (!read.ok) {
    return (
      <p
        role="alert"
        className="rounded-xl border border-secondary/40 bg-secondary-container/10 p-3 text-sm text-on-surface"
      >
        <strong>Registry unavailable right now.</strong> Testnet couldn’t be read, so nothing is
        listed here. That doesn’t mean nothing has been reported. Try Refresh in a moment.
      </p>
    );
  }
  const pages = Math.max(1, Math.ceil(read.rows.length / PAGE_SIZE));
  const rows = read.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return (
    <>
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-surface-container p-3">
          <dt className="text-xs text-on-surface-variant">Addresses reported</dt>
          <dd className="text-2xl font-bold text-on-surface">{read.count}</dd>
        </div>
        <div className="rounded-xl bg-surface-container p-3">
          <dt className="text-xs text-on-surface-variant">Reports filed</dt>
          <dd className="text-2xl font-bold text-on-surface">
            {read.reportsComplete ? '' : 'at least '}
            {read.reportsFiled}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-on-surface-variant">
        Reports filed counts report calls only. Status changes by the registry admin aren’t in
        ledger state, so they aren’t included.
      </p>
      <p className="text-xs text-on-surface-variant">
        Only an <strong className="text-error">Active</strong> entry makes Lantern warn. A Disputed
        or Revoked entry is shown for the record, not as an accusation.
      </p>

      {read.rows.length === 0 ? (
        <p className="text-sm text-on-surface-variant">The registry holds no reports yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <EntryRow key={r.index} row={r} />
          ))}
        </ul>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-on-surface-variant">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
            className="disabled:opacity-40"
          >
            ← Newer
          </button>
          <span>
            Page {page + 1} of {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages - 1}
            onClick={() => setPage(page + 1)}
            className="disabled:opacity-40"
          >
            Older →
          </button>
        </div>
      )}
    </>
  );
}

export function RegistryPanel() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setState({ kind: 'loading' });
    const read = await readRegistry();
    if (latest.current !== ticket) return;
    setState({ kind: 'loaded', read, ticket });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A report filed from the playground (#187) reloads the panel once, so the
  // new entry and the count show without a page reload. Not a poll.
  useEffect(() => {
    const onChange = () => void load();
    addEventListener(REGISTRY_CHANGED, onChange);
    return () => removeEventListener(REGISTRY_CHANGED, onChange);
  }, [load]);

  return (
    <div className="space-y-4" data-testid="registry-panel">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-on-surface-variant">Live from Stellar testnet</span>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state.kind === 'loading'}
          className="rounded-lg border border-outline-variant px-2.5 py-1 text-xs text-on-surface disabled:opacity-60"
        >
          {state.kind === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Keyed by load, so a refresh starts again at the newest page. */}
      {state.kind === 'loaded' && <RegistryView key={state.ticket} read={state.read} />}

      <p className="break-all text-xs text-on-surface-variant">
        Contract{' '}
        <a
          href={`${EXPLORER}/contract/${TESTNET_REGISTRY_ID}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono hover:underline"
        >
          {TESTNET_REGISTRY_ID}
        </a>
        <br />
        WASM sha256 <span className="font-mono">{REGISTRY_WASM_HASH}</span>
      </p>
    </div>
  );
}

// Exported for tests: the row view alone, without the effect that fetches.
export { EntryRow };
