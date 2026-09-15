// The one outbound call. Injectable fetch; deadline-bounded; the response
// body read is covered by the same deadline.

export class UpstreamError extends Error {
  readonly kind: 'timeout' | 'transport' | 'rate_limited' | 'empty';
  constructor(kind: UpstreamError['kind'], message: string) {
    super(message);
    this.name = 'UpstreamError';
    this.kind = kind;
  }
}

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export const ANTHROPIC_MESSAGES = 'https://api.anthropic.com/v1/messages';

export async function complete(
  prompt: { system: string; user: string },
  opts: AnthropicOptions,
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetchImpl(opts.endpoint ?? ANTHROPIC_MESSAGES, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': opts.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: 200,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        }),
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted) throw new UpstreamError('timeout', 'upstream deadline');
      throw new UpstreamError('transport', e instanceof Error ? e.message : 'network error');
    }
    if (res.status === 429) throw new UpstreamError('rate_limited', 'upstream rate-limited');
    if (!res.ok) throw new UpstreamError('transport', `upstream ${res.status}`);
    let body: { content?: Array<{ type?: string; text?: string }> };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      if (controller.signal.aborted) throw new UpstreamError('timeout', 'upstream deadline');
      throw new UpstreamError('empty', 'non-JSON body');
    }
    const text = (body.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join(' ');
    if (text.trim() === '') throw new UpstreamError('empty', 'no text');
    return text;
  } finally {
    clearTimeout(timer);
  }
}
