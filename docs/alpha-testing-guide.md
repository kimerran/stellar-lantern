# Lantern — Alpha Tester Guide

**ALPHA · CONFIDENTIAL**

*A security-first Stellar wallet. You're one of a small group looking at this before anyone else.*

**Time needed:** about 60 minutes · **Platforms:** Android APK **and** Chrome extension — please test both · **Network:** Stellar Testnet only
**What we need back:** one ZIP file — 10 screenshots from your main platform, 2 from the second, and honest answers to 5 questions.

---

Lantern is a **non-custodial Stellar wallet** built around one idea: you should never sign something you don't understand. Every time you are about to sign, Lantern shows a **review screen** that says in plain words what the transaction does, checks who it pays against an on-chain scam registry, and gives it a risk level. That review screen is what this round of testing is about: **we need you to make it run, six times, in six different places in the app**, and tell us where it helped, confused, or got it wrong.

> ⚠️ **Read this first — Testnet only**
>
> This build runs on **Stellar Testnet**. The XLM in it is **play money with no value**, handed out for free by a faucet.
>
> - **Do not import a real wallet.** Never paste a recovery phrase or secret key that holds real funds into an alpha build — not this one, not any.
> - **Do not send real money** to any address you see in this app or in this guide.
> - Create a **brand-new wallet** for testing, as Part 2 instructs. **One wallet per person, please** — we count how many different people's wallets ran the security check, and that number is only honest if each of you is one wallet. (Using the *same* wallet on your phone and in Chrome is fine and expected; creating extra wallets to look busy is not.)
>
> This is alpha software. Expect rough edges — finding them is the point.

### What you'll need

- Your **tester number** — it's in the message that sent you this guide. You'll need it in Part 3.
- An Android phone (Android 8 or newer) and the **`app-debug.apk`** file we sent you.
- Desktop Chrome, Edge, Brave or another Chromium browser, and the **`lantern-stellar-wallet-0.1.0.zip`** we sent you (the version number may be higher — the message names the exact file).
- Somewhere to save screenshots.

**We'd like you to test both platforms.** Pick one as your *main* platform and do everything on it (Parts 0–5). Then, in Part 7, install the other, import the same wallet, and repeat two short steps — about 10 extra minutes. The same wallet on two screens is exactly the comparison we can't make ourselves. If you truly can't do both, one is still valuable — tell us which.

### Make sure you have the alpha build

The files above are the **alpha build**: it is the only build that can tell us which tester did what. A generic release build looks identical but reports nothing useful. Two ways to check, once your wallet exists (Part 2):

- **Settings → Privacy**: the switch is titled **Share usage data (alpha)**, and the "we collect" list includes *your public wallet address (alpha builds only)*. If the switch's title says "Share **anonymous** usage data" instead, you have the wrong build — stop and tell us.
- **Settings**, bottom of the page: the version number. Put it in your answers file.

---

## Part 0 — Turn usage sharing on (the first thing you do)

This is the step everything else depends on, so it comes first.

We measure whether the security check is actually being used by counting, across all testers, how many times the review screen ran and how many different wallets ran it. Those counts come from **usage sharing**, and it is **off by default**. If it stays off, you can do every exercise in this guide perfectly and, as far as our numbers are concerned, you were never here.

**So for this round, turning it on is not optional — we're asking every tester to do it, and we'd rather say that plainly than bury it.** Here is exactly what it sends and what it never sends, so you can decide with your eyes open:

| It sends | It never sends |
|---|---|
| a random install id | your secret keys |
| your **public** wallet address (alpha builds only — so we can match your feedback to your usage) | your recovery phrase or password |
| which features you used, and how often | amounts, asset codes, memos or transaction hashes |
| whether a scan warned you, and how risky it said the transaction was | the text of any message you check |
| your platform (Android / Chrome) and the app version | |

You can turn it off, and ask us to delete everything from your install, at any time under **Settings → Privacy → Delete my data**.

**How to turn it on.** Lantern only offers the switch once a wallet exists (the address it attaches doesn't exist before then), so the moment is right after Part 2, step 6:

1. On your first arrival at **Home**, a card titled **Share usage data (alpha)?** appears. Tap the button labelled **Share anonymous usage data** (that button reads the same on every build; the card title is what identifies the alpha build).
2. If you dismissed it, or it didn't appear: **Settings → Privacy → Share usage data (alpha)** → switch it on. You'll see *"Thanks — sharing anonymous usage data."*
3. Below the switch an **Analytics ID** appears. Tap it to copy it, and paste it at the top of your answers file.

> 📸 **SCREENSHOT 1** — Settings → Privacy with the switch **on** and the Analytics ID visible.

If you are not comfortable with this, that is a legitimate answer — tell us, and skip the rest of the guide rather than testing with it off. We'd rather have your honest "no" than silent zeros.

---

## Part 1 — Install

You'll install **both** eventually. Install your **main** platform now (either one); the second one comes at Part 7.

### Android APK

1. Copy `app-debug.apk` onto your phone (email it to yourself, or use the link we sent).
2. Open your **Files** app and tap the APK.
3. Android will warn you the app is from an unknown source. That's expected — this is a test build not yet on the Play Store. Tap **Settings** → enable **Allow from this source** → go back and tap **Install**.
4. You may also see "Play Protect doesn't recognize this developer". Tap **Install anyway**. (Expected for a pre-release build — but don't do this for apps from people you don't know.)
5. Open **Lantern** from your app drawer.

> **If it won't install:** the most common cause is an older Lantern already on the phone. Uninstall it first and try again.

### Chrome extension

1. Unzip `lantern-stellar-wallet-0.1.0.zip` somewhere you'll leave it — your Documents folder, not Downloads. **Chrome loads the extension from this folder every time, so don't delete or move it after installing.**
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (toggle, top right).
4. Click **Load unpacked**.
5. Select the folder you unzipped — the folder itself, not a file inside it.
6. Lantern appears in your extension list. Click the puzzle-piece icon in the toolbar and **pin** Lantern.
7. Click the Lantern icon to open it.

> **If Chrome shows an error:** make sure the folder you selected contains `manifest.json` directly inside it. If you unzipped into a folder-inside-a-folder, go one level deeper.

---

## Part 2 — Create your wallet

1. On the welcome screen, tap **Create Wallet**.
2. Lantern shows you a **12-word recovery phrase**. Write it on paper or save it in a note — you'll need it in a moment, and again in Part 7 on your second platform. *This is a test wallet with no real value, so you don't need to be precious about it. With a real wallet, you would never store these words digitally.*
3. Tick the acknowledgement box and continue.
4. Lantern asks you to **type a few of the words back** to confirm you saved them. Enter the requested word numbers.
5. Set a password. This encrypts the wallet on your device. **Remember it** — there's no reset, and you'll need it every time the wallet locks.
6. You land on the **Home** screen, showing a **Testnet** badge and a balance of zero. **Now do Part 0** — accept the card, then come back here.

### Get test funds

Your new account isn't active until it's funded.

7. On the Home screen, tap **Fund with Friendbot** — the free Testnet faucet.
8. Wait a few seconds. Your balance should jump to around 10,000 XLM of play money.

> **If Friendbot fails:** it's a public faucet and it does go down. Wait a minute and tap again. If it still fails, note it in your feedback; you can still do Part 5 (the message checker) without funds, but everything in Part 3 needs a balance — come back when it works.

> 📸 **SCREENSHOT 2** — Your funded Home screen, showing the balance and the Testnet badge.

**Please also note:** roughly how long did the whole create-wallet flow take, and did you hesitate anywhere?

---

## Part 3 — Six transactions through the security check ⭐

**This is the heart of the test.** Each exercise below makes Lantern's review screen run in a different part of the app. Do all six, in order. Some you will sign; two you will **cancel** at the review screen — cancelling still counts, because the check ran.

At every review screen, before you do anything else, read it and ask: *does it say, in one plain sentence, what is about to happen? Would I have understood it if I weren't a crypto person?* Then look for the **badge**: **Checked by Lantern** (low risk), **Caution — review below** (medium) or **High risk — action needed** (high).

You'll need your **tester number** and the [assignment table](alpha-tester-assignments.md) for exercise 3.

### Exercise 1 — An ordinary payment (baseline)

1. On **Home**, tap **Send**.
2. As the recipient, paste the Lantern test address:
   `GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK`
   It's an ordinary, funded Testnet account we control. This is what a routine payment to someone you know should look like.
3. Enter **1 XLM** and continue to the review step.
4. Expect a sentence like *"This sends 1 XLM to GAMN…SRNK"*, the **Checked by Lantern** badge, and no warning.
5. **Confirm & Send.** It should complete within a few seconds, with a link to view it on stellar.expert.

> 📸 **SCREENSHOT 3** — The review screen before you sign.

### Exercise 2 — A payment to a reported address (cancel this one)

This is the screen we most want your reaction to.

1. **Send** again. As the recipient, paste this address exactly:
   `GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ`
   It's a Testnet address that has been reported as a scam on the registry. (No money is at risk — but treat it as if there were.)
2. Enter **1 XLM** and continue to the review step.
3. Lantern should warn you that the recipient is a **reported address**, show the badge **High risk — action needed**, and change the button to **Sign Anyway** behind an extra step: on Android you must **press and hold**; in Chrome you must **type CONFIRM** into a box first.
4. **Read the warning, then cancel.** Do not confirm.

Ask yourself: did you understand *why* it was warning you? If this had been real money and a message from someone you half-trusted, would this screen have stopped you?

> 📸 **SCREENSHOT 4** — The high-risk review screen with the warning.

### Exercise 3 — A payment to a brand-new account

Find your **tester number** in the [assignment table](alpha-tester-assignments.md) and copy the address in the **New account** column of your row. Nobody has ever paid this address — it doesn't exist on the network yet.

1. **Send** → paste your assigned address → enter **2 XLM** (a new account needs at least 1 XLM to exist; 2 leaves room for the fee).
2. At the review, look for how Lantern describes paying an account that **doesn't exist yet**. Does it tell you? Does it read as more or less risky than exercise 1, and does that match your gut?
3. **Confirm & Send.**

> 📸 **SCREENSHOT 5** — The review screen for the new account.

### Exercise 4 — A payment asked for by an app

Apps can ask Lantern to pay on their behalf — and Lantern must show you the same review before anything is signed.

1. Open the **Apps** tab and open **Lantern Demo App** (it has a *Demo* chip).
2. Inside it, **connect** your wallet, then use its send / pay button to request a small payment (**1 XLM** or the app's default).
3. Lantern's own review screen should appear over the app — the same layout as exercise 1, not something drawn by the app. Check that the amount and recipient the app asked for are what the review shows.
4. **Confirm & Send** (or cancel if anything about it makes you uneasy — and say why).

> 📸 **SCREENSHOT 6** — The review screen as it appeared over the app.

### Exercise 5 — Put some XLM into an Earn pool

1. From **Home**, open **Earn**.
2. Pick the **Lantern Earn** pool, choose **XLM**, and **Supply** a small amount — **10 XLM**.
3. At the review, notice that this is a *contract call*, not a payment to a person. Does Lantern make clear where your XLM is going and that you can withdraw it? Is the risk level what you'd expect for putting money into a pool?
4. **Confirm.** (You can withdraw it afterwards from the same screen if you like — that runs the review once more.)

> **If Earn shows an error before you reach the review** (the pool didn't load, the network timed out): the pool is a third-party testnet service and does go down. Try once more a minute later; if it still fails, screenshot the error, write *"Earn unavailable"* in your answers, and move on. That is a finding, not your fault.

> 📸 **SCREENSHOT 7** — The Earn review screen.

### Exercise 6 — Add a recovery guardian

A guardian is a trusted address that can help you recover the account if you lose your phrase. Adding one changes your account's signing rules, which is a very different kind of transaction from a payment.

1. Open **Settings → Guardians & recovery**.
2. Under **Set Up Recovery**, paste the Lantern test address from exercise 1 (`GAMN…SRNK`) as the guardian. Leave the threshold at its default.
3. Tap **Review**. This review is about *who can sign for your account*, not about money moving. Does it say so in words you'd understand? Would you know, from this screen, what you are agreeing to?
4. **Hold to Set Up Recovery** (Android) / **Set Up Recovery** (Chrome).

> 📸 **SCREENSHOT 8** — The recovery review screen.

### After the six

Open **Activity**. Exercises 1, 3, 4, 5 and 6 should be listed; exercise 2 should not. Tap one for detail.

- Does the history make sense at a glance? Could you tell money-in from money-out without thinking?
- Across the six review screens: **which one was clearest, and which one would you not have understood without this guide?** That answer is worth more to us than any bug.

> **A note on Swap and Cash In / Cash Out.** You'll see both in the app. Swap needs a second asset in your wallet, which this build can't yet add, so please leave it. Cash In / Cash Out depends on external services that aren't part of this test. Everything else — Send, Apps, Earn, Guardians — is in scope and is exactly where we want you.

---

## Part 4 — Lock and unlock

Close Lantern and reopen it, or wait for auto-lock. Unlock with your password. Confirm your balance is still there.

While you're there: open **Settings** and glance over it — network, auto-lock time, and the **Security** section. Anything that reads strangely is a finding.

---

## Part 5 — The scam-message checker

Lantern can also check a suspicious message — a DM, an offer, a "support" message — for scam patterns, entirely on your device. The message is never sent anywhere or stored. This part is about the quality of its verdicts; it is quick, and we still want your opinion on it.

Open **Settings → Security & scam check**. You'll see a box labelled **Check a message**. Paste each message below, tap **Check message**, read the result.

**5.1 — Fake support asking for your phrase**

```
Hi, this is the Lantern support team. Your account has been locked
due to unusual activity. To verify your wallet and restore access,
reply with your 12-word recovery phrase immediately.
```

**5.2 — The giveaway scam**

```
🚀 XLM GIVEAWAY! Send any amount to the address below and we will
double your balance instantly. Limited spots – click here to claim
before it expires today: https://stellar-rewards-claim.example
```

**5.3 — An ordinary, harmless message**

```
Hey, thanks for covering lunch yesterday. I'll send you the 20 XLM
I owe you tonight once I'm home.
```

**5.4 — Bring your own (required).** Find a **real** scam or spam message you've received — DMs, SMS, spam folder, email. Everyone has one. Paste it in. This is the most valuable test of all, because we didn't write it. If Lantern stays quiet on something obviously dodgy, that is exactly what we need to hear — say what tipped *you* off.

> ⚠️ **Before screenshotting a real message, blur or crop out the sender's name, phone number and any personal details.** We want the scam text, not anybody's identity.

> 📸 **SCREENSHOTS 9–10** — Two of the four, your pick — ideally one Lantern got right and one you'd argue with. Label them 5.1–5.4.

For each verdict: **was it right?** Did it flag what you'd flag, and stay quiet on 5.3? **A wrong verdict is the single most useful thing you can report**, in either direction.

---

## Part 6 — Feedback interview

Answer these in writing, or book a 20-minute call — whichever you prefer. **Short, blunt answers are more useful than polite ones.** If something was bad, say it was bad.

1. **Walk us through the moment you first saw a warning — exercise 2, or a message in Part 5. What did you think it meant, and what would you have done next if this had been your real money?**
   *We want your reaction in your own words — not whether you thought the feature was "good".*

2. **Of the six review screens in Part 3, which was clearest and which was least clear? Name the exercise number and say what was missing.**
   *The review screen is the product. Every place it fell short is a finding.*

3. **Where did you get stuck, confused or annoyed? Name the specific screen.**
   *Every single spot. Small irritations count. If you had to re-read something twice, that's a finding.*

4. **Would you put real money in this today? If not — what specifically is missing, and what would have to be true for you to change your mind?**
   *A "no" is a useful answer. We need the reason, not the verdict.*

5. **Did the review screen or the message checker ever get it wrong — flagged something harmless, or stayed quiet on something you'd have flagged? Which one, and what did you expect instead?**
   *If it never got it wrong in your testing, say so — that's a data point too.*

**Optional — anything else?** Bugs, crashes, a word that read strangely, something that felt untrustworthy, something you loved. All welcome.

---

## Part 7 — The second platform (about 10 minutes)

Now install Lantern on the **other** platform, following the matching section of Part 1.

1. On the welcome screen choose **Import** instead of Create, and enter the 12 words from Part 2. You should land on Home with the **same address and balance** as your main platform. Note how long it took and anything confusing.
2. When the **Share usage data (alpha)?** card appears, tap **Share anonymous usage data** here too (each install has its own switch).
3. Repeat **exercise 1** — the 1 XLM payment to the Lantern test address — and sign it.
4. Repeat **exercise 2** — the payment to the reported address — and cancel at the warning. Notice the extra step is different here: press-and-hold on the phone, type CONFIRM in Chrome.

> 📸 **SCREENSHOTS 11–12** — The imported Home screen, and the high-risk review screen on this platform.

Then tell us: did anything look, read or behave **differently** between the phone and the browser? Same wallet, two screens — differences are findings.

---

## Coming next: reporting an address to the registry

The registry that flagged exercise 2's address is public and on-chain, and the next build adds a **one-click report** so you can add an address to it yourself. Your row in the [assignment table](alpha-tester-assignments.md) already holds two addresses (**R1**, **R2**) for that exercise. **Do nothing with them yet** — the button isn't in this build. When it ships we'll send a one-page addendum; you'll report each of your two addresses once, then one of them a second time, and screenshot the transaction on stellar.expert. Reporting costs a small testnet fee (Friendbot covers it), you can't report your own address, and a second report of the same address is an extra transaction but not an extra registry entry — the addendum explains why that matters.

---

## Sending it back

Put everything in **one ZIP file** named

```
<YOUR_NAME>-lantern-<DATE>.zip        e.g. maria-lantern-2026-09-24.zip
```

containing:

- **Your screenshots** — 1 through 12, named by number (`01-privacy.png`, `03-exercise-1.png`, …).
- **Your answers** to the five questions and the Part 7 differences, as a text or document file (`answers.txt` / `answers.docx`).
- **At the top of the answers file:** your tester number, which platform was your main one, your phone model and browser version, the **app version** from Settings, and your **Analytics ID** from Part 0.
- **Your wallet address** (the `G…` address from **Receive**) — paste it under your platform details. This is how we match your answers to your usage.

If you hit a crash or something clearly broken, tell us **what you did immediately before it happened**. That one sentence saves us hours.

**Email the ZIP to:** lantern@artisam.xyz
