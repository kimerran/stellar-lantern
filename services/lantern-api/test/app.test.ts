import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { readEnv, DEFAULT_MODEL } from '../src/env';
import { validateExplainInput } from '../src/validate';

// Lantern API — the explainer proxy (#80). Every test is offline: the
// upstream is a stubbed fetch, the clock is a function.

const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
// Generous limits by default; the limit tests set their own.
const env = (over: Record<string, string> = {}) =>
  readEnv({
    ANTHROPIC_API_KEY: 'sk-test',
    ALLOWED_ORIGINS: `${ORIGIN},https://demo.lantern.invalid`,
    RATE_LIMIT_PER_MIN: '1000',
    DAILY_CAP: '100000',
    UPSTREAM_TIMEOUT_MS: '200',
    ...over,
  });
const json = async (r: Response): Promise<Record<string, unknown>> =>
  (await r.json()) as Record<string, unknown>;
const modelSays =
  (text: string, status = 200): typeof fetch =>
  async () =>
    new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status });

const INPUT = {
  verdict: {
    risk: 'high',
    action: 'block_confirm',
    reasons: [
      { code: 'reported_address', severity: 'high', title: 'Reported address', detail: 'x' },
    ],
    signals: [],
    scope: 'effects shown, terms not judged',
  },
  effects: {
    source: null,
    effects: [],
    deltas: [
      {
        address: 'GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK',
        direction: 'out',
        asset: { code: 'XLM', decimals: 7 },
        amount: '25.0000000',
        bound: 'exact',
        opIndex: 0,
        source: 'classic',
      },
    ],
    net: [],
    closes: [],
    contractsTouched: [],
    approvals: [],
    unverified: [],
    observed: [],
    observedNet: [],
    coverage: 'full',
  },
};
const post = (
  app: ReturnType<typeof createApp>,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request('/v1/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('env', () => {
  it('requires the key and applies defaults', () => {
    expect(() => readEnv({})).toThrow(/ANTHROPIC_API_KEY/);
    const e = readEnv({ ANTHROPIC_API_KEY: 'k' });
    expect(e).toMatchObject({
      model: DEFAULT_MODEL,
      allowedOrigins: [],
      rateLimitPerMin: 10,
      dailyCap: 2000,
      upstreamTimeoutMs: 4000,
      port: 8080,
    });
    expect(() => readEnv({ ANTHROPIC_API_KEY: 'k', DAILY_CAP: '0' })).toThrow(/DAILY_CAP/);
  });
});

describe('healthz', () => {
  it('answers without origin or limits', async () => {
    const app = createApp({ env: env(), fetchImpl: modelSays('x') });
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, model: DEFAULT_MODEL, today: 0 });
  });
});

describe('POST /v1/explain', () => {
  it('returns the sanitised sentence and only { explanation }', async () => {
    const app = createApp({
      env: env(),
      fetchImpl: modelSays('**Sends** 25 XLM to GDVE…ZA57. <b>Careful.</b>'),
    });
    const res = await post(app, INPUT);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toEqual({ explanation: 'Sends 25 XLM to GDVE…ZA57. Careful.' });
    expect(Object.keys(body)).toEqual(['explanation']);
  });

  it('sends the key upstream, the shared prompt, and no XDR', async () => {
    let sent:
      | {
          headers: Record<string, string>;
          body: {
            system: string;
            messages: Array<{ content: string }>;
            model: string;
            max_tokens: number;
          };
        }
      | undefined;
    const fetchImpl: typeof fetch = async (_u, init) => {
      sent = {
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)),
      };
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
        status: 200,
      });
    };
    const app = createApp({ env: env(), fetchImpl });
    await post(app, INPUT);
    expect(sent?.headers['x-api-key']).toBe('sk-test');
    expect(sent?.body.model).toBe(DEFAULT_MODEL);
    expect(sent?.body.max_tokens).toBe(200);
    expect(sent?.body.messages[0]?.content).toMatch(
      /^Risk verdict \(final\): high — action: block_confirm\./,
    );
    expect(sent?.body.messages[0]?.content).toMatch(/25\.0000000 XLM leaves GAMN…SRNK/);
    expect(JSON.stringify(sent?.body)).not.toMatch(/[A-Za-z0-9+/]{80,}={0,2}/);
  });

  it('never fabricates: empty → 502 empty, contradiction → 502 contradiction, upstream 500 → 502, 429 → 429, timeout → 504', async () => {
    const cases: Array<[string, typeof fetch, number, string]> = [
      ['empty', modelSays('   '), 502, 'empty'],
      ['contradiction', modelSays('This is completely safe, no risk.'), 502, 'contradiction'],
      ['upstream 500', modelSays('', 500), 502, 'upstream'],
      ['upstream 429', modelSays('', 429), 429, 'rate_limited'],
      [
        'network throws',
        async () => {
          throw new TypeError('fetch failed');
        },
        502,
        'upstream',
      ],
      ['non-JSON', async () => new Response('<html>', { status: 200 }), 502, 'empty'],
      [
        'timeout',
        (_u, init) =>
          new Promise((_r, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
        504,
        'timeout',
      ],
    ];
    for (const [name, fetchImpl, status, code] of cases) {
      const app = createApp({ env: env(), fetchImpl });
      const res = await post(app, INPUT);
      expect(res.status, name).toBe(status);
      expect(await res.json(), name).toEqual({ error: code });
    }
  });

  it('rejects bad input: not JSON, unknown field, wrong type, oversize string, too many items', async () => {
    const app = createApp({ env: env(), fetchImpl: modelSays('x') });
    expect((await post(app, '{not json')).status).toBe(400);
    const unknown = { ...INPUT, verdict: { ...INPUT.verdict, extra: 1 } };
    expect((await post(app, unknown)).status).toBe(400);
    expect(await (await post(app, unknown)).json()).toMatchObject({
      error: 'bad_input',
      field: 'verdict.extra: unknown field',
    });
    const wrongType = { ...INPUT, verdict: { ...INPUT.verdict, risk: 'critical' } };
    expect((await post(app, wrongType)).status).toBe(400);
    const oversize = {
      ...INPUT,
      verdict: {
        ...INPUT.verdict,
        reasons: [{ ...INPUT.verdict.reasons[0], title: 'x'.repeat(201) }],
      },
    };
    expect((await post(app, oversize)).status).toBe(400);
    const tooMany = {
      ...INPUT,
      effects: { ...INPUT.effects, deltas: Array(65).fill(INPUT.effects.deltas[0]) },
    };
    expect((await post(app, tooMany)).status).toBe(400);
    // A nested arg that is arbitrarily deep is bounded too.
    let deep: unknown = { type: 'symbol', value: 'x' };
    for (let i = 0; i < 6; i += 1) deep = { type: 'vec', items: [deep] };
    const deepArgs = {
      ...INPUT,
      effects: {
        ...INPUT.effects,
        unverified: [
          {
            label: 'unverified contract — semantics unknown',
            contractId: 'C',
            functionName: 'f',
            args: [deep],
            depth: 0,
          },
        ],
      },
    };
    expect((await post(app, deepArgs)).status).toBe(400);
  });

  it('forwards only the fields the prompt reads', () => {
    const v = validateExplainInput({
      ...INPUT,
      effects: { ...INPUT.effects, source: { operations: [] }, net: [{ anything: true }] },
    });
    expect(v.effects.source).toBeNull();
    expect(v.effects.net).toEqual([]);
    expect(v.verdict.signals).toEqual([]);
  });

  it('enforces the body limit', async () => {
    const app = createApp({ env: env(), fetchImpl: modelSays('x') });
    const big = {
      ...INPUT,
      effects: { ...INPUT.effects, contractsTouched: Array(64).fill('C'.repeat(200)) },
    };
    const padded = JSON.stringify(big) + ' '.repeat(40 * 1024);
    const res = await post(app, padded);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'too_large' });
  });
});

describe('origin allowlist', () => {
  it('denies an unlisted origin and a missing one; allows a listed one; empty list allows all', async () => {
    const app = createApp({ env: env(), fetchImpl: modelSays('ok') });
    expect((await post(app, INPUT, { Origin: 'https://evil.invalid' })).status).toBe(403);
    const noOrigin = await app.request('/v1/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(INPUT),
    });
    expect(noOrigin.status).toBe(403);
    expect((await post(app, INPUT, { Origin: 'https://demo.lantern.invalid' })).status).toBe(200);
    const open = createApp({
      env: readEnv({ ANTHROPIC_API_KEY: 'k' }),
      fetchImpl: modelSays('ok'),
    });
    expect((await post(open, INPUT, { Origin: 'https://anything.invalid' })).status).toBe(200);
  });
});

describe('limits', () => {
  it('per-IP: N ok, N+1 → 429 rate_limited, window resets on a fake clock; IPs are independent', async () => {
    let t = 1_700_000_000_000;
    const app = createApp({
      env: env({ RATE_LIMIT_PER_MIN: '3' }),
      fetchImpl: modelSays('ok'),
      now: () => t,
    });
    const ip = (a: string) => ({ 'X-Forwarded-For': `${a}, 10.0.0.1` });
    for (let i = 0; i < 3; i += 1) expect((await post(app, INPUT, ip('1.1.1.1'))).status).toBe(200);
    const blocked = await post(app, INPUT, ip('1.1.1.1'));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'rate_limited' });
    expect((await post(app, INPUT, ip('2.2.2.2'))).status).toBe(200);
    t += 60_001;
    expect((await post(app, INPUT, ip('1.1.1.1'))).status).toBe(200);
  });

  it('daily cap: service-wide, resets at UTC midnight', async () => {
    let t = Date.UTC(2026, 8, 15, 23, 59, 0);
    const app = createApp({
      env: env({ DAILY_CAP: '5' }),
      fetchImpl: modelSays('ok'),
      now: () => t,
    });
    // 5 requests from 5 different IPs fill the day.
    for (let i = 0; i < 5; i += 1) {
      expect((await post(app, INPUT, { 'X-Forwarded-For': `10.0.0.${i}` })).status).toBe(200);
    }
    const capped = await post(app, INPUT, { 'X-Forwarded-For': '10.0.0.9' });
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({ error: 'daily_cap' });
    expect((await json(await app.request('/healthz'))).today).toBe(5);
    t = Date.UTC(2026, 8, 16, 0, 0, 1);
    expect((await post(app, INPUT, { 'X-Forwarded-For': '10.0.0.9' })).status).toBe(200);
  });

  it('a rate-limited request does not spend the daily cap or reach upstream', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
        status: 200,
      });
    };
    const app = createApp({ env: env({ RATE_LIMIT_PER_MIN: '3' }), fetchImpl });
    for (let i = 0; i < 4; i += 1) await post(app, INPUT);
    expect(calls).toBe(3);
    expect((await json(await app.request('/healthz'))).today).toBe(3);
  });
});

describe('logging', () => {
  it('logs status, latency and a code — never the payload, the prompt or the key', async () => {
    const lines: Array<Record<string, string | number>> = [];
    const app = createApp({
      env: env(),
      fetchImpl: modelSays('Sends 25 XLM.'),
      log: (l) => lines.push(l),
    });
    await post(app, INPUT);
    await post(app, { ...INPUT, verdict: { ...INPUT.verdict, extra: 1 } });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ route: 'explain', status: 200, code: 'ok' });
    expect(typeof lines[0]?.ms).toBe('number');
    expect(lines[1]).toMatchObject({ status: 400, code: 'bad_input' });
    const text = JSON.stringify(lines);
    expect(text).not.toContain('GAMNECU4');
    expect(text).not.toContain('25.0000000');
    expect(text).not.toContain('Risk verdict');
    expect(text).not.toContain('sk-test');
  });
});
