# Features log

A running, reverse-chronological log of shipped changes. The auto-dev agent
appends an entry here for every change it lands (see `auto-dev.md`).

Format: `- YYYY-MM-DD — <summary> (#PR, closes #issue)`

## Shipped

- 2026-07-02 — Security/deps: **`@stellar/stellar-sdk` 15.1.0 → 16.0.1** to clear the transitive `axios` advisories (bumps `axios` 1.15.x → 1.16.1, above the vulnerable range — prototype-pollution/credential-leak class). `npm audit --omit=dev` now reports 0 production vulnerabilities. Regression pass on the SDK surface (tx builders, Horizon client, session handler, scan decode): typecheck, lint, all 75 unit tests, and the production build pass unchanged — no source changes needed. (The one remaining dev-only `vite` advisory is not shipped and is left out of scope.) (#32, part of #18)
- 2026-07-02 — Scan: **flag signer/threshold changes before signing**. The scanner now decodes `setOptions` (signers, `masterWeight`, low/med/high thresholds) instead of letting it fall through as an unrecognized op, and raises a high-risk `account_control_change` verdict (`block_confirm`) — with a stronger "gives up account control" message when `masterWeight` is set to 0. Previously a signer/threshold change scanned as low-risk `allow`. Pure decode + engine rule, unit-tested; first consumer of the account-control decode groundwork for guardian recovery. (#31, part of #23)
- 2026-07-02 — Native: **live settings propagation**. `onSettingsChanged` was a no-op on native, leaving non-active surfaces stale after e.g. a network toggle; add an in-process subscriber set that `setSettings` fans out to on native (matching the extension's `chrome.storage.onChanged` behavior), unit-tested. (#30, part of #19)
- 2026-07-02 — Mobile: **press-and-hold to confirm high-risk signs**. Replaces the typed-`CONFIRM` gate on native (Send + mini-app Apps approval) with a reusable `HoldToConfirm` button that fills a progress track and fires once — no on-screen keyboard, same "no accidental tap" guarantee. Extension keeps typed-`CONFIRM`. (#29, part of #19)
- 2026-07-02 — UX: **Send recent-recipients shortcut**. Pure `recentRecipients()` derives distinct, newest-first sent-to addresses from decoded tx history (outgoing payments + account creations; ignores incoming/swap/failed/self), unit-tested; Send form shows up to 3 as tappable chips that refill the destination. (#28, part of #19)
- 2026-07-02 — Android launcher icon: replace Capacitor's placeholder with the real **Lantern amber mark** across all mipmap densities (legacy square, circle-masked round, and adaptive foreground) + navy adaptive background. Generated from the same source art as the extension icons (`logo.jpg`) via a new cross-platform `scripts/gen-android-icons.mjs` (`npm run icons:android`, sharp-based) so the two sets can't silently diverge. (#25, closes #20)
- 2026-07-02 — Security: **Android lifecycle auto-lock**. Backgrounding the app (home/app-switcher) previously left the in-memory session unlocked for the full idle window; add a native `@capacitor/app` `pause` listener (gated on `isNativePlatform`, dynamically imported) that locks immediately on background, complementing the idle timer. (#27, part of #18)
- 2026-07-02 — UX: **copy-address confirmation toast**. Copying the wallet address (AppBar) or the demo-flagged address (Scan) was a silent clipboard write; add a minimal app-wide `ToastProvider`/`useToast` (aria-live) showing "Address copied" on success. (#26, part of #19)
- 2026-07-01 — Android fix: mini-app **browser overlay clears the status bar & gesture bar**. `#root`'s `transform` makes it the containing block for the `fixed` overlay, but a transformed ancestor insets against its *padding box* — so `inset-0` overlapped `#root`'s safe-area padding and ran the header under the status bar. Inset the overlay box itself via `env(safe-area-inset-*)`; extension/desktop unaffected (env → 0). (closes #9)
- 2026-06-30 — Mini-app bridge v2: issued (non-native) **asset payments** + read-only **sign-message** auth (`lantern:signMessage` → domain-separated `SIGN_MESSAGE`), with the intent logic extracted to a unit-tested `core/miniapps/bridge.ts`. Mock dApp gains an asset selector + Sign-message panel. (#13)
- 2026-06-30 — Mini-app `signAndSubmit` bridge: a connected dApp sends a payment **intent**; Lantern builds, AI-scans, has the user approve, signs & submits, returns the tx hash. Richer Get Balance mock dApp (send, all assets, Friendbot fund). (#12)
- 2026-06-30 — Read-only wallet **connect bridge** (`lantern:getPublicKey` → approval → public key + network) + deployable Get Balance mock dApp. (#11, closes #10)
- 2026-06-30 — Android layout: fill the device viewport (`100dvh`) + safe-area insets + status-bar overlay so the UI isn't a fixed 360×600 box. (#8, closes #7)
- 2026-06-30 — Android (Capacitor) milestone 1: storage/messaging seams, in-process session handler, mobile build, committed `android/` project, debug-APK CI. (#6)
- 2026-06-24 — Demo: mock mini-app browser launching blockhub.academy + AI scan on send; investor pitch deck and screenshots. (#3, closes #2)

<!-- auto-dev: prepend new entries above this line -->
