import type { MiddlewareHandler } from 'hono';

// 32 KB is generous for an ExplainInput (a handful of effects and reasons);
// anything larger is not something the scanner produced.
export const MAX_BODY_BYTES = 32 * 1024;

export function bodyLimit(maxBytes = MAX_BODY_BYTES): MiddlewareHandler {
  return async (c, next) => {
    const declared = Number(c.req.header('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > maxBytes) {
      return c.json({ error: 'too_large' }, 413);
    }
    // Content-Length can be absent or wrong (chunked); check the real bytes.
    const raw = await c.req.raw.clone().arrayBuffer();
    if (raw.byteLength > maxBytes) return c.json({ error: 'too_large' }, 413);
    await next();
  };
}
