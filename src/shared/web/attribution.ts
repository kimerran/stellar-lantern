import { getKV } from '../kv';
import { WEB_SOURCES, type WebSource } from '../../core/telemetry/events';
import { currentInstallEnv, isInstalled } from './install';

// Where a web-app user came from (#239). The homepage links to the web app
// with `?src=homepage-ios` (or another campaign slug). On the very first open,
// the app keeps that value as one of a closed set (WEB_SOURCES), never as the
// raw string: anything unrecognised is 'other'. An open without `src` records
// 'launch' when the app runs installed (Home Screen / standalone, which on iOS
// has its own storage and starts at the manifest's bare "/"), and nothing in a
// browser tab. Later opens never change it, so a Home Screen icon saved from a
// `?src=` URL doesn't re-attribute anyone. On iOS, homepage-ios is only seen
// from the Home Screen when its icon keeps the `?src=` URL.
//
// The value stays on the device. It's sent once, as `web_attributed`, only
// after the user opts in to analytics (core/telemetry, `attributeOnce`).

export const WEB_SOURCE_KEY = 'lantern.web.source';
// Set on the first open whatever it carried, so only the first open counts.
export const WEB_FIRST_OPEN_KEY = 'lantern.web.firstOpen';
// Set once `web_attributed` has gone out.
export const WEB_ATTRIBUTED_KEY = 'lantern.web.attributed';

const KNOWN: ReadonlySet<string> = new Set(WEB_SOURCES);

/** Fold any raw `src` value into the enum: a known slug is kept, anything else is 'other'. */
export function toWebSource(raw: string): WebSource {
  return KNOWN.has(raw) ? (raw as WebSource) : 'other';
}

/** The first `src` in a query string as an enum value, or null when there is none. */
export function webSourceFromSearch(search: string): WebSource | null {
  const raw = new URLSearchParams(search).get('src');
  return raw === null ? null : toWebSource(raw);
}

let recording: Promise<void> | null = null;

// Whether this page runs as an installed app. False when there's no browser
// (vitest's node environment has no `window`).
function launchedInstalled(): boolean {
  try {
    return isInstalled(currentInstallEnv());
  } catch {
    return false;
  }
}

/** Record the first open's source. Idempotent, and shared within a page load,
 *  so main.tsx and the telemetry boot can both call it without racing. */
export function recordFirstOpenSource(
  search: string = globalThis.location?.search ?? '',
  installed: () => boolean = launchedInstalled,
): Promise<void> {
  recording ??= (async () => {
    const kv = await getKV();
    if (await kv.get(WEB_FIRST_OPEN_KEY)) return;
    const src = webSourceFromSearch(search) ?? (installed() ? 'launch' : null);
    if (src) await kv.set(WEB_SOURCE_KEY, src);
    await kv.set(WEB_FIRST_OPEN_KEY, '1');
  })().catch(() => {
    /* storage unavailable: no attribution, the app carries on */
  });
  return recording;
}

/** The recorded source, re-checked against the enum (storage is not trusted). */
export async function recordedWebSource(): Promise<WebSource | null> {
  const v = await (await getKV()).get(WEB_SOURCE_KEY);
  return v !== null && KNOWN.has(v) ? (v as WebSource) : null;
}

/** Send the recorded source once, and only with consent. Returns whether it was sent. */
export async function attributeOnce(
  send: (src: WebSource) => void,
  hasConsent: () => boolean,
): Promise<boolean> {
  await recordFirstOpenSource();
  const kv = await getKV();
  const src = await recordedWebSource();
  if (!src || (await kv.get(WEB_ATTRIBUTED_KEY))) return false;
  // Consent may have been revoked while the reads awaited.
  if (!hasConsent()) return false;
  send(src);
  await kv.set(WEB_ATTRIBUTED_KEY, '1');
  return true;
}

// Test hook.
export function __resetAttribution(): void {
  recording = null;
}
