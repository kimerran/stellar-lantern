// The playground's input and result (#184): paste an envelope or compose a
// payment, run the live pipeline, and show the three things SOW §4.1 names
// together: the summary, the verdict and the registry screening.

import { useState, type FormEvent } from 'react';
import { NOT_JUDGED, type NetDelta } from '@lantern/scanner';
import { RiskCallout } from '@popup/components/RiskCallout';
import { ScanBadge } from '@popup/components/ScanBadge';
import {
  composePayment,
  preparePasted,
  runDemoScan,
  screeningRows,
  type DemoScan,
  type ScreeningTone,
} from './scan';
import { demoTelemetry } from './telemetry';

type Mode = 'paste' | 'compose';
type State =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'error'; message: string; missingSource?: boolean; network?: true }
  | { kind: 'done'; scan: DemoScan };

const field =
  'w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 font-mono text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary-container focus:outline-none';

export function ScanPanel() {
  const [mode, setMode] = useState<Mode>('paste');
  const [pasted, setPasted] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState({ kind: 'running' });
    try {
      let input: { xdr: string; source: string; destinationFunded?: boolean };
      if (mode === 'paste') {
        const p = preparePasted(pasted);
        if (!p.ok) return setState({ kind: 'error', message: p.error });
        input = p;
      } else {
        const c = await composePayment({ from, to, amount });
        if (!c.ok) {
          return setState({
            kind: 'error',
            message: c.error,
            ...(c.missingSource ? { missingSource: true } : {}),
          });
        }
        input = c;
      }
      const out = await runDemoScan(input);
      if (out.ok) {
        const { risk, action } = out.scan.result;
        demoTelemetry().scanned({ risk, action, origin: mode === 'paste' ? 'pasted' : 'composed' });
      }
      setState(
        out.ok
          ? { kind: 'done', scan: out.scan }
          : { kind: 'error', message: out.error, ...(mode === 'paste' ? { network: true } : {}) },
      );
    } catch {
      // Backstop: nothing may leave the page stuck on "Scanning…".
      setState({ kind: 'error', message: 'Something went wrong, and nothing was scanned. Try again.' });
    }
  }

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => setMode(m)}
      className={`rounded-full px-3 py-1 text-sm font-medium ${
        mode === m ? 'bg-primary-container text-on-primary' : 'text-on-surface-variant hover:text-on-surface'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Input mode" className="flex gap-2">
        {tab('paste', 'Paste a transaction')}
        {tab('compose', 'Compose a payment')}
      </div>

      <form onSubmit={submit} className="space-y-3">
        {mode === 'paste' ? (
          <label className="block space-y-1">
            <span className="text-sm text-on-surface-variant">Transaction envelope (base64 XDR, testnet)</span>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={5}
              spellCheck={false}
              placeholder="AAAAAgAAAA…"
              className={`${field} break-all`}
            />
          </label>
        ) : (
          <div className="grid gap-3">
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">From (G…)</span>
              <input value={from} onChange={(e) => setFrom(e.target.value)} spellCheck={false} className={field} />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">To (G…)</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} className={field} />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-on-surface-variant">Amount (XLM)</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="10"
                className={field}
              />
            </label>
            <p className="text-xs text-on-surface-variant">
              Lantern builds the payment unsigned. You never enter a key, and nothing is submitted.
            </p>
          </div>
        )}
        <button
          type="submit"
          disabled={state.kind === 'running'}
          className="rounded-xl bg-primary-container px-4 py-2 font-semibold text-on-primary disabled:opacity-60"
        >
          {state.kind === 'running' ? 'Scanning…' : 'Scan it'}
        </button>
      </form>

      <div aria-live="polite">
        {state.kind === 'error' && (
          <div role="alert" className="rounded-2xl border border-error/30 bg-error-container/15 p-4 text-sm text-on-surface">
            {state.message}
            {state.missingSource && (
              <a href="#examples" className="ml-1 text-primary underline">
                See the examples.
              </a>
            )}
            {state.network && (
              <p className="mt-2 text-xs text-on-surface-variant">
                Pasted input has no offline copy: if testnet is down, try again later.
              </p>
            )}
          </div>
        )}
        {state.kind === 'done' && <ScanResultView scan={state.scan} />}
      </div>
    </div>
  );
}

const TONE: Record<ScreeningTone, string> = {
  flagged: 'text-error',
  clear: 'text-tertiary',
  unknown: 'text-secondary',
};

function short(address: string): string {
  return address.length > 16 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}

// Net sums are exact decimal strings ("0.0000000" when nothing moved that way).
const moved = (amount: string) => /[1-9]/.test(amount);

export function movement(n: NetDelta): string {
  const parts: string[] = [];
  if (n.outIsTotal) parts.push(`sends its entire ${n.asset.code} balance`);
  else if (moved(n.out)) parts.push(`sends ${n.outUpTo ? 'up to ' : ''}${n.out} ${n.asset.code}`);
  if (n.inIsTotal) parts.push(`receives a whole ${n.asset.code} balance`);
  else if (moved(n.in)) parts.push(`receives ${n.inAtLeast ? 'at least ' : ''}${n.in} ${n.asset.code}`);
  return parts.join(', ');
}

export function ScanResultView({ scan }: { scan: DemoScan }) {
  const { result } = scan;
  const rows = screeningRows(result.screen.answers);
  const net = result.effects.net.filter((n) => movement(n) !== '');
  return (
    <div className="space-y-4" data-testid="scan-result">
      <div className="flex flex-wrap items-center gap-2">
        <ScanBadge risk={result.risk} latencyMs={scan.ms} />
        <span className="text-xs text-on-surface-variant">
          Risk <strong className="text-on-surface">{result.risk}</strong> · action{' '}
          <strong className="text-on-surface">{result.action}</strong>
        </span>
      </div>

      <section aria-label="Summary">
        <p className="text-xs uppercase tracking-wide text-on-surface-variant">
          Summary ·{' '}
          <span data-testid="summary-source">
            {scan.summarySource === 'explainer' ? 'written by Lantern’s AI explainer' : 'rules-based (no AI)'}
          </span>
        </p>
        <div className="mt-1">
          <RiskCallout risk={result.risk} reasons={[...result.reasons]} explanation={result.explanation} />
        </div>
      </section>

      <section aria-label="Registry screening">
        <p className="text-xs uppercase tracking-wide text-on-surface-variant">Scam registry screening</p>
        {rows.length === 0 ? (
          <p className="mt-1 text-sm text-on-surface-variant">No counterparty to screen.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {rows.map((r) => (
              <li key={r.address} data-tone={r.tone} className="text-sm">
                <span className="font-mono text-on-surface" title={r.address}>
                  {short(r.address)}
                </span>{' '}
                <span className={`font-semibold ${TONE[r.tone]}`}>{r.label}</span>
                {r.detail && <span className="text-on-surface-variant"> — {r.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Effects">
        <p className="text-xs uppercase tracking-wide text-on-surface-variant">What moves</p>
        {net.length === 0 ? (
          <p className="mt-1 text-sm text-on-surface-variant">No balance change found.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {net.map((n, i) => (
              <li key={`${n.address}-${n.asset.code}-${i}`}>
                <span className="font-mono text-on-surface" title={n.address}>
                  {short(n.address)}
                </span>{' '}
                <span className="text-on-surface-variant">{movement(n)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs italic text-on-surface-variant">{NOT_JUDGED}</p>
      </section>
    </div>
  );
}
