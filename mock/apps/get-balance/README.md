# Get Balance — Lantern demo dApp

A tiny, dependency-free web app that runs inside **Lantern's mini-app browser**,
connects to the wallet, and shows the account's **XLM balance**. Part A of #10.

It's a single static `index.html` — no build step, no packages.

## What it does

1. Renders a **Connect** button.
2. Resolves the wallet's public key, trying in order:
   - **`?addr=` URL param** — Lantern injects this for bundled apps today (works now).
   - **`postMessage` handshake** — forward-compatible with the real wallet bridge (#10, Part B).
   - **manual entry** — paste a `G…` key, so the demo also works standalone in any browser.
3. Fetches the native (XLM) balance from **Horizon** and displays it. Handles the
   unfunded-account case (404 → `0 XLM`).

Read-only: it only ever requests the **public key** — never signing, never secrets.

## Run / deploy

**Locally:** open `index.html` in a browser, or serve the folder:
```bash
npx serve mock/apps/get-balance      # then open the printed URL
```
Append `?addr=G...` (and optionally `?network=PUBLIC`) to test the connected state:
```
http://localhost:3000/?addr=GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H
```

**Live (for the Lantern test):** deploy the folder to any static host —
Vercel / Netlify / Cloudflare Pages / GitHub Pages — and open the public **https** URL
in Lantern → **Apps** → mini-app browser.

> ⚠️ The host must allow embedding (no `X-Frame-Options: DENY` / restrictive
> `frame-ancestors`), since Lantern loads it in a WebView/iframe surface.

## Network

Defaults to **Testnet** (`horizon-testnet.stellar.org`). Pass `?network=PUBLIC` for
Mainnet, or have the wallet bridge supply it. On Testnet, fund the account via
[Friendbot](https://laboratory.stellar.org/#account-creator?network=test) first.

## Wallet functions demonstrated

- **Connect** — read-only, returns the public key + network (with user approval).
- **Balances** — XLM plus any other assets (trustlines), live-refreshable.
- **Fund (Friendbot)** — on Testnet, fund an unfunded account in one tap.
- **Send via Lantern** — submit a payment *intent*; Lantern builds, **AI-scans**,
  has the user approve, signs, and submits — the key never leaves the wallet.

## Wallet bridge contract (Lantern)

**Connect (read-only):**
- App → host: `{ type: 'lantern:getPublicKey' }`
- host → App: `{ type: 'lantern:connecting' }` (ack) → after approval →
  `{ type: 'lantern:publicKey', publicKey, network }` (or `{ type: 'lantern:connectRejected' }`)

**Sign & submit a payment:**
- App → host: `{ type: 'lantern:signAndSubmit', intent: { destination, amount, memo? } }`
- host → App: `{ type: 'lantern:signing' }` (ack) → after review/approval →
  `{ type: 'lantern:txResult', hash }` (or `lantern:txRejected` / `{ type: 'lantern:txError', error }`)

The app sends only an **intent** — Lantern constructs and scans the transaction.
The `?addr=` param / manual entry paths keep balance lookups working standalone.
