// Retention (#85): raw rows live `retentionDays`, then go. Runs once at boot
// and every 24 h in-process — one instance, one job. Failures are logged and
// retried next tick; nothing depends on it succeeding right now.

import type { TelemetryStore } from './store';

export interface RetentionOptions {
  store: TelemetryStore;
  retentionDays: number;
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => unknown;
  log: (line: Record<string, string | number>) => void;
}

export const DAY_MS = 86_400_000;

export async function purgeOnce(opts: RetentionOptions): Promise<number> {
  const now = opts.now ?? (() => new Date());
  const cutoff = new Date(now().getTime() - opts.retentionDays * DAY_MS);
  try {
    const n = await opts.store.purgeBefore(cutoff);
    opts.log({
      route: 'retention',
      status: 200,
      code: 'ok',
      rows: n,
      cutoff: cutoff.toISOString(),
    });
    return n;
  } catch {
    opts.log({ route: 'retention', status: 503, code: 'store_error' });
    return 0;
  }
}

export function startRetention(opts: RetentionOptions): void {
  const setTimer = opts.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  void purgeOnce(opts);
  setTimer(() => void purgeOnce(opts), DAY_MS);
}
