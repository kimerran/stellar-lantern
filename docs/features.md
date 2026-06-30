# Features log

A running, reverse-chronological log of shipped changes. The auto-dev agent
appends an entry here for every change it lands (see `auto-dev.md`).

Format: `- YYYY-MM-DD — <summary> (#PR, closes #issue)`

## Shipped

- 2026-06-30 — Mini-app `signAndSubmit` bridge: a connected dApp sends a payment **intent**; Lantern builds, AI-scans, has the user approve, signs & submits, returns the tx hash. Richer Get Balance mock dApp (send, all assets, Friendbot fund). (#12)
- 2026-06-30 — Read-only wallet **connect bridge** (`lantern:getPublicKey` → approval → public key + network) + deployable Get Balance mock dApp. (#11, closes #10)
- 2026-06-30 — Android layout: fill the device viewport (`100dvh`) + safe-area insets + status-bar overlay so the UI isn't a fixed 360×600 box. (#8, closes #7)
- 2026-06-30 — Android (Capacitor) milestone 1: storage/messaging seams, in-process session handler, mobile build, committed `android/` project, debug-APK CI. (#6)
- 2026-06-24 — Demo: mock mini-app browser launching blockhub.academy + AI scan on send; investor pitch deck and screenshots. (#3, closes #2)

<!-- auto-dev: prepend new entries above this line -->
