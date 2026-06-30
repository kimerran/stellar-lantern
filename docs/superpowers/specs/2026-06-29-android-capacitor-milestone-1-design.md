# Android (Capacitor) — Milestone 1 Design

**Date:** 2026-06-29
**Issue:** [#4 — Android version, fastest working prototype](https://github.com/kimerran/stellar-lantern/issues/4)
**Scope:** Milestone 1 of 4 (Capacitor shell + storage seam + CI APK). Milestones 2–4 (wallet-on-device hardening, mini-app browser, size pass) are out of scope here.

## Goal

Produce a debug APK that boots the existing onboarding / unlock / assets UI on an Android emulator or device, with the extension-specific seams (storage, messaging) swapped for mobile-compatible adapters so that create / import / unlock work in-process. CI builds and uploads `app-debug.apk` on every relevant PR.

## Non-Goals (deferred to later milestones)

- Biometric / PIN unlock and auto-lock driven by the Android app lifecycle (resume/background). **→ Milestone 2.**
- Mini-app browser on Android (sandboxed dApp WebView, postMessage broker, scanned signing). **→ Milestone 3.**
- APK size optimization (R8/shrink, ABI splits, SDK trimming, size gate). **→ Milestone 4.**
- Release/signed APK or AAB, Play Store, Android Keystore-backed storage, iOS.

## Constraints & Decisions (confirmed)

1. **Build coexistence:** add a *parallel* mobile build. The existing `@crxjs/vite-plugin` extension build stays untouched. A second Vite config emits a plain web bundle for Capacitor.
2. **Session scope:** storage seam + boot only. The keypair will live in app-process memory on mobile via the *existing* handler logic (that is what makes unlock work), but mobile-lifecycle hardening (biometric/PIN, resume/background auto-lock) is Milestone 2.
3. **CI depth:** full APK build — CI compiles `app-debug.apk` via Gradle and uploads it as an artifact. This requires the generated `android/` Gradle project to be committed.
4. **Commit `android/`:** yes — the generated Capacitor Android project is committed so CI (and contributors without local `cap add`) can build.
5. **Messaging seam via dynamic import:** on native, `sendMessage` dynamically imports the in-process handler, keeping wallet logic out of the extension popup bundle.

## Current Architecture (relevant seams)

- `src/popup/**` — React UI. Talks to the background worker exclusively via `sendMessage` in `src/shared/messages.ts` (`chrome.runtime.sendMessage`).
- `src/background/index.ts` — MV3 service worker. Holds the in-memory unlocked `Keypair`, implements `handle(req)` for the full message contract (status, create, import, unlock, lock, ping, sign+submit, reset), arms a timer-based auto-lock, and registers `chrome.runtime` listeners.
- `src/shared/storage.ts` — thin typed wrapper over `chrome.storage.local` (vault + settings).
- `src/core/**` — framework-agnostic crypto/wallet/stellar/scan/miniapps. **Untouched** by this milestone.
- Root `index.html` already loads `/src/popup/main.tsx` and is a clean web entry.

## Design

### Seam 1 — Storage (key-value port)

Introduce `src/shared/kv.ts`:

- A `KV` interface: `get(key): Promise<string | null>`, `set(key, value): Promise<void>`, `remove(key): Promise<void>`.
- Runtime platform detection (native vs extension).
- Extension implementation → `chrome.storage.local`.
- Native implementation → `@capacitor/preferences` (`Preferences.get/set/remove`).

Refactor `src/shared/storage.ts` to keep its **exact public API** (`getVault`, `setVault`, `clearVault`, `getSettings`, `setSettings`, `onSettingsChanged`) but route reads/writes through `kv`. Values are JSON-serialized (Preferences stores strings; `chrome.storage.local` already stored objects, so the wrapper serializes consistently on both paths).

`onSettingsChanged` becomes a no-op unsubscribe on native (single process; the UI re-reads settings on demand). The extension path keeps `chrome.storage.onChanged`.

### Seam 2 — Messaging (in-process handler)

Extract the service worker's logic into a framework-agnostic module `src/core/session/handler.ts`:

- Holds the in-memory `UnlockedSession`, `lock()`, `armAutoLock()`, and the `handle(req): Promise<Result<unknown>>` switch — moved verbatim from `src/background/index.ts`, plus the error-mapping helpers (`toErrorResult`, Horizon humanizers).
- Depends only on `@core/*` and `@shared/storage` (which is now platform-agnostic via `kv`). No `chrome.*` references.

`src/background/index.ts` shrinks to: import `handle`/`lock` from the handler and register the `chrome.runtime.onMessage` / `onStartup` / `onInstalled` listeners exactly as before. Extension behavior is unchanged.

`sendMessage` in `src/shared/messages.ts` branches on platform:

```ts
export async function sendMessage(req) {
  if (isNative()) {
    const { handle } = await import('@core/session/handler');
    return handle(req);
  }
  return chrome.runtime.sendMessage(req);
}
```

The dynamic import means the handler (and the wallet logic it pulls in) is split into a chunk that the extension popup bundle never loads, preserving the extension's existing separation of concerns.

### Seam 3 — Build (`vite.config.mobile.ts`)

A second Vite config that mirrors the existing one minus the extension wiring:

- Plugins: `react()` + `nodePolyfills({ globals: { Buffer, global, process } })`. **No `crx()`**, no `manifest`.
- Same `@core` / `@shared` / `@popup` resolve aliases.
- Entry: the existing root `index.html`.
- `build.outDir: 'dist'`, `target: 'esnext'`. Source maps left on for the debug build (size pass is M4).

New `package.json` scripts:

- `build:mobile` → `tsc --noEmit && vite build --config vite.config.mobile.ts`
- `cap:sync` → `npx cap sync android`

### Capacitor layer

- Dev/runtime deps: `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/preferences`.
- `capacitor.config.ts`: `appId: 'com.lantern.wallet'`, `appName: 'Lantern'`, `webDir: 'dist'`. (`appId` and min/target SDK are open questions in the issue; these are sensible defaults and easy to change later.)
- Generate and **commit** the `android/` Gradle project (`npx cap add android`). Default Capacitor `minSdkVersion` (currently 23) is accepted for the prototype and documented.

### CI — `.github/workflows/android.yml`

- **Triggers:** `workflow_dispatch` and `pull_request` paths touching `src/**`, `android/**`, `capacitor.config.ts`, `vite.config.mobile.ts`, `package*.json`, and the workflow file itself.
- **Steps:**
  1. checkout
  2. setup Node (LTS) with npm cache
  3. `npm ci`
  4. `npm run build:mobile`
  5. setup JDK 17
  6. setup Android SDK + Gradle cache
  7. `npx cap sync android`
  8. `cd android && ./gradlew assembleDebug`
  9. upload `android/app/build/outputs/apk/debug/app-debug.apk` as a workflow artifact
- **Acceptance:** the workflow is green and produces a downloadable debug APK artifact.

## Verification

- `npm run build` (extension target) still succeeds — proves the existing target is intact.
- `npm run build:mobile` produces `dist/index.html` and assets.
- `npm test` (vitest) still passes — `src/core/**` is untouched; the handler extraction is a move, not a rewrite.
- CI `assembleDebug` produces `app-debug.apk`. (Local Gradle build optional, depending on whether the Android SDK is installed locally.)
- Manual smoke (best-effort, full checklist is M2's TESTING.md): install the APK, app launches to onboarding, create wallet, lock → unlock.

## Risks & Mitigations

- **Generated `android/` churn / size:** committing native scaffolding adds many files. Accepted per decision; keeps CI buildable. `.gitignore` excludes Gradle build outputs.
- **Handler extraction regressions:** the extension path must behave identically. Mitigation: move code verbatim, keep `background/index.ts` listeners unchanged, rely on the existing test suite + extension build.
- **`chrome` undefined on native:** storage and messaging seams must guard all `chrome.*` access behind platform detection; native paths must never reference `chrome`.
- **WebCrypto availability:** the vault uses WebCrypto (AES-GCM/PBKDF2), available in the Android System WebView — no change needed.

## Open Questions (tracked, not blocking M1)

- Final `appId` and app display name.
- Min / target Android SDK for the demo (default 23 assumed).
- Secure-storage depth (WebCrypto-encrypted Preferences now vs Android Keystore-backed) — revisited in M2.
