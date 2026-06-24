# Lantern — Investor Pitch Deck

> **See what you sign.**
>
> A non-custodial Stellar wallet with an **AI safety net** between you and every
> signature — turning opaque transactions into plain-language decisions.

*Pre-seed / Angel · 2026 · Contact: [hello@artisam.xyz](mailto:hello@artisam.xyz)*

---

## 1 · Lantern

🟡 **Lantern** — *See what you sign.*

A non-custodial Stellar wallet with an **AI safety net** between you and every
signature — turning opaque transactions into plain-language decisions.

---

## 2 · The Problem

### Self-custody asks users to sign things they can't read.

- **🔒 Opaque signatures** — Wallets show raw XDR. Users approve trustline changes,
  signer removals, account merges & Soroban calls without knowing the impact.
- **🎣 Scams thrive on confusion** — Phishing dApps, look-alike asset codes, unlimited
  token allowances, and drained reserves — all hidden behind one "Approve".
- **⚖️ No good option** — Custodial = give up your keys. Non-custodial = fly blind.
  Nobody keeps keys on-device *and* explains the risk.

---

## 3 · The Solution

### A wallet that explains every signature — before you make it.

- **Non-custodial by design.** Keys never leave the device — AES-GCM vault,
  PBKDF2 ≥ 600k, decrypted key lives only in worker memory.
- **AI security scans.** Decode any transaction, summarize intent in plain English,
  flag irreversible & high-risk actions before signing.
- **In-wallet mini-app browser.** Run Stellar dApps in a sandboxed, permissioned
  container — every request routed through the scanner.

> *"A second pair of eyes at signing time."* Lantern never takes custody and never
> blocks you — it just makes sure you understand what you're authorizing.

---

## 4 · Product Spotlight — AI Security Scanner

**Opaque XDR in → an informed decision out.**

#### Example review (what the user sees)

> ⚠️ **High-impact transaction** — 3 operations · 2 warnings
>
> | Operation | Flag |
> |---|---|
> | 💸 **Payment · 1,500 XLM** | To `GDRP…X7QF` — destination never seen before |
> | 🔑 **Remove signer** | ⚠ Irreversible — lowers account control |
> | ♾️ **Unlimited token allowance** | ⚠ Contract could move this asset without limit |
>
> `[ Reject ]` &nbsp; `[ Approve ]`

#### Capabilities

- **🧠 Transaction intent analysis** — Decodes payments, trustlines, offers, merges
  & `setOptions` into human terms.
- **📜 Soroban contract scanning** — Inspects called contracts, args & auth entries;
  flags unlimited allowances & unknown authorizers.
- **🛡️ Address reputation** — Scam lists & homoglyph detection.
- **🌐 Origin checks** — Catches spoofed dApp prompts.

`On-device first` · `Opt-in cloud AI` · `Never sees secret keys`

---

## 5 · Product Spotlight — Mini-App Browser for Stellar dApps

**A trusted, permissioned home for the Stellar ecosystem** — identity & signing
context travel with the user.

#### Curated directory

`StellarX ✓` · `Aquarius ✓` · `Anchor ✓` · `Litemint ✓` · `Soroswap ✓` · `+ Browse`

Example per-app permissions (Soroswap): `Mainnet` · `1 account` · `≤ 250 XLM`

#### How it works

- **📦 Sandboxed runtime** — dApps load in an isolated frame with zero access to the
  vault; all chain calls go through a brokered, capability-scoped API.
- **🎛️ Per-app permissions** — Scoped & revocable: which network, which accounts,
  spend limits & allowed operations — reviewable in one place.
- **🔗 Every request runs through the scanner:**

  ```
  dApp  →  Broker  →  AI Scan  →  Sign
  ```

Aligned with **SEP-0043 / Wallet Standard** & **Soroban RPC** — existing dApps
integrate with minimal changes.

---

## 6 · Why Now

### Stellar is scaling into smart contracts — and risk is scaling with it.

| | |
|---|---|
| **Soroban** | Smart contracts are live on mainnet — far more ways for users to sign something they don't understand. |
| **$Bns** | Lost annually to wallet phishing & malicious approvals across crypto — the #1 attack surface is the signature. |
| **SEP-0043** | Emerging wallet standards make a safety-first, interoperable wallet the natural integration point for dApps. |

> Wallets compete on UX today. The next wave competes on **trust**.
> Lantern is built for it from day one.

---

## 7 · Where We Are · How We Win

### A shipping wallet today, a trust layer tomorrow.

**Built & working**

- MV3 Chrome extension — create / import, send, balances, history
- Encrypted on-device vault, SEP-0005 HD wallet, Testnet / Mainnet
- Scan engine + messaging architecture scaffolded for AI review

**Business model**

- **Free wallet** — grow the trusted install base.
- **Premium scans** — advanced cloud AI analysis for power users & teams.
- **Ecosystem** — verified dApp directory listings & a B2B safety API for anchors / dApps.

---

## 8 · Team

### Founder — Mark Hugh Neri

- **15+ years** in software development — specialized in **Blockchain & AI**.
- **CTO / Co-founder, The Blocklabs Inc** — pioneering blockchain education in the
  Philippines since 2017.
- **Multiple global & local hackathon winner.**

---

## 9 · The Ask

### Raising a pre-seed / angel round.

Funding the path from working wallet to a live AI safety layer & mini-app browser.

| Use of funds | Allocation |
|---|---|
| 🧠 Ship the AI security scanner | **40%** |
| 📦 Mini-app browser & dApp directory | **30%** |
| 🛡️ Security audits & mainnet hardening | **20%** |
| 📣 Growth & ecosystem partnerships | **10%** |

> **Light up Stellar safely.** Join us in building the trust layer for self-custody.

**Contact:** [hello@artisam.xyz](mailto:hello@artisam.xyz)
