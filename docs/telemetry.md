# Telemetry — what Lantern collects, and what it never does

**Status:** implemented and **default-off for the user**. The event core
(#83), the ingest backend (#85), the consent UI (#86), the emit points (#87)
and the build plumbing (#88) are in place: the release and Android builds set
`VITE_FEATURE_TELEMETRY=true` and point at the Lantern API, and nothing is
sent until the user opts in under Settings → Privacy.

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
| `app_first_open` | — (once per install, on the first consented open) | Q1 onboarding |
| `session_start` | — | Q2 usage |
| `wallet_created` | `mode: create \| import \| passkey` | Q1 |
| `message_scanned` | `risk: low \| medium \| high` | Q2 |
| `swap_executed` | `engine: sdex \| aggregator` | Q2 |
| `earn_action` | `kind: supply \| withdraw` | Q2 |
| `guardian_added` | — | Q2 |
| `anchor_flow` | `kind: deposit \| withdraw`, `stage: started \| completed \| failed` | Q2 |
| `miniapp_opened` | `appId: stardust-faucet \| lumen-notes \| lantern-demo \| other` (bundled ids only; anything else — including any remote app — is `other`, never a URL) | Q2 |
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

Raw per-install events for **90 days**, then deleted — enforced by the Lantern
API's retention job (`services/lantern-api`, #85). Rows live in Postgres on
Railway, under our control; no third party holds the data.

## Build plumbing

- `VITE_FEATURE_TELEMETRY` (`__FEATURE_TELEMETRY__`): source default `false`
  (so `npm test` and a local build carry no telemetry); set `true` in
  `release.yml` and `android.yml` (#88).
- `VITE_TELEMETRY_INGEST_URL` — the endpoint (a value, not a flag):
  `https://lantern-api-production-3fad.up.railway.app/v1/telemetry`. Its
  origin is in `manifest.config.ts` `host_permissions` — one origin, ours; a
  test asserts the two agree.
- `npm run verify:flags` builds with the flag off and on and asserts the
  telemetry module and the ingest URL are absent / present; it runs on every
  PR (`test.yml`) and in the release build.
- Generated reports go to `dist-report/`, which is git-ignored: they contain
  real user activity.
