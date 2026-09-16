// Runtime guard for the wire (#81). The types already make PII impossible to
// express; this is the belt to those braces, for anything that reaches
// `emit()` through a cast, a JSON round-trip or a future bug. It rejects:
// unknown events, unknown props, values outside the enum, any string that
// looks like a Stellar key (G/S/C/M StrKey), anything that looks like an
// amount, and any free text at all. A rejected event is dropped, never sent.

import { EVENT_SCHEMA, type Envelope, type StampedEvent } from './events';

const STRKEY_RE = /\b[GSCM][A-Z2-7]{55}\b/;
// Alpha identity (#100): the only key-shaped value allowed, and only as the
// envelope's `account`, and only a public (G) key. Checked as a real StrKey —
// version byte 6<<3 for ed25519 public keys plus the CRC16-XModem checksum —
// inline rather than via the SDK so the API bundle stays dependency-free.
const ACCOUNT_RE = /^G[A-Z2-7]{55}$/;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(s: string): Uint8Array {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}
function crc16xmodem(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i += 1)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
export function isPublicAccount(v: unknown): v is string {
  if (typeof v !== 'string' || !ACCOUNT_RE.test(v)) return false;
  const raw = base32Decode(v); // 35 bytes: version, 32-byte key, 2-byte checksum (LE)
  if (raw.length !== 35 || raw[0] !== 6 << 3) return false;
  const expect = crc16xmodem(raw.subarray(0, 33));
  return raw[33] === (expect & 0xff) && raw[34] === expect >>> 8;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLATFORMS = new Set(['extension', 'android']);
const NETWORKS = new Set(['testnet', 'public']);

export function validateEvent(e: unknown): e is StampedEvent {
  if (!e || typeof e !== 'object') return false;
  const { name, props, ts, ...rest } = e as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return false;
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(EVENT_SCHEMA, name))
    return false;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return false;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return false;
  const schema = EVENT_SCHEMA[name as keyof typeof EVENT_SCHEMA];
  const p = props as Record<string, unknown>;
  for (const k of Object.keys(p)) {
    // Own-property only: a JSON key of "constructor" or "__proto__" would
    // otherwise read Object.prototype through the chain and throw below.
    const allowed = Object.prototype.hasOwnProperty.call(schema, k) ? schema[k] : undefined;
    if (allowed === undefined) return false;
    const v = p[k];
    if (allowed === 'boolean') {
      if (typeof v !== 'boolean') return false;
    } else {
      if (typeof v !== 'string' || !allowed.includes(v)) return false;
    }
  }
  // Every schema prop must be present — a partial event is not an event.
  for (const k of Object.keys(schema)) if (!(k in p)) return false;
  return true;
}

export function validateEnvelope(env: unknown): env is Envelope {
  if (!env || typeof env !== 'object') return false;
  const { installId, platform, appVersion, network, events, account, ...rest } = env as Record<
    string,
    unknown
  >;
  if (Object.keys(rest).length > 0) return false;
  if (account !== undefined && !isPublicAccount(account)) return false;
  if (typeof installId !== 'string' || !UUID_RE.test(installId)) return false;
  if (typeof platform !== 'string' || !PLATFORMS.has(platform)) return false;
  if (typeof network !== 'string' || !NETWORKS.has(network)) return false;
  if (
    typeof appVersion !== 'string' ||
    appVersion.length > 32 ||
    !/^[0-9A-Za-z.+-]+$/.test(appVersion)
  )
    return false;
  if (!Array.isArray(events) || events.length > 500) return false;
  if (!events.every(validateEvent)) return false;
  // Nothing anywhere else in the serialised envelope may look like a key.
  return !STRKEY_RE.test(JSON.stringify({ ...(env as object), account: undefined }));
}
