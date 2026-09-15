# Telemetry — what Lantern collects, and what it never does

**Status:** the event core, consent gate and privacy guarantees are
implemented (#81, slice 1). The Settings toggle, the emit points and the
ingest backend are follow-up slices; until they land the `telemetry` flag is
**OFF** in every build and nothing here is active.

This document is what we point the Chrome Web Store reviewer and grant
reviewers at.

## The short version

- **Opt-in, default off.** Nothing is collected until the user turns
  analytics on in Settings. The sink is a hard no-op before that: it does not
  even buffer.
- **Anonymous.** The only identity is a random UUID minted on the device on
  first run (`crypto.randomUUID()`), stored locally, never derived from a
  Stellar address, a device property or hardware. "Delete my data" forgets it
  locally and asks the server to drop that install's rows; a later opt-in
  starts an unlinkable trail.
- **Enum-only events.** Every event's properties are chosen from a fixed
  list. There is no free-text field in the type system, and a runtime guard
  rejects anything outside the list before it reaches the wire.
- **No third-party SDK.** A plain `fetch()` POST to one origin we run.
- **Off means off.** With the build flag off, no telemetry code and no ingest
  origin exist in the bundle at all.

## What we never collect

Never leaves the device, under any flag or code path:

- public or secret keys, addresses, or any `G…` / `S…` / `C…` / `M…` string
- seed phrases, passwords, PBKDF2 parameters, any vault bytes
- amounts, asset codes, memos, transaction hashes
- the **raw pasted message text** from the scan flow — only the derived
  `risk` label (`low` / `medium` / `high`)
- IP-derived geolocation beyond coarse country; no device fingerprint; no
  advertising ids

The validator (`src/core/telemetry/validate.ts`) rejects an envelope that
contains anything shaped like a Stellar key anywhere in it, and the generated
report never prints the install UUID — it renders installs as "User 1",
"User 2", … in first-seen order.

## Events

| event | props | answers |
|---|---|---|
| `app_first_open` | — | Q1 onboarding |
| `session_start` | — | Q2 usage |
| `wallet_created` | `mode: create \| import \| passkey` | Q1 |
| `message_scanned` | `risk: low \| medium \| high` | Q2 |
| `swap_executed` | `engine: sdex \| aggregator` | Q2 |
| `earn_action` | `kind: supply \| withdraw` | Q2 |
| `guardian_added` | — | Q2 |
| `anchor_flow` | `kind: deposit \| withdraw`, `stage: started \| completed \| failed` | Q2 |
| `miniapp_opened` | `appId: blockhub \| stellar-expert \| soroswap \| blend \| other` (bundled ids only, never a URL) | Q2 |
| `tx_signed` | `kind: sign_and_submit \| sign_only \| submit_only`, `ok: boolean` | Q4 |
| `tx_scanned` | `risk`, `action: allow \| warn \| block_confirm` | Q4 |
| `high_risk_gated` | `risk` | Q4 |
| `consent_granted` / `consent_revoked` | — | audit |

Each flush sends one envelope:

```json
{
  "installId": "<uuid>",
  "platform": "extension" | "android",
  "appVersion": "0.1.0",
  "network": "testnet" | "public",
  "events": [{ "name": "…", "props": { … }, "ts": 1700000000000 }]
}
```

## Consent model

- Consent is the `analyticsConsent` field of the wallet's existing Settings
  record (`src/shared/storage.ts`) — no parallel store. Default `false`.
- The prompt appears **once**, after onboarding completes — never before,
  never blocking.
- Granting emits `consent_granted` and starts the sink. Revoking emits
  `consent_revoked`, stops emission, sends a deletion request for the install
  id, and forgets the id locally.
- Transport failures are swallowed: analytics can never break the wallet, and
  a failed batch is dropped, not retried (a retry queue is a privacy
  liability). The buffer is capped at 200 events.

## Retention

**Proposed:** raw per-install events for 90 days, then aggregate-only. To be
confirmed with the ingest backend decision (open on #81).

## Build plumbing

- `VITE_FEATURE_TELEMETRY` (`__FEATURE_TELEMETRY__`), default `false`;
  listed explicitly in `release.yml` as `false`.
- `VITE_TELEMETRY_INGEST_URL` — the endpoint (a value, not a flag). Its origin
  must also be added to `manifest.config.ts` `host_permissions` — one origin,
  ours — when the backend is decided.
- Generated reports go to `dist-report/`, which is git-ignored: they contain
  real user activity.
