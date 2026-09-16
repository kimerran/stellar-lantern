// The batching transport (#81). Buffers events in memory and flushes them to
// the ingest endpoint on a size or time threshold and on demand
// (visibilitychange is wired by start()). Three properties that matter more
// than throughput:
//   - HARD no-op without consent: emit() returns before buffering anything.
//   - Analytics never breaks the wallet: every failure is swallowed.
//   - Bounded: an offline session cannot grow the buffer without limit.

import type { Envelope, Network, Platform, StampedEvent, TelemetryEvent } from './events';
import { validateEnvelope, validateEvent } from './validate';

export interface SinkOptions {
  ingestUrl: string;
  platform: Platform;
  appVersion: string;
  network: () => Network;
  installId: () => Promise<string>;
  hasConsent: () => boolean;
  // Alpha identity (#100): the wallet's public address to attach, or null
  // when there is no wallet yet. Absent in non-alpha builds.
  account?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  flushAt?: number; // events buffered before an immediate flush (default 20)
  flushAfterMs?: number; // max age of the oldest buffered event (default 30 s)
  maxBuffer?: number; // hard cap; oldest events drop first (default 200)
  // Deletion request for "delete my data".
  deleteUrl?: string;
}

export interface Sink {
  emit(event: TelemetryEvent): void;
  flush(): Promise<void>;
  // Sends a deletion request for the current install id. Best effort.
  requestDeletion(): Promise<void>;
  // Test / diagnostics.
  size(): number;
}

export function createSink(opts: SinkOptions): Sink {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const flushAt = opts.flushAt ?? 20;
  const flushAfterMs = opts.flushAfterMs ?? 30_000;
  const maxBuffer = opts.maxBuffer ?? 200;

  let buffer: StampedEvent[] = [];
  let timer: unknown = null;
  let inflight: Promise<void> | null = null;

  function emit(event: TelemetryEvent): void {
    if (!opts.hasConsent()) return; // hard no-op: nothing is buffered
    const stamped: StampedEvent = { name: event.name, props: { ...event.props }, ts: now() };
    if (!validateEvent(stamped)) return; // dropped, never sent
    buffer.push(stamped);
    if (buffer.length > maxBuffer) buffer = buffer.slice(buffer.length - maxBuffer);
    if (buffer.length >= flushAt) {
      void flush();
    } else if (timer === null) {
      timer = setTimer(() => {
        timer = null;
        void flush();
      }, flushAfterMs);
    }
  }

  async function flush(): Promise<void> {
    if (inflight) return inflight;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (buffer.length === 0 || !opts.hasConsent()) {
      buffer = [];
      return;
    }
    const events = buffer;
    buffer = [];
    inflight = (async () => {
      try {
        const envelope: Envelope = {
          installId: await opts.installId(),
          platform: opts.platform,
          appVersion: opts.appVersion,
          network: opts.network(),
          ...(opts.account ? await accountField(opts.account) : {}),
          events,
        };
        if (!validateEnvelope(envelope)) return; // never send what fails the guard
        await fetchImpl(opts.ingestUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(envelope),
          keepalive: true,
        });
      } catch {
        // Swallowed: analytics must never break the wallet. The batch is
        // lost rather than retried — a retry queue is a privacy liability.
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  async function requestDeletion(): Promise<void> {
    buffer = [];
    try {
      const installId = await opts.installId();
      await fetchImpl(opts.deleteUrl ?? opts.ingestUrl, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installId }),
        keepalive: true,
      });
    } catch {
      // Best effort; the local id is cleared by the caller regardless.
    }
  }

  return { emit, flush, requestDeletion, size: () => buffer.length };
}

async function accountField(read: () => Promise<string | null>): Promise<{ account?: string }> {
  try {
    const account = await read();
    return account ? { account } : {};
  } catch {
    return {}; // no wallet, or storage unavailable: send the envelope anonymous
  }
}
