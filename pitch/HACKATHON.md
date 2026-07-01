# Lantern — Hackathon Pitch Deck

> Single-file deck. Each `## Slide N` is one slide; `---` separates slides.
> Technical claims are grounded in the repo; anything not directly verifiable in
> code is marked `[inferred]`.

---

## Slide 1: Lantern

**Tagline:** See what you sign — a non-custodial Stellar wallet with a safety check at signing time.

- Browser extension (Chrome MV3) **and** Android app, from one codebase
- Team: **<Team Name — placeholder>** `[inferred]`

![Placeholder: Lantern logo (amber lantern orb on deep navy) + the Assets screen on a phone](placeholder-image.png)

**Speaker notes:** Hi, we're Lantern — a non-custodial wallet for the Stellar network that runs as a Chrome extension and as an Android app from a single TypeScript codebase. Our one-liner is "see what you sign": before you approve anything, Lantern explains what you're actually authorizing and flags risk. Keys never leave the device — they're encrypted at rest and only ever live in memory while unlocked. In the next three minutes I'll show the problem, the working product, and where it goes next.

---

## Slide 2: Problem

- Self-custody means approving **opaque transactions** — raw XDR you can't read
- One wrong "Approve" = drained funds, removed signers, unlimited token allowances
- Custodial wallets are easy but take your keys; non-custodial wallets keep keys but leave you blind

![Placeholder: side-by-side of a confusing raw-XDR approval vs. a plain-language review](placeholder-image.png)

**Speaker notes:** On Stellar — and crypto generally — the #1 attack surface is the signature itself. Non-custodial wallets hand you control of your keys but then ask you to approve dense, machine-readable transactions with no idea what they do: a payment, a trustline change, removing a signer, or an unlimited allowance all look the same. People lose funds because the wallet shows what to sign but not what it means. Custodial apps avoid this by taking custody, which defeats the point. We think you shouldn't have to choose between control and understanding.

---

## Slide 3: Solution

**Lantern is a non-custodial Stellar wallet that decodes and risk-checks every transaction in plain language before you sign — and hosts dApps in a permissioned in-wallet browser.**

- **Pre-sign review** — decodes the transaction, explains it in one sentence, gates the Sign button by risk (allow / warn / high-risk type-CONFIRM)
- **Mini-app browser + wallet bridge** — dApps `connect`, request a payment, or ask for a signed message; every request is reviewed before signing
- **Keys stay put** — AES-GCM vault (PBKDF2 ≥ 600k); the decrypted key only lives in worker/app memory

![Placeholder: the Send "Review" screen showing the risk callout + Sign gate](placeholder-image.png)

**Speaker notes:** Lantern sits between you and every signature. When you send — or when a dApp asks you to sign — we decode the transaction, summarize it in plain English, and grade the risk: low just shows a "checked" badge, medium warns, and high-risk literally makes you type CONFIRM. It's advisory, not custodial — we never block you and never hold your keys. And it's not just the wallet's own send screen: we added an in-wallet mini-app browser with a postMessage bridge so external dApps get the same protection. Today the risk engine is a deterministic rules engine with a stable contract; the AI tiers are the roadmap, and I'll be honest about that.

---

## Slide 4: Demo

Core flow — a dApp pays through Lantern, scanned first:

1. **Apps** tab → open a dApp (bundled, or type a URL) in the sandboxed browser
2. dApp calls **Connect** → approval sheet → returns your public key + network
3. dApp requests a payment → Lantern **builds + risk-checks** it → review sheet → approve → signs & submits → returns the tx hash

![Placeholder: 3-panel flow — Connect approval → scanned payment review → "Sent ✓" with tx hash](placeholder-image.png)

[PLACEHOLDER: Demo video — screen recording (~60–75s): open the `mock/apps/get-balance` dApp in Lantern's Apps browser, tap Connect → approve, see the XLM balance load, then "Send via Lantern" → show the risk review → approve → tx hash + balance refresh. End on the high-risk type-CONFIRM gate when sending to a flagged address.]

**Speaker notes:** Here's the real flow, end to end. I open our sample dApp inside Lantern's mini-app browser; it calls connect, I approve, and it reads my testnet XLM balance straight from Horizon. Then I send a payment from the dApp — but notice the dApp only sends an *intent*; Lantern builds the transaction, runs the security review, and shows me exactly what I'm signing before anything happens. I approve, it signs in the wallet and submits, and the dApp gets the hash back. The key point: a malicious or buggy dApp can't slip an opaque transaction past me — the scan is between the request and the signature. `[inferred: live demo runs on Testnet]`

---

## Slide 5: How it works

- **Stack:** TypeScript (strict) · React 18 · Tailwind · Vite + `@crxjs/vite-plugin` (MV3) · `@stellar/stellar-sdk` 15 · `bip39` + SEP-0005 HD derivation · Web Crypto
- **Three layers:** `popup/` React UI (never holds the secret) ↔ background **service worker** (owns the unlocked `Keypair`, signs/submits) ↔ framework-agnostic `core/` (`crypto`, `wallet`, `stellar`, `scan`, `miniapps`, `session`)
- **One codebase, two hosts:** Android via **Capacitor 8** — `chrome.storage`→Preferences and the worker→an in-process handler, swapped behind seams (`shared/kv`, `shared/messages`); committed `android/` project + debug-APK CI
- **Quality:** 63 Vitest tests across 10 files

![Placeholder: architecture diagram — UI ↔ worker/in-process handler ↔ core ↔ Horizon/Friendbot](placeholder-image.png)

**Speaker notes:** Architecturally, the UI never sees your secret — it talks to a background service worker that holds the decrypted keypair in memory and does all signing and submitting. Everything reusable — crypto vault, SEP-0005 derivation, the Stellar client, and the scan engine — lives in a framework-agnostic core with no React or Chrome APIs, which is exactly why we could ship Android cheaply. For Android we wrapped the same React app with Capacitor and swapped two seams: storage moves from chrome.storage to Capacitor Preferences, and the service worker becomes an in-process handler — the screens didn't change. It's all TypeScript strict with 63 unit tests, and CI builds a debug APK on every PR.

---

## Slide 6: Impact / Market

- **Everyday self-custody users** who want to hold/send Stellar assets without blind-signing risk
- **Stellar dApp & DeFi users** — payments, anchors, NFTs — needing clear approvals
- **dApp developers** — a wallet + a simple `postMessage` bridge to reach mobile users `[inferred]`
- Stellar is payments- and anchor-native and is adding smart contracts (Soroban) → more ways to sign something you don't understand `[inferred]`

![Placeholder: simple "who it's for" graphic — users, dApp devs, anchors](placeholder-image.png)

**Speaker notes:** Two audiences. First, everyday Stellar users who want real self-custody but are scared of approving the wrong thing — Lantern gives them a plain-language safety net. Second, dApp developers: our bridge is a tiny postMessage contract, so a web app can connect, read balances, and request scanned payments or message signatures with almost no integration work, and reach our Android users. As Stellar adds Soroban smart contracts, the surface for confusing or malicious signatures grows — which is exactly where a signing-time safety layer earns its keep. `[inferred: market framing; sizing not in repo]`

---

## Slide 7: What's next

- **Real AI scan tiers** — today's engine is a deterministic rules mock with a stable contract; next are on-device heuristics + opt-in cloud analysis (repo issue #1, README roadmap)
- **Soroban scanning** — decode contract calls, flag unlimited allowances / unknown authorizers
- **Reputation + phishing/origin checks** — replace the demo deny-list; validate dApp origin vs. the request
- **Standardize the bridge** toward SEP-0043 / Wallet Standard; per-app permissions + curated directory
- **Android hardening** — biometric unlock, Android Keystore, release signing, APK size pass `[inferred from open issues #4/#9 + roadmap]`

**Speaker notes:** We're honest that the risk engine today is rules-based — but the contract and UI are real and stable, so we can drop in the AI tiers without touching the app. Our roadmap, which is written up in the repo's issues and README, is: on-device and opt-in cloud analysis, real Soroban contract scanning for things like unlimited allowances, address-and-asset reputation, and phishing/origin checks. On the platform side we'll standardize the bridge toward Stellar's emerging wallet standards with per-app permissions, and harden Android with biometric unlock and a keystore-backed vault. None of these change the architecture — they slot into the seams we already built.

---

## Slide 8: Team & Thanks

- **<Name> — <Role>** (e.g., product / wallet core) `[placeholder]`
- **<Name> — <Role>** (e.g., Stellar / mobile) `[placeholder]`
- Contact: **<email / handle>** `[placeholder — e.g. hello@artisam.xyz, inferred]`
- Built on: Stellar SDK · Horizon · Friendbot · Capacitor · React/Vite. Thank you!

![Placeholder: team photo or avatars + project QR code / repo link](placeholder-image.png)

**Speaker notes:** That's Lantern — non-custodial self-custody with a safety check at signing time, on extension and Android, plus a permissioned home for Stellar dApps. Huge thanks to the Stellar ecosystem and the open-source tools that made a two-platform build possible in a hackathon timeframe. We'd love feedback, contributors, and design partners among Stellar dApp teams. Scan the code to try the testnet build or read the source — and come say hi. Thank you!
