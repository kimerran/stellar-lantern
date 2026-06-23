# AGENT.md — Coding Agent Guide for Lantern

This document tells an AI coding agent (or a new human contributor) **how to build and work on** the Lantern Stellar wallet extension. Read `SPEC.md` for *what* to build and `BRAND.md` for *how it should look*. This file is the *how to work* contract.

---

## 1. Prime Directives

1. **Never log, persist, or transmit secret material** — mnemonics, seeds, private keys. This rule overrides convenience. If you need to debug, log the public key (`G...`) only.
2. **TypeScript strict mode, always.** No `any` that isn't justified with a comment. No `// @ts-ignore` without an explanation.
3. **Follow `SPEC.md` scope.** Do not add swaps, multi-account, dApp signing, or other backlog items unless explicitly asked. Ship the MVP.
4. **Match `BRAND.md` exactly** for colors, typography, spacing, and component patterns. The mocked HTML is the source of truth for layout.
5. **Ask before inventing.** If a spec decision is missing (see SPEC §13), surface it rather than guessing in a way that's hard to reverse.

---

## 2. Tech Stack (pin these)

| Concern | Tool |
|---|---|
| Language | TypeScript (`strict: true`) |
| UI | React 18 |
| Styling | Tailwind CSS (config = `BRAND.md` tokens) |
| Bundler | Vite + `@crxjs/vite-plugin` (MV3) |
| Stellar | `@stellar/stellar-sdk` |
| Mnemonic | `bip39` + SEP-0005 HD derivation (`stellar-hd-wallet`) |
| Crypto | Web Crypto (`crypto.subtle`) — no custom crypto |
| Unit tests | Vitest |
| E2E (optional) | Playwright |
| Lint/format | ESLint + Prettier |

Pin exact versions in `package.json`. Prefer the latest stable `@stellar/stellar-sdk`; verify its API surface against its current docs before coding (the SDK has had breaking changes across majors).

---

## 3. Repository Structure

```
lantern/
├─ src/
│  ├─ popup/                 # React UI (entry for the popup)
│  │  ├─ screens/            # Onboarding, Unlock, Assets, Send, Activity
│  │  ├─ components/         # AppBar, BottomNav, Card, AmountText, etc.
│  │  └─ main.tsx
│  ├─ background/            # MV3 service worker: session, signing, auto-lock
│  │  └─ index.ts
│  ├─ core/                  # Framework-agnostic logic (unit-testable)
│  │  ├─ crypto/             # encrypt/decrypt vault (Web Crypto)
│  │  ├─ wallet/             # create/import, SEP-0005 derivation
│  │  ├─ stellar/            # Horizon client (network-aware), tx builders
│  │  └─ history/            # operation → display-model mapping
│  ├─ shared/               # types, messaging contract, constants
│  └─ styles/               # tailwind.css + token config
├─ public/
│  └─ manifest.json         # MV3 manifest
├─ tests/
├─ SPEC.md
├─ AGENT.md
├─ BRAND.md
├─ package.json
├─ tsconfig.json
├─ tailwind.config.ts
└─ vite.config.ts
```

Keep **`core/` free of React and Chrome APIs** so it is pure and testable. The popup and background import from `core/`.

---

## 4. Commands

Define these scripts (names matter — the agent should rely on them):

```bash
npm install            # install deps
npm run dev            # Vite dev build, watch mode, loadable unpacked
npm run build          # production build → dist/
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run test           # vitest run
npm run test:watch     # vitest
```

To load in Chrome: `chrome://extensions` → Developer mode → Load unpacked → `dist/`.

---

## 5. Architecture Rules

- **Secrets live in the background worker only.** The popup sends a message like `{ type: "UNLOCK", password }`; the worker decrypts, holds the `Keypair` in memory, and answers signing requests. The popup must never hold the decrypted secret in React state.
- **Messaging contract** lives in `src/shared/messages.ts` as a discriminated union. All cross-context calls go through it; no ad-hoc message shapes.
- **Network awareness**: a single `getStellarClient(network)` factory returns a Horizon `Server` + network passphrase. Never hardcode a Horizon URL at a call site; read from settings.
- **MV3 worker is ephemeral.** Assume it can be killed anytime. On any signing request, if there's no unlocked session, return a `LOCKED` result so the UI prompts for the password — do not crash.
- **No remote code.** Everything bundled. Strict CSP in the manifest.

---

## 6. Crypto Implementation Notes

- Use `crypto.subtle.deriveKey` with PBKDF2 (≥ 600k iterations, SHA-256) **or** scrypt to turn the password into an AES-GCM key.
- Random `salt` (16 bytes) and `iv` (12 bytes) per encryption, via `crypto.getRandomValues`.
- Encrypt the **mnemonic** (or raw seed for `S...` imports). Store the cipher per the `StoredVault` shape in `SPEC.md §7`.
- Decrypt only in the worker, only on unlock. Zero the plaintext references after use where practical.
- Do **not** roll your own KDF, cipher, or base64; use platform primitives.

---

## 7. Stellar Implementation Notes

- **Derivation**: SEP-0005, path `m/44'/148'/0'` for account 0.
- **Validation**: use `StrKey.isValidEd25519PublicKey` / `...SecretSeed`; `bip39.validateMnemonic` for phrases.
- **Sending**:
  - If destination account is missing and asset is XLM → `Operation.createAccount`.
  - Otherwise → `Operation.payment`.
  - Fee: query `server.fetchBaseFee()` (or use `BASE_FEE`) and cap sensibly.
  - Memo: `Memo.text(...)` when provided (≤ 28 bytes).
  - Set a reasonable `timebounds`.
- **MAX** for XLM = balance − (base reserve × entries) − fee buffer. Never let the user strand the account below reserve.
- **History**: page operations with `.call()` + `.next()` cursors. Map each operation to a display model `{ direction, title, counterparty, amount, asset, time, hash }`. Classify direction by comparing source/destination to the wallet address.
- **Unfunded accounts** throw `NotFoundError` from Horizon — catch and render the unfunded state, don't surface a raw 404.

---

## 8. Coding Conventions

- Functional React components + hooks. No class components.
- Co-locate a component's styles via Tailwind classes that map to `BRAND.md` tokens; do not introduce arbitrary hex values — extend the Tailwind theme instead.
- Pure functions in `core/` return values or typed `Result`-style errors; UI decides how to render errors.
- Name things by domain (`buildPaymentTx`, `decryptVault`) not by layer (`util1`).
- Every exported `core/` function has a Vitest test for at least the happy path + one failure path.
- User-facing error strings are human-readable; never display raw exception objects.

---

## 9. Testing Expectations

Minimum for MVP:
- `core/crypto`: encrypt → decrypt round-trips; wrong password fails cleanly.
- `core/wallet`: known mnemonic derives the known address (use a public SEP-0005 test vector).
- `core/stellar`: tx builder chooses createAccount vs payment correctly; MAX math respects reserve.
- `core/history`: direction classification (sent/received) for sample operations.

Mock Horizon in unit tests; do not hit the live network in CI. A small set of manual/Playwright checks against **Testnet** is acceptable for E2E.

---

## 10. Definition of Done (per task)

A change is done when:
1. `npm run typecheck`, `npm run lint`, and `npm run test` all pass.
2. It matches `SPEC.md` behavior and `BRAND.md` appearance.
3. No secret is logged or persisted in plaintext (grep the diff for key/seed/mnemonic logging).
4. New `core/` logic has tests.
5. It loads and works as an unpacked extension on both Testnet and Mainnet toggles.

---

## 11. Common Pitfalls (avoid these)

- Holding the decrypted key in popup/React state → leaks via devtools. Keep it in the worker.
- Hardcoding a Horizon URL → breaks the network toggle.
- Forgetting MV3 workers die → "works once, then signing fails." Always handle the LOCKED path.
- Using `Number` for amounts → precision loss. Use string/`BigNumber`-style handling for 7-decimal Stellar amounts.
- Assuming the destination exists → payment fails; check and branch to createAccount.
- Logging the full error object that may embed the signed XDR or memo → scrub before logging.
- Introducing raw hex colors instead of theme tokens → drifts from `BRAND.md`.

---

## 12. Where to Look

- **What to build / acceptance criteria** → `SPEC.md`
- **Colors, type, spacing, components** → `BRAND.md` (+ the mocked HTML it's derived from)
- **Stellar SDK** → verify against the current official `@stellar/stellar-sdk` docs before relying on memory.
