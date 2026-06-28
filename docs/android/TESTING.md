# Manually testing the Lantern Android APK

How to install and smoke-test a Lantern debug APK on Android. The Android build
wraps the existing React app with [Capacitor](https://capacitorjs.com/) (see
issue #4); `src/core/**` is reused unchanged, so behaviour matches the extension.

> ⚠️ **Status:** the Capacitor Android project is being scaffolded. Until it lands,
> CI skips the APK build and there is no APK to install yet. The steps below are
> the target workflow and double as the reviewer checklist.

---

## Prerequisites

- **Android device** with Developer options + **USB debugging** enabled, _or_ an
  emulator (Android Studio AVD).
- **`adb`** on your PATH — from Android Studio or the standalone
  [platform-tools](https://developer.android.com/tools/releases/platform-tools).
- Verify the device is visible:
  ```bash
  adb devices        # your device/emulator should be listed as "device"
  ```

## Get an APK

**Option A — from CI (recommended).** Open the **Android APK** workflow run for the
PR/commit and download the **`lantern-debug-apk`** artifact, then unzip it.

**Option B — build locally.**
```bash
npm ci
npm run build:mobile          # plain SPA build (no MV3/crx); falls back to `npm run build`
npx cap sync android          # copy web assets into the Android project
cd android && ./gradlew assembleDebug
# APK at: android/app/build/outputs/apk/debug/app-debug.apk
```

## Install & launch

```bash
adb install -r app-debug.apk  # -r reinstalls while keeping app data
adb shell monkey -p <applicationId> -c android.intent.category.LAUNCHER 1
```
(Replace `<applicationId>` with the id from `capacitor.config.ts`, e.g.
`xyz.artisam.lantern`.) Or just tap the **Lantern** icon in the launcher.

---

## Smoke-test checklist

Maps to the acceptance criteria in issue #4.

**Onboarding & security**
- [ ] First launch shows onboarding; create a new wallet.
- [ ] The recovery phrase is shown **once** and never re-displayed afterwards.
- [ ] Lock the wallet, reopen, and unlock (password / biometric).
- [ ] **Auto-lock** engages after the configured timeout (background the app and wait).

**Wallet basics (Testnet)**
- [ ] Switch to **Testnet**; fund the account via **Friendbot**; the balance appears.
- [ ] **Send** to a normal address → scan passes (“Checked by Lantern”) → submits;
      confirm the tx on a Stellar explorer.

**AI scan gate**
- [ ] Send to the **demo flagged address** → high-risk **block** + type-`CONFIRM`
      friction before signing is possible.

**Mini-app browser** (the priority feature)
- [ ] Open **Apps → BlockHub Academy** (`blockhub.academy`); the dApp loads in a
      sandboxed in-app WebView.
- [ ] **Connect** grants scoped, revocable permissions and returns the public key.
- [ ] A **signature request** from the dApp is routed through the scan engine and
      **shown for confirmation** before any signing.
- [ ] The dApp WebView cannot read wallet storage (no vault access).

**Networks**
- [ ] Testnet vs Mainnet are visually distinct (per BRAND §8).

---

## Debugging

- **Native + Capacitor logs:**
  ```bash
  adb logcat | grep -iE 'lantern|capacitor|chromium'
  ```
- **Inspect the WebView UI live:** open Chrome on desktop → `chrome://inspect/#devices`
  → select the device’s Lantern WebView → full DevTools.
- **Reset state / uninstall:**
  ```bash
  adb uninstall <applicationId>
  ```

## Safety notes for testers

- Only the **encrypted vault** is persisted; secret material is never logged.
- Use **Testnet** accounts. **Never** paste a real mainnet seed into a debug build.

## APK size

Prototype budget: **debug < 15 MB**, **release < 8 MB**. The CI run prints the APK
size and warns if the debug build exceeds budget. The largest lever is the JS
bundle (`@stellar/stellar-sdk`); see issue #4 → “APK size optimization”.
