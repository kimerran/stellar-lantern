# Homepage Screens — capture guide

**What this is.** Instructions for re-shooting the six phone screenshots in the homepage's
*Screens* section (`golantern.xyz/#screens`, #133). The current images were taken on
2026-07-13, before the scanner went into the wallet. They show the old warning box, and
none of them shows what the homepage now leads with: **Checked by Lantern**, a flagged
recipient, or the one-click report. Take these on the released **0.2.0** Android build.
The dev team swaps them in and updates the captions.

| | |
|---|---|
| Build | `lantern-0.2.0-testnet.apk` from `golantern.xyz` → **Android APK** (check it against `/download/checksums`) |
| Network | **Testnet only.** Use a demo wallet, never your own |
| Time | ~20 minutes |
| Return | The six PNGs, named as below, to the dev team |

---

## Before you start

1. Install the 0.2.0 APK on a phone with a clean status bar: no notification icons, battery
   reasonably full, and the clock at a tidy time if you can.
2. **Create a new wallet** (don't import a personal one). Fund it on the Home screen with
   **Friendbot** so the balance reads ~10,000 XLM.
3. Settings → **Auto-lock** → **15 min**, so the wallet doesn't lock mid-shoot.
4. Take screenshots with the phone's own screenshot shortcut, **not a camera**, in
   portrait, at the phone's native resolution (the current set is 1200×2670 PNG).
5. The **TESTNET** badge must be visible in every shot.

Two addresses you'll need:

| Use | Address | Why |
|---|---|---|
| **Clean recipient** | `GAHL7VD3SMQ5C6INLM7TGHORG4YCCPOE2N27B63WLDNY2S7NB2BTSDNX` | Funded, not on the registry. Reviews read clean |
| **Flagged recipient** | `GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ` | On the testnet registry (reported as Scam, 4 reports) |

> **Do not sign anything to the flagged address, and do not submit a report.** A report
> costs 1 XLM and adds to that address's public count. Every shot below is taken **before**
> signing or submitting. Back out with **Edit**, **Cancel** or the back arrow.

---

## The six shots

| # | File name | Screen | How to get there | Must be visible | ☐ |
|---|---|---|---|---|---|
| 1 | `screens-home.png` | Home | Open the app after funding | Balance, **Send / Receive / Swap / Earn**, the asset list, **TESTNET** | ☐ |
| 2 | `screens-review-clean.png` | Send review, clean | Home → **Send** → paste the **clean** address → `25` XLM → continue to **Review Transaction** | The green **Checked by Lantern** badge with its latency (e.g. "2046 ms"), the plain-language sentence, and **Confirm & Send** | ☐ |
| 3 | `screens-review-flagged.png` | Send review, flagged | Back → Edit the recipient to the **flagged** address → Review | **High risk — action needed**, the red box naming the registry reason, reporter and report count, and **Hold to Sign Anyway** at the bottom. If the button is under the bottom bar, scroll until it's fully visible | ☐ |
| 4 | `screens-report.png` | Report sheet | On the flagged review, tap **Report it too** | The sheet with the address, the reason list, the note field and **Report fee 1 XLM**. Tap **Cancel** straight after | ☐ |
| 5 | `screens-earn-review.png` | Earn supply review | Home → **Earn** → a pool → **Supply** → `100` XLM → continue to the review | The scanner's callout reading back the contract call, and the Action / Pool / Asset rows. Back out without confirming | ☐ |
| 6 | `screens-apps.png` | Discover apps | Bottom bar → **Apps** | The mini-app list. If a dApp's connect prompt is easy to reach, add it as `screens-connect.png` (optional) | ☐ |

> If shot 2 shows **"Couldn't check the recipient"** instead of the green badge, the registry
> read failed. It's a known intermittent issue (#149). Go back and open the review again.
> Don't use a shot with that message.

> Wording in the grey sentence under the badge comes from the AI explainer and can vary
> between runs. Any version is fine unless it says the transaction is **"blocked"**. If it
> does, retake it (#150).

---

## Checklist before sending

| | |
|---|---|
| All six named as above, PNG, portrait, native resolution | ☐ |
| **TESTNET** visible in each | ☐ |
| No personal wallet, seed phrase, password or notification in any shot | ☐ |
| Shot 2 shows **Checked by Lantern**, not "Couldn't check the recipient" | ☐ |
| Nothing was signed to the flagged address, and no report was submitted | ☐ |

Captured by: ______ Date: ______ Device / Android version: ______

---

## For the dev team (after the images come back)

- Replace `homepage/screenshots/1185–1190.png` with the new files, and update each
  `<img src>`, `alt` and `<figcaption>` in `homepage/index.html` (`#screens`).
- The section's lead line ("balances, sandboxed dApps, live yield, and guardian-grade
  settings") should mention the scan and the report once the new shots are in.
- Check the section at phone width, then tick the last box on #133.
