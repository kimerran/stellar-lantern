import type { MiddlewareHandler } from 'hono';

// Per-IP sliding window + a service-wide daily cap. In-memory: correct for a
// single instance (this deployment), documented as the limit. `now` is
// injectable so tests drive the clock.
export interface RateLimitOptions {
  perMinute: number;
  dailyCap: number;
  now?: () => number;
}

export interface RateLimiter {
  middleware: MiddlewareHandler;
  // Exposed for tests and /healthz.
  dailyCount: () => number;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

export function clientIp(
  headers: { get(name: string): string | null | undefined },
  fallback: string,
): string {
  // A proxy that appends to X-Forwarded-For (Railway's edge, most others)
  // leaves any client-supplied entries at the front, so the FIRST hop is
  // attacker-controlled: a fresh value per request would mint a fresh window.
  // The LAST entry is the one the trusted edge appended — and if the edge
  // overwrites the header instead, the result is the same.
  const xff = headers.get('x-forwarded-for');
  const hops = (xff ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return hops[hops.length - 1] || fallback;
}

export function createRateLimiter(opts: RateLimitOptions): RateLimiter {
  const now = opts.now ?? (() => Date.now());
  const windows = new Map<string, number[]>(); // ip → timestamps in the last minute
  let dayStart = utcDayStart(now());
  let dayCount = 0;

  function rollDay(t: number): void {
    const start = utcDayStart(t);
    if (start !== dayStart) {
      dayStart = start;
      dayCount = 0;
    }
  }

  const middleware: MiddlewareHandler = async (c, next) => {
    const t = now();
    rollDay(t);
    if (dayCount >= opts.dailyCap) return c.json({ error: 'daily_cap' }, 429);

    const ip = clientIp({ get: (n) => c.req.header(n) }, 'unknown');
    const recent = (windows.get(ip) ?? []).filter((ts) => t - ts < MINUTE);
    if (recent.length >= opts.perMinute) {
      windows.set(ip, recent);
      return c.json({ error: 'rate_limited' }, 429);
    }
    recent.push(t);
    windows.set(ip, recent);
    dayCount += 1;
    // Keep the map from growing without bound: drop idle IPs opportunistically.
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (v.every((ts) => t - ts >= MINUTE)) windows.delete(k);
    }
    await next();
  };

  return { middleware, dailyCount: () => dayCount };
}

function utcDayStart(t: number): number {
  return t - (t % DAY);
}
