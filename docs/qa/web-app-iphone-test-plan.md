# Web app on iPhone: manual test plan

**The Lantern web app at `app.golantern.xyz`, run on a real iPhone.** Epic #236 · slices #237 (browser build), #238 (safety for a hosted wallet), #239 (homepage, attribution, this plan).
Written to be run by someone **outside the Lantern team**, on their own iPhone, from the public homepage alone. No repository, no terminal, no App Store, no TestFlight.

This plan follows the structure of [`d4-playground-test-plan.md`](d4-playground-test-plan.md) and [`d3-wallet-integration-test-plan.md`](d3-wallet-integration-test-plan.md). D3 tested the wallet as a Chrome extension and an Android app. This plan tests **the same wallet as a web app on iPhone**, plus what the web app adds for a browser-stored wallet: the Home Screen step, persistent storage, backup before funding, the testnet banner, and locking when the app is hidden.

## 0. What you are testing

Lantern is a Stellar **testnet** wallet. On iPhone it has no App Store app. Instead you open a web page, add it to your Home Screen, and use it like an app. Before you sign anything, it shows a **review screen**: what the transaction does, whether the recipient is on the on-chain scam registry, a risk level and a plain-language sentence. On high risk you must type `CONFIRM` before it will sign.

The wallet lives **in the browser's storage on your phone**, encrypted with your password. Nothing about it is sent to Lantern. That is why the Home Screen step matters: Safari deletes a website's saved data after 7 days without a visit, and Home Screen apps are exempt.

Four things matter more than any single case:

1. **The flagged recipient must be caught, every time.** A send to the reported address in the Reference values must read **High risk**, name the address as reported in the registry, and refuse to sign until you type `CONFIRM`.
2. **No wallet before the backup.** The app must not create a wallet, or show a Receive address, until you have confirmed the recovery phrase.
3. **The vault survives.** Closing the app and coming back a day later must bring back the same wallet behind the unlock screen, not the welcome screen.
4. **Nothing moves real money, and nothing asks for a key it should not.** The app only ever asks for your own password and, during import, your own phrase. If any other page or step asks for a secret key or recovery phrase, stop and file a blocker.

**How to run it:** start cold, with no help from the team. If you get stuck, that is a finding: write down where and why, then carry on. **Screenshot every result you record** (side button + volume up). The screenshots are part of the evidence.

### Reference values

| | |
|---|---|
| Homepage | `https://golantern.xyz` |
| Web app | `https://app.golantern.xyz` |
| Reported address (live `Active` entry, reason `Scam`) | `GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ` |
| An ordinary, unreported address | `GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57` |
| A fresh address to report (§8) | Make one at `https://lab.stellar.org` → *Create keypair*. Copy the **public key** (starts with `G`) only, and throw the secret away |
| Registry contract (testnet) | `CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F` |
| Explorer | `https://stellar.expert/explorer/testnet` |
| Testnet banner text | *"Testnet web app — not for real funds."* |

Keep the two addresses somewhere you can copy them from on the iPhone (Notes, or a message to yourself). The web app has **no QR scanner on iPhone**, so you paste recipients.

### Before you run it

| Prerequisite | If it isn't there |
|---|---|
| `app.golantern.xyz` is live (an ops step: hosting and DNS) | Stop. Nothing in this plan can run |
| The homepage shows **"Open the web app"** on iPhone | Open `https://app.golantern.xyz/?src=homepage-ios` directly, mark 2.1–2.3 **blocked**, and carry on from 2.4 |
| The registry entry for the reported address is still `Active` (testnet resets now and then) | Tell the team before §7. A reset is not your mistake |

## 1. Device and build

| # | Step | Expected |
|---|---|---|
| 1.1 | Record the iPhone model and iOS version (Settings → General → About) | Recorded in §13. Any iOS from 16.4 on is in scope |
| 1.2 | Make sure no earlier Lantern is on the Home Screen. If one is, delete it (press and hold → *Remove App* → *Delete*) | No Lantern icon on the Home Screen |
| 1.3 | Safari → Settings → *Advanced* and *Privacy & Security*: leave everything at its defaults. Don't use a Private tab | Recorded: defaults. (Private tabs throw away storage, which is a different test) |

## 2. Open it from the homepage

**Run 2.1–2.3 by hand, cold, without instructions.** The point is that an iPhone visitor finds the web app on their own.

| # | Step | Expected |
|---|---|---|
| 2.1 | In Safari on the iPhone, open `https://golantern.xyz` | Where Android shows the APK button, the iPhone shows **"Open the web app"**, with a two-line hint about adding it to the Home Screen. No APK download is offered as the main action |
| 2.2 | Tap **Open the web app** | `app.golantern.xyz` opens in Safari. The address bar shows `?src=homepage-ios` at the end of the URL |
| 2.3 | Write down how long it took and anything that confused you | Recorded |
| 2.4 | Look at the top of the page | The yellow banner *"Testnet web app — not for real funds."* is there |
| 2.5 | Read the first screen | **Add Lantern to your Home Screen**, with the reason *"So your wallet isn't erased after 7 days"* and three steps: Share → Add to Home Screen → open Lantern from the Home Screen. It does **not** start wallet creation in the tab |

## 3. Add to Home Screen

| # | Step | Expected |
|---|---|---|
| 3.1 | Follow the three steps on screen: **Share** → **Add to Home Screen** → **Add** | The proposed name is **Lantern** and the icon is the Lantern logo, not a screenshot of the page |
| 3.2 | Go to the Home Screen | A Lantern icon, sharp and full-bleed (no white border, no letter tile) |
| 3.3 | Open Lantern from the Home Screen | It opens **full screen**, with no Safari address bar or toolbar. The testnet banner is at the top. The Home Screen step is **not** shown again: it goes straight to the welcome screen (*Create New Wallet* / *Import Wallet*) |
| 3.4 | Look at the edges | Nothing sits under the notch / Dynamic Island or the home indicator. Nothing runs off the right edge, and there is no sideways scrolling |
| 3.5 | Open the app switcher (swipe up and hold) | Lantern shows as its own app, separate from Safari |

## 4. Create a wallet, then back it up

Do all of §4 **in the Home Screen app**. Have pen and paper ready.

| # | Step | Expected |
|---|---|---|
| 4.1 | **Create New Wallet** | *Your Recovery Phrase*: 12 words, and a warning never to share them. **Write them down in order** |
| 4.2 | **Continue** | *Confirm Your Phrase* asks for two words by number (**Word #3** and **Word #8**) |
| 4.3 | Type a wrong word in one of the two boxes | You can't go on. *Continue* stays disabled |
| 4.4 | **Hard blocker.** With the words still unconfirmed, close the app from the app switcher and reopen it from the Home Screen | It's back at the welcome screen. **No wallet exists**, and there is no address or Receive screen anywhere. (Creating a wallet before the backup is confirmed is a blocker) |
| 4.5 | **Create New Wallet** again. A **new** set of 12 words appears: write those down, and cross out the old ones. Type Word #3 and Word #8 correctly, in capitals and with an extra space | Accepted (case and spacing don't matter). *Continue* is enabled |
| 4.6 | Set a password (twice) and finish | The home screen, with an address starting `G…` and a zero balance. The account is not funded yet |
| 4.7 | If an analytics prompt appears, read it | Analytics are **off unless you turn them on**. Record what it says and what you chose. If no prompt appears, write *not shown* |
| 4.8 | Check your written phrase against the address later, in §10.4 | (No action now) |

## 5. Settings: storage, network and what's turned off

| # | Step | Expected |
|---|---|---|
| 5.1 | Settings (gear) → **Version** | A version string. **Record it** in §13: it identifies the build you tested |
| 5.2 | Settings → **Storage** | Either **Kept on this device**, or **This browser may erase your wallet** with a reminder and an **Ask the browser again** link. Record which one. Either is acceptable for the Home Screen app, as long as it says one of the two |
| 5.3 | If 5.2 showed the reminder: tap **Ask the browser again** | The line updates (it may stay the same: iOS decides). No error, nothing frozen. Record the result |
| 5.4 | Settings → **Network** | Reads **Testnet only**. There is no Mainnet choice and no custom endpoint setting |
| 5.5 | Home and Settings | No *Cash in* or *Cash out*. (They link to other sites, which the web app doesn't allow) |
| 5.6 | **Apps** tab | Only Lantern's bundled mini-apps. There is no URL bar for opening other sites |
| 5.7 | Every screen you visited | The testnet banner is on all of them |

## 6. Receive testnet XLM

| # | Step | Expected |
|---|---|---|
| 6.1 | Home → **Receive** | Your full `G…` address and a QR code of it. **Copy address** copies it (paste it into Notes to check) |
| 6.2 | Home → **Fund with Friendbot** | The balance becomes **10,000 XLM** within about 10 seconds. If Friendbot fails, wait a minute and retry once: it's a public faucet |
| 6.3 | Open your address on stellar.expert (testnet) | The account exists and shows 10,000 XLM |

## 7. Send through the review

| # | Step | Expected |
|---|---|---|
| 7.1 | Home → **Send** | There is **no camera / QR button** (no QR scanning on iPhone yet). You paste the recipient |
| 7.2 | Paste the **ordinary address** → amount `1` → Review | The review names 1 XLM and the recipient. Badge *Checked by Lantern*. The recipient reads as **not** in the scam registry. A plain-language summary, labelled with who wrote it (Lantern's AI explainer, or rules-based). The button reads **Confirm & Send** |
| 7.3 | **Confirm & Send** | Success. The balance drops by 1 XLM plus a tiny fee. The send appears in **Activity**, and on stellar.expert |
| 7.4 | **Hard blocker.** Send → paste the **reported address** → amount `1` → Review | Badge **High risk — action needed**. A red callout says the address is **reported in the scam registry**, reason **Scam**, status **Active**, with a report count. The button reads **Sign Anyway** |
| 7.5 | **Hard blocker.** Without typing anything, try to tap **Sign Anyway** | Nothing is signed. The button is disabled, and a field says *To proceed anyway, type CONFIRM below* |
| 7.6 | Type `CONFIRM`, then **don't** sign: go back / cancel | Nothing is sent. Nothing new in Activity |
| 7.7 | Switch to another app while a review is open, then come back | The app is locked (§9). After unlocking, the review is not still waiting to sign: a fresh review needs a fresh `CONFIRM` |

## 8. Report an address

Reporting writes a **real, permanent** entry to the testnet registry, signed by your wallet, and costs a small fee in testnet XLM. Use the **fresh address** you made in the Lab, never the ordinary address from the Reference values.

| # | Step | Expected |
|---|---|---|
| 8.1 | Send → paste the **fresh address** → amount `1` → Review | The review shows a **Report this address** button for the recipient |
| 8.2 | **Report this address** | *Report to the registry*, with the **full** address (never shortened). No reason is pre-selected: you must choose one |
| 8.3 | Read the form before signing | The **Report fee** is shown. A note says the report is public, permanent, and recorded on chain against your address. The optional note stays on this device |
| 8.4 | Choose a reason → **Sign & report** | *Reported to the registry*, with a stellar.expert link to the transaction. **Copy that link into the Notes column of §13** |
| 8.5 | Back out, then Send → the same fresh address → Review again | Now **High risk**, *reported in the scam registry*, with your reason |
| 8.6 | Send → the **reported address** → Review → **Report it too** (don't sign) | A warning, before signing, that the address is already on the registry and reporting again charges the fee again. Cancel |
| 8.7 | Cancel the send | Nothing was sent to either address |

## 9. Lock and unlock

| # | Step | Expected |
|---|---|---|
| 9.1 | Settings → **Lock wallet** | *Welcome back — Enter your password to unlock.* |
| 9.2 | Enter a wrong password | Refused, with a message. Still locked |
| 9.3 | Enter the right password | Home, with your address and balance |
| 9.4 | **Lock on hide.** Unlocked, switch to another app (swipe along the bottom), wait 5 seconds, switch back | **Locked**: the unlock screen |
| 9.5 | Unlocked, press the side button to lock the phone. Unlock the phone | Lantern shows the unlock screen |
| 9.6 | Unlocked, go to the Home Screen, then tap the Lantern icon again | The unlock screen |
| 9.7 | Settings → **Auto-lock** | A timer setting (15 minutes by default). Record the value |

## 10. Close it for a day, and come back

| # | Step | Expected |
|---|---|---|
| 10.1 | Write down your address, balance and the last Activity entry. Then close Lantern in the app switcher (swipe it up and away) | Closed |
| 10.2 | Leave it for **at least 24 hours**. Use the phone normally; restarting it is fine | Recorded: the date and time you closed it, and when you came back |
| 10.3 | **Hard blocker.** Open Lantern from the Home Screen | The **unlock screen**, not the welcome screen. Your password unlocks it, and the address, balance and Activity match 10.1 |
| 10.4 | Settings → **Storage** | Record the state again. Compare with 5.2 |
| 10.5 | Optional, if you can wait: check again **8 days or more** after the last time you opened the Home Screen app | Same as 10.3. Mark N/A if not run |
| 10.6 | Optional: delete the app from the Home Screen, add it again from Safari, open it → **Import Wallet** → type the 12 words from §4 | The **same `G…` address** and balance come back. (This also proves your paper backup is right.) Mark N/A if not run |

## 11. In a Safari tab ("continue anyway")

Some people won't add the app to the Home Screen. This section checks that they're warned. Use a **Safari tab**, not the Home Screen app.

| # | Step | Expected |
|---|---|---|
| 11.1 | In Safari, open `https://app.golantern.xyz` | The Home Screen step from 2.5, with the testnet banner |
| 11.2 | **Continue in Safari anyway** | It doesn't go straight on. It first warns that in a Safari tab your wallet can be erased if you don't open it for 7 days, and that you'd need your recovery phrase |
| 11.3 | **I understand, continue in Safari** | The welcome screen (*Create New Wallet* / *Import Wallet*). Record whether the wallet from §4 is there. (iOS normally keeps a Home Screen app's storage apart from Safari's, so expect the welcome screen) |
| 11.4 | Create a throwaway wallet here (repeat 4.1–4.6) → Settings → **Storage** | **This browser may erase your wallet**, with advice to add Lantern to the Home Screen and keep the recovery phrase safe |
| 11.5 | Open `https://app.golantern.xyz` in a **second** Safari tab | *Lantern is open in another tab*. Close the first tab: the second one starts on its own |
| 11.6 | Go back to the Home Screen app from §4 and unlock it | Still your §4 wallet. The tab's throwaway wallet didn't touch it |

## 12. Offline

| # | Step | Expected |
|---|---|---|
| 12.1 | Turn on Airplane Mode (Wi-Fi off too). Open Lantern from the Home Screen | The app opens: the unlock screen with the banner, not Safari's *"cannot open the page"* |
| 12.2 | Unlock | Unlocks (the wallet is on the phone). The balance can't load: a plain message, not a blank screen or a crash |
| 12.3 | **Hard blocker.** Send → the ordinary address → `1` → Review | It **fails closed**: no *Checked by Lantern*, and the recipient never reads as clean. Nothing is sent |
| 12.4 | Turn Airplane Mode off and go back to Home | The balance loads again |

## 13. Results

Fill one row per case: **pass**, **fail** (with a one-line description and a screenshot name), **blocked** (with the reason), or **N/A**.

| # | Result | Notes / screenshot | |
|---|---|---|---|
| 1.1 | | | |
| 1.2 | | | |
| 1.3 | | | |
| 2.1 | | | |
| 2.2 | | | |
| 2.3 | | | **without team support** |
| 2.4 | | | |
| 2.5 | | | |
| 3.1 | | | |
| 3.2 | | | |
| 3.3 | | | |
| 3.4 | | | |
| 3.5 | | | |
| 4.1 | | | |
| 4.2 | | | |
| 4.3 | | | |
| 4.4 | | | **hard blocker** |
| 4.5 | | | |
| 4.6 | | | |
| 4.7 | | | |
| 5.1 | | | |
| 5.2 | | | |
| 5.3 | | | |
| 5.4 | | | |
| 5.5 | | | |
| 5.6 | | | |
| 5.7 | | | |
| 6.1 | | | |
| 6.2 | | | |
| 6.3 | | | |
| 7.1 | | | |
| 7.2 | | | |
| 7.3 | | | |
| 7.4 | | | **hard blocker** |
| 7.5 | | | **hard blocker** |
| 7.6 | | | |
| 7.7 | | | |
| 8.1 | | | |
| 8.2 | | | |
| 8.3 | | | |
| 8.4 | | | |
| 8.5 | | | |
| 8.6 | | | |
| 8.7 | | | |
| 9.1 | | | |
| 9.2 | | | |
| 9.3 | | | |
| 9.4 | | | |
| 9.5 | | | |
| 9.6 | | | |
| 9.7 | | | |
| 10.1 | | | |
| 10.2 | | | |
| 10.3 | | | **hard blocker** |
| 10.4 | | | |
| 10.5 | | | optional |
| 10.6 | | | optional |
| 11.1 | | | |
| 11.2 | | | |
| 11.3 | | | |
| 11.4 | | | |
| 11.5 | | | |
| 11.6 | | | |
| 12.1 | | | |
| 12.2 | | | |
| 12.3 | | | **hard blocker** |
| 12.4 | | | |

**Sign-off requires** §2–§10 green, and every hard blocker (4.4, 7.4, 7.5, 10.3, 12.3) passing. Failures in §11 and §12 other than 12.3 may be triaged as non-blocking at the team's discretion.

Reviewer (not on the Lantern team): ______ · Date: ______ · iPhone model and iOS version: ______ · Build (Settings → Version): ______ · Sign-off: ☐

## Coverage

| Slice | Cases |
|---|---|
| #237 Browser build: storage on the phone, one tab, offline shell, PWA icon and full-screen launch | 3.1–3.5, 10.1–10.6, 11.5, 11.6, 12.1, 12.2 |
| #238 Home Screen step on iOS, and "continue anyway" | 2.5, 3.3, 11.1–11.3 |
| #238 Persistent storage (Settings → Storage) | 5.2, 5.3, 10.4, 11.4 |
| #238 Backup before funding | 4.1–4.6 |
| #238 Testnet banner, testnet only, no Cash in/out, no remote dApps | 2.4, 5.4–5.7 |
| #238 Lock on hide | 7.7, 9.4–9.6 |
| #239 Homepage call-to-action and the `src` attribution | 2.1–2.3 |
| Wallet features carried over (review, registry screening, report, lock) | 6.1–6.3, 7.1–7.6, 8.1–8.7, 9.1–9.3, 9.7, 12.3 |
| Analytics opt-in | 4.7 |

Not covered here, and why: the Content-Security-Policy, the refusal to run inside another site's frame and the build's checksums are checked by the build itself and by browser automation, and need a desktop to inspect. QR scanning on iPhone isn't built yet.

## Notes for the reviewer

- **Testnet is periodically reset.** If your balance goes to zero, the account disappears from stellar.expert, or the reported address suddenly reads as clean, that is probably a reset. Record it and tell the team before going on: a clean reading of the reported address is only a pass for §7 if the registry entry is really gone.
- Friendbot and the public testnet servers can be slow or rate-limited. If a live step fails, wait a minute and retry once before recording a fail.
- Keep your written recovery phrase until the team has read your results. It is a testnet wallet, but §10.6 needs it.
- Never put a mainnet secret key or recovery phrase into this app.
