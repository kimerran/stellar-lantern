// The wallet-side composition for the scanner's AI explainer (#59).
//
// This is the only place `scannerAi` is read. With the flag OFF (the
// default, and every store build) it returns `undefined` and the hosted
// model client dead-code-eliminates out of the bundle, exactly like the
// other `__FEATURE_*__` gates. With the flag ON, the host still has to supply
// a key source — never a `VITE_*` value, which would be inlined into a
// bundle anyone can unzip — or a proxy endpoint that holds the key
// server-side (the D2 epic's option 1, planned before D4). D3 decides which
// and where the sentence surfaces; today nothing in the wallet calls this.
import { createHostedExplainer, type Explainer } from '@lantern/scanner';

export interface HostedExplainerSource {
  // A key the host obtained at runtime (settings, secure storage, a login).
  apiKey?: string;
  // The Lantern API's /v1/explain URL (services/lantern-api). With no
  // apiKey this selects proxy mode: the key stays server-side.
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch; // tests
}

export function hostedExplainer(source: HostedExplainerSource): Explainer | undefined {
  if (!__FEATURE_SCANNER_AI__) return undefined;
  if (!source.apiKey && !source.endpoint) return undefined;
  // An endpoint with no key is the Lantern API (services/lantern-api): the
  // key stays server-side. A key means direct Anthropic — local dev only.
  const mode = source.apiKey ? 'anthropic' : 'proxy';
  return createHostedExplainer({
    mode,
    apiKey: source.apiKey ?? '',
    ...(source.endpoint ? { endpoint: source.endpoint } : {}),
    ...(source.model ? { model: source.model } : {}),
    ...(source.timeoutMs !== undefined ? { timeoutMs: source.timeoutMs } : {}),
    ...(source.fetchImpl ? { fetchImpl: source.fetchImpl } : {}),
  });
}
