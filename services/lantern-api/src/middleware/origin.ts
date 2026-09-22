import type { MiddlewareHandler } from 'hono';

// Origin allowlist. A speed bump, not a lock: an Origin header is forgeable by
// anything that is not a browser. It stops other sites' pages and drive-by
// scripts from spending the budget; the rate limit and daily cap do the rest.
// An empty allowlist allows everything — for local dev only; the README says
// to set ALLOWED_ORIGINS in every deployment.
export function originAllowlist(allowed: string[]): MiddlewareHandler {
  const set = new Set(allowed);
  return async (c, next) => {
    if (set.size > 0) {
      const origin = c.req.header('origin') ?? '';
      if (!set.has(origin)) return c.json({ error: 'origin' }, 403);
    }
    await next();
  };
}
