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
- **Anonymous** (non-alpha builds — see *Alpha builds* below). The only
  identity is a random UUID minted on the device on first run (`crypto.randomUUID()`), stored locally, never derived from a
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

Never leaves the device, under any flag or code path (one exception: the
wallet's **public** address in alpha builds, see below — nothing else here
changes there):

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

## Alpha builds: the wallet address IS collected (#100)

Builds made with `VITE_FEATURE_TELEMETRY_IDENTITY=true` — the alpha APK and
extension zip from `release.yml` / `android.yml` — **attempt to attach** the
wallet's **public address** (`G…`) to each consented telemetry envelope as
`account`, so the activity report can be read per tester without a manual id
hand-off. It is best effort: with no wallet yet, unreadable storage, or a
value that is not a valid public key, the envelope is still sent, anonymous.
In those builds the consent card and Settings → Privacy say so: the title is
*Share usage data (alpha)*, "What we collect" lists *your public wallet
address (alpha builds only)*, and the "never collect" list drops the
addresses line — secret keys, seed phrases/passwords/vault bytes, amounts,
asset codes, memos, transaction hashes, raw message text, geolocation, device
fingerprints and advertising ids are still never collected. Everything else on
this page still holds: opt-in, default off, delete on request.

The address is the **only** key-shaped value the validator accepts, only in
the envelope's `account` field, only as a checksum-valid ed25519 public key
(StrKey `G`); secret keys, contract ids, format-matching strings with a bad
checksum, and anything key-shaped anywhere else are still rejected. The flag
is off by default and must be off in any store submission — a non-alpha build
carries none of this code and its copy is unchanged; the validator (shared
with the API) accepts the field from any build, so the API keeps working for
both.

### Matching a tester to their trail (#98)

Settings → Privacy shows the install id as **Analytics ID** while sharing is
on, with a copy button. A tester may share it with us *voluntarily* — the alpha
guide asks for it in the results zip — and the operator keeps the mapping in a
local, git-ignored file passed to `npm run report:activity -- --map
reports/alpha.map.json`. Mapped installs are labelled by that name in the
report; everyone else stays "User N". The id is still a random UUID: nothing
about it, or about the mapping, links to a wallet address, and "Delete my
data" discards it as before.

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
| `tx_rechecked` | `drifted: boolean`, `direction: none \| escalated \| de_escalated \| lateral \| failed` (the re-simulate before submit, #121; `failed` = could not re-check) | Q4 / §3.9 |
| `registry_report_submitted` | `reason: Scam \| Phishing \| Drainer \| Poisoning \| Mixer \| Other`, `ok: boolean` (the one-click registry report, #120 — no subject, fee or note) | Q4 / §6.3 registry targets |
| `consent_granted` / `consent_revoked` | — | audit |

Each flush sends one envelope:

```json
{
  "installId": "<uuid>",
  "platform": "extension" | "android",
  "appVersion": "0.1.0",
  "network": "testnet" | "public",
  "account": "G…",   // alpha builds only (#100); absent otherwise
  "events": [{ "name": "…", "props": { … }, "ts": 1700000000000 }]
}
```

## Consent model

- Consent is the `analyticsConsent` field of the wallet's existing Settings
  record (`src/shared/storage.ts`) — no parallel store. Default `false`.
- **Settings → Privacy** holds the toggle ("Share anonymous usage data"), the
  what-we-collect / what-we-never-collect lists (the same text as this
  document, asserted by test), and **Delete my data**.
- The prompt appears **once**, after onboarding has produced a wallet — never
  before, and never blocking: it is a card above the bottom nav with no
  backdrop and no modal semantics, so every wallet control stays reachable
  while it is up. "Not now" answers it for good (`analyticsPromptSeen`), and
  it is never shown again after either answer.
- **Delete my data** is its own action, not the toggle: it sends the deletion
  request whenever this install has an id — even if consent is already off,
  so a revoke that never reached the server can be retried — and always ends
  with consent off and the id forgotten.
- Granting emits `consent_granted` and starts the sink. Revoking emits
  `consent_revoked`, stops emission, sends a deletion request for the install
  id, and forgets the id locally.
- Transport failures are swallowed: analytics can never break the wallet, and
  a failed batch is dropped, not retried (a retry queue is a privacy
  liability). The buffer is capped at 200 events.

## Not telemetry: the download log (#131)

`https://lantern-api-production-3fad.up.railway.app/download/android` and
`…/download/extension` redirect to the current build and count the click. That
log is **a server log, not part of the opt-in analytics above**, and it is
kept apart on purpose: in-app events rest on the consent switch; a download
click cannot, because there is no app yet to consent in. So it lives in its
own table, is never joined to events, and is exported separately.

What a row holds — and all it holds: which build (`android` / `extension`),
the version it was sent to, the `?src=` campaign slug, a coarse country from
the CDN's header when there is one, and a three-bucket browser family. **No IP
address** (the code that writes the row never reads it) and **no user-agent
string**. A row is a download *intent* — a click — not a completed download,
and the dashboard says so. Same 90-day retention as everything else.

## Retention

Raw per-install events for **90 days**, then deleted — enforced by the Lantern
API's retention job (`services/lantern-api`, #85). Rows live in Postgres on
Railway, under our control; no third party holds the data.

## The report

The Lantern API serves an analytics UI at `https://<lantern-api>/admin`
(#104, #106) behind the admin token: a **dashboard** (tiles, events-per-day
chart, event and verdict tables), a **wallets** table (one row per identity,
sortable) with a **drill-down** per wallet (`/admin/wallets/<address>`), the
full report at `/admin/report`, and raw downloads at `/admin/export.csv` and
`/admin/export.json` — all sharing `?since&until&platform`, the downloads
also `&wallet=<key>`. Route details in `services/lantern-api/README.md`.
Offline:

`npm run report:activity` (`scripts/report-activity.ts`) pulls the raw rows
from `GET /v1/telemetry/export` (`TELEMETRY_ADMIN_TOKEN`, optional
`--since` / `--until`) and writes **one self-contained file**,
`dist-report/index.html`: inline CSS in the Lantern palette, no script, no
external stylesheet, font, image or fetch — it opens from `file://` and
survives being emailed. Sections: summary (window, distinct installs, by
platform, by network), Q1 onboarded by mode, Q2 event × count × distinct
installs, Q3 per-install trails as "User 1", "User 2", … in first-seen order
(the UUID never appears — asserted), Q4 transaction and scan counts by
platform with the registry's on-chain `Count` (distinct reported subjects)
read fee-free as a cross-check. `--format=json` emits the same numbers for
diffing between periods; `--input export.jsonl` renders a saved export
offline. Zero events renders a clean empty state. `dist-report/` is
git-ignored: it contains real user activity.

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
