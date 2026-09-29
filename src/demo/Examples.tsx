// The seeded example gallery (#185): what a non-technical reviewer actually
// clicks. Each card runs its fixture through the live pipeline, and falls back
// to the recording only when testnet can't be reached, saying so.

import { useRef, useState } from 'react';
import { EXAMPLES, runExample, type Example, type ExampleOutcome } from './examples';
import { ScanResultView } from './ScanPanel';
import { demoTelemetry } from './telemetry';

type State =
  | { kind: 'idle' }
  | { kind: 'running'; id: string }
  | { kind: 'done'; id: string; outcome: ExampleOutcome };

function day(iso: string): string {
  return iso.slice(0, 10);
}

export function ExampleResult({ outcome }: { outcome: ExampleOutcome }) {
  if (!outcome.ok) {
    return (
      <div role="alert" className="rounded-2xl border border-error/30 bg-error-container/15 p-4 text-sm text-on-surface">
        {outcome.error}
      </div>
    );
  }
  const { cached, discrepancy } = outcome;
  return (
    <div className="space-y-3">
      {cached ? (
        <p
          data-testid="cached-notice"
          className="rounded-xl border border-secondary/40 bg-secondary-container/10 px-3 py-2 text-sm text-secondary"
        >
          <strong>Using cached simulation.</strong> Testnet couldn’t be reached, so this is the committed recording
          {cached.simulationRecordedAt
            ? `: simulation recorded ${day(cached.simulationRecordedAt)}`
            : ' (a classic transaction needs no simulation)'}
          , registry read recorded {day(cached.registryRecordedAt)}.
        </p>
      ) : (
        <p data-testid="live-notice" className="text-xs uppercase tracking-wide text-tertiary">
          Live testnet answer
        </p>
      )}
      {discrepancy && (
        <p role="note" className="rounded-xl border border-error/30 bg-error-container/15 px-3 py-2 text-sm text-on-surface">
          <strong>This differs from the recording.</strong> {discrepancy}
        </p>
      )}
      <ScanResultView scan={outcome.scan} />
    </div>
  );
}

function CopyXdr({ xdr }: { xdr: string }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(xdr);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  }
  return (
    <>
      <button type="button" onClick={copy} className="text-sm text-primary hover:underline">
        {copied === 'copied' ? 'Copied' : 'Copy XDR'}
      </button>
      {copied === 'failed' && (
        <textarea
          readOnly
          value={xdr}
          rows={3}
          aria-label="Transaction XDR"
          className="mt-2 w-full rounded-lg bg-surface-container-lowest p-2 font-mono text-xs text-on-surface"
        />
      )}
    </>
  );
}

function Card({ example, onRun, running }: { example: Example; onRun: () => void; running: boolean }) {
  return (
    <li
      className={`rounded-xl border p-4 ${
        example.malicious ? 'border-error/40 bg-error-container/10' : 'border-outline-variant bg-surface-container'
      }`}
    >
      {example.malicious && (
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-error">The malicious one</p>
      )}
      <h3 className="font-semibold text-on-surface">{example.title}</h3>
      <p className="mt-1 text-sm text-on-surface-variant">{example.blurb}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="rounded-lg bg-primary-container px-3 py-1.5 text-sm font-semibold text-on-primary disabled:opacity-60"
        >
          {running ? 'Scanning…' : 'Run it'}
        </button>
        <CopyXdr xdr={example.fixture.xdr} />
      </div>
    </li>
  );
}

export function Examples() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  // Counts clicks. Only the latest run may show its result: a slower earlier
  // one (a Soroban example retrying a dead testnet, or the same card clicked
  // twice) must not land after it and replace it.
  const latest = useRef(0);

  async function run(example: Example) {
    const ticket = ++latest.current;
    setState({ kind: 'running', id: example.id });
    let outcome: ExampleOutcome;
    try {
      outcome = await runExample(example);
    } catch {
      outcome = { ok: false, error: 'Something went wrong, and nothing was scanned. Try again.' };
    }
    if (latest.current !== ticket) return;
    // Counted only when shown, and always as `seeded`: one click on a
    // built-in example is not a visitor scanning their own transaction.
    if (outcome.ok) {
      const { risk, action } = outcome.scan.result;
      demoTelemetry().scanned({ risk, action, origin: 'seeded' });
    }
    setState({ kind: 'done', id: example.id, outcome });
  }

  const shown = state.kind === 'done' ? EXAMPLES.find((e) => e.id === state.id) : undefined;
  return (
    <div className="space-y-4">
      <ul className="grid gap-3 sm:grid-cols-2">
        {EXAMPLES.map((e) => (
          <Card
            key={e.id}
            example={e}
            onRun={() => void run(e)}
            running={state.kind === 'running' && state.id === e.id}
          />
        ))}
      </ul>
      <div aria-live="polite">
        {state.kind === 'done' && shown && (
          <div className="space-y-2">
            <h3 className="font-semibold text-on-surface">{shown.title}</h3>
            <ExampleResult outcome={state.outcome} />
          </div>
        )}
      </div>
    </div>
  );
}
