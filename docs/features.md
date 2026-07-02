# Features log

A running, reverse-chronological log of shipped changes. The auto-dev agent
appends an entry here for every change it lands (see `auto-dev.md`).

Format: `- YYYY-MM-DD — <summary> (#PR, closes #issue)`

## Shipped

- 2026-07-02 — Android launcher icon: replace Capacitor's placeholder with the real **Lantern amber mark** across all mipmap densities (legacy square, circle-masked round, and adaptive foreground) + navy adaptive background. Generated from the same source art as the extension icons (`logo.jpg`) via a new cross-platform `scripts/gen-android-icons.mjs` (`npm run icons:android`, sharp-based) so the two sets can't silently diverge. (#25, closes #20)
- 2026-07-01 — Android fix: mini-app **browser overlay clears the status bar & gesture bar**. `#root`'s `transform` makes it the containing block for the `fixed` overlay, but a transformed ancestor insets against its *padding box* — so `inset-0` overlapped `#root`'s safe-area padding and ran the header under the status bar. Inset the overlay box itself via `env(safe-area-inset-*)`; extension/desktop unaffected (env → 0). (closes #9)
- 2026-06-30 — Mini-app bridge v2: issued (non-native) **asset payments** + read-only **sign-message** auth (`lantern:signMessage` → domain-separated `SIGN_MESSAGE`), with the intent logic extracted to a unit-tested `core/miniapps/bridge.ts`. Mock dApp gains an asset selector + Sign-message panel. (#13)
- 2026-06-30 — Mini-app `signAndSubmit` bridge: a connected dApp sends a payment **intent**; Lantern builds, AI-scans, has the user approve, signs & submits, returns the tx hash. Richer Get Balance mock dApp (send, all assets, Friendbot fund). (#12)
- 2026-06-30 — Read-only wallet **connect bridge** (`lantern:getPublicKey` → approval → public key + network) + deployable Get Balance mock dApp. (#11, closes #10)
- 2026-06-30 — Android layout: fill the device viewport (`100dvh`) + safe-area insets + status-bar overlay so the UI isn't a fixed 360×600 box. (#8, closes #7)
- 2026-06-30 — Android (Capacitor) milestone 1: storage/messaging seams, in-process session handler, mobile build, committed `android/` project, debug-APK CI. (#6)
- 2026-06-24 — Demo: mock mini-app browser launching blockhub.academy + AI scan on send; investor pitch deck and screenshots. (#3, closes #2)

<!-- auto-dev: prepend new entries above this line -->
