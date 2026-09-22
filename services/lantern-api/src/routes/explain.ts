import { Hono } from 'hono';
import { buildPrompt, sanitise, contradictsVerdict } from '@lantern/scanner';
import { validateExplainInput, BadInput } from '../validate';
import { complete, UpstreamError, type AnthropicOptions } from '../upstream/anthropic';

// POST /v1/explain — ExplainInput in, `{ explanation }` out, nothing else.
//
// The pipeline is the scanner's own, imported: buildPrompt (no XDR, no memo,
// symbol / function-name guards), the upstream call, sanitise, and the
// contradiction guard. The proxy never invents a sentence: every failure is an
// error status, and the client's fallback is the rules-based sentence.

export const MAX_OUTPUT_CHARS = 400;

export interface ExplainDeps {
  upstream: AnthropicOptions;
  log: (line: Record<string, string | number>) => void;
}

export function explainRoute(deps: ExplainDeps): Hono {
  const app = new Hono();
  app.post('/v1/explain', async (c) => {
    const started = Date.now();
    const done = (status: number, code: string) => {
      // Status, latency and a reason code only — never the payload.
      deps.log({ route: 'explain', status, code, ms: Date.now() - started });
    };
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      done(400, 'bad_input');
      return c.json({ error: 'bad_input' }, 400);
    }
    let input;
    try {
      input = validateExplainInput(raw);
    } catch (e) {
      done(400, 'bad_input');
      return c.json(
        { error: 'bad_input', ...(e instanceof BadInput ? { field: e.message } : {}) },
        400,
      );
    }
    let text: string;
    try {
      text = await complete(buildPrompt(input), deps.upstream);
    } catch (e) {
      const kind = e instanceof UpstreamError ? e.kind : 'transport';
      const status = kind === 'timeout' ? 504 : kind === 'rate_limited' ? 429 : 502;
      const code = kind === 'transport' ? 'upstream' : kind;
      done(status, code);
      return c.json({ error: code }, status);
    }
    const clean = sanitise(text, MAX_OUTPUT_CHARS);
    if (clean === '') {
      done(502, 'empty');
      return c.json({ error: 'empty' }, 502);
    }
    if (contradictsVerdict(clean, input.verdict.risk)) {
      done(502, 'contradiction');
      return c.json({ error: 'contradiction' }, 502);
    }
    done(200, 'ok');
    return c.json({ explanation: clean }, 200);
  });
  return app;
}
