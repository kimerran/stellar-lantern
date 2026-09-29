// Playground telemetry (#188). The wallet's telemetry rests on an explicit
// opt-in (#86). A public page has no install and no consent screen, so this
// collects less:
//   - no persistent identifier: a random id per page load, held in memory
//     only. No cookie, no storage, nothing that links two visits;
//   - one event, `demo_scanned`, whose props are enums (risk, action, and
//     where the transaction came from). No address, amount, XDR or pasted
//     text has a slot, and the shared validator drops anything else;
//   - no wallet address, ever.
// Fire-and-forget: a failed send is dropped, never retried, never shown.

import type {
  DemoOrigin,
  Envelope,
  RiskLevel,
  ScanAction,
  StampedEvent,
} from '@core/telemetry/events';
import { validateEnvelope } from '@core/telemetry/validate';

// The Lantern API's ingest. Fixed here rather than read from the build env,
// so the committed, drift-checked bundle doesn't depend on the machine that
// built it (the reason vite.config.demo.ts pins its flags).
export const DEMO_INGEST_URL = 'https://lantern-api-production-3fad.up.railway.app/v1/telemetry';
// Not the package version: that would change the committed bundle on every
// version bump and fail the drift check on the bump PR.
const DEMO_APP_VERSION = 'demo';
const FLUSH_AFTER_MS = 2_000;

export interface DemoTelemetry {
  scanned(e: { risk: RiskLevel; action: ScanAction; origin: DemoOrigin }): void;
  flush(): Promise<void>;
}

export function createDemoTelemetry(
  opts: {
    fetchImpl?: typeof fetch;
    url?: string;
    now?: () => number;
    newId?: () => string;
    schedule?: (fn: () => void, ms: number) => unknown;
  } = {},
): DemoTelemetry {
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const url = opts.url ?? DEMO_INGEST_URL;
  const now = opts.now ?? (() => Date.now());
  const schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  // One per page load; gone when the tab closes.
  const loadId = (opts.newId ?? (() => crypto.randomUUID()))();
  let queue: StampedEvent[] = [];
  let pending = false;

  async function flush(): Promise<void> {
    pending = false;
    if (queue.length === 0) return;
    const envelope: Envelope = {
      installId: loadId,
      platform: 'demo',
      appVersion: DEMO_APP_VERSION,
      network: 'testnet',
      events: queue,
    };
    queue = [];
    if (!validateEnvelope(envelope)) return; // never send what the server would refuse
    try {
      await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
        keepalive: true,
        credentials: 'omit',
      });
    } catch {
      // Dropped. The page never depends on telemetry.
    }
  }

  return {
    scanned({ risk, action, origin }) {
      queue.push({ name: 'demo_scanned', props: { risk, action, origin }, ts: now() });
      if (!pending) {
        pending = true;
        schedule(() => void flush(), FLUSH_AFTER_MS);
      }
    },
    flush,
  };
}

// The page's instance. Created on first use, so importing this module for a
// test does nothing.
let instance: DemoTelemetry | null = null;
export function demoTelemetry(): DemoTelemetry {
  if (!instance) {
    instance = createDemoTelemetry();
    // A scan finished less than FLUSH_AFTER_MS before the tab closes still
    // goes out: keepalive lets the request outlive the page.
    addEventListener('pagehide', () => void instance?.flush());
  }
  return instance;
}
