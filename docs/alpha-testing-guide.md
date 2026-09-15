# Lantern — Alpha Tester Guide

Thanks for testing Lantern. You're one of a small group looking at this before anyone else.

Lantern is a **security-first Stellar wallet**. The part we most want your opinion on is the **security scanner** — the feature that reads messages and transactions and warns you before you do something you'd regret.

**Time needed:** about 30 minutes.
**What we need back:** a handful of screenshots and honest answers to 5 questions at the end.

---

> ## ⚠️ Read this first — Testnet only
>
> This build runs on **Stellar Testnet**. The XLM in it is **play money with no value**, handed out for free by a faucet.
>
> - **Do not import a real wallet.** Never paste a recovery phrase or secret key that holds real funds into an alpha build — not this one, not any.
> - **Do not send real money to any address you see in this app.**
> - Create a **brand-new wallet** for testing, as the guide below instructs.
>
> This is alpha software. Expect rough edges. Finding them is the point.

---

## What you'll need

- **Android testers:** an Android phone (Android 8 or newer) and the `lantern-debug.apk` file we sent you.
- **Chrome testers:** desktop Chrome, Edge, Brave, or another Chromium browser, and the `lantern-extension.zip` we sent you.
- Somewhere to save screenshots.

You only need **one** platform. If you're willing to do both, even better — tell us which one you tried.

---

# Part 1 — Install

## Option A: Android APK

1. Copy `lantern-debug.apk` onto your phone (email it to yourself, or download it from the link we sent).
2. Open your **Files** app and tap the APK.
3. Android will warn you that this app is from an unknown source. That's expected — this is a test build that isn't on the Play Store yet. Tap **Settings** → enable **Allow from this source** → go back and tap **Install**.
4. You may see a "Play Protect doesn't recognize this developer" warning. Tap **Install anyway**. (Again: expected for a pre-release build. Don't do this for apps from people you don't know.)
5. Open **Lantern** from your app drawer.

> **If it won't install:** the most common cause is an older Lantern already on the phone. Uninstall it first and try again.

## Option B: Chrome extension

1. Unzip `lantern-extension.zip` somewhere you'll leave it — your Documents folder, not Downloads. **Chrome loads the extension from this folder every time, so don't delete or move it after installing.**
2. Go to `chrome://extensions` in your browser.
3. Turn on **Developer mode** (toggle, top right).
4. Click **Load unpacked**.
5. Select the folder you unzipped. Pick the folder itself, not a file inside it.
6. Lantern appears in your extension list. Click the puzzle-piece icon in the toolbar and **pin** Lantern so it's one click away.
7. Click the Lantern icon to open it.

> **If Chrome shows an error:** make sure you selected the folder that contains `manifest.json` directly inside it. If you unzipped into a folder-inside-a-folder, go one level deeper.

### 📸 Screenshot 1
**The moment installation finishes** — the Android "app installed" screen, or your `chrome://extensions` page with Lantern listed.

---

# Part 2 — Create your wallet

1. On the welcome screen, tap **Create Wallet**.
2. Lantern shows you a **12-word recovery phrase**. Write it on paper or save it in a note — you'll need it in a moment.
   - This is a test wallet with no real value, so you don't need to be precious about it. With a real wallet, you would never store these words digitally.
3. Tick the acknowledgement box and continue.
4. Lantern asks you to **type a few of the words back** to confirm you saved them. Enter the requested word numbers.
5. Set a password. This encrypts the wallet on your device. **Remember it** — there's no reset, and you'll need it every time the wallet locks.
6. You land on the **Assets** screen. You should see a **Testnet** badge and a balance of zero.

## Get test funds

Your new account isn't active until it's funded.

7. On the Assets screen, tap **Fund with Friendbot**. This is the free Testnet faucet.
8. Wait a few seconds. Your balance should jump to around 10,000 XLM of play money.

> **If Friendbot fails:** it's a public faucet and it does go down. Wait a minute and tap it again. If it still fails, note it in your feedback and carry on — you can still test the scanner without funds.

### 📸 Screenshot 2
**Your funded Assets screen**, showing the balance and the Testnet badge.

**Please also note:** roughly how long did the whole create-wallet flow take, and did you hesitate anywhere?

---

# Part 3 — Basic wallet tasks

Try these in order. If something is confusing, that's a finding — write it down rather than pushing through silently.

### 3.1 Receive
Find the **Receive** option. You should get a QR code and your account address (a long string starting with `G`). Copy the address.

### 3.2 Send a payment
1. Go to the **Send** tab.
2. Paste **your own address** as the recipient — sending to yourself is the simplest safe test.
3. Enter a small amount, like `1` XLM.
4. Continue to the review step.
5. **Stop and read the review screen carefully.** Lantern is supposed to explain, in plain English, exactly what you're about to sign. Does it? Would you have understood it if you weren't a crypto person?
6. Confirm and sign.

### 📸 Screenshot 3
**The review/confirmation screen before you sign** — the one that explains what the transaction does.

### 3.3 Activity
Open **Activity** (your transaction history). Your payment should be listed. Tap it for detail.

- Does the history make sense at a glance?
- Could you tell money-in from money-out without thinking about it?

### 3.4 Lock and unlock
Close Lantern and reopen it, or wait for auto-lock. Unlock with your password. Confirm your balance is still there.

> ### Please skip these for this round
> You'll see **Earn**, **Apps**, **Swap**, and **Cash In / Cash Out** in the app. They're real, but they're not what we're testing right now, and some depend on external services that are unreliable on Testnet. Ignore them. If you poke at one anyway and it breaks, tell us — but don't spend your time there.

---

# Part 4 — The security scanner ⭐

**This is the most important part of the test.** Please don't skip it.

Lantern can check a suspicious message — a DM, an offer, a "support" message — for scam patterns, entirely on your device. The message is never sent anywhere or stored.

Find the **Security** screen (the shield/security icon). You'll see a box labelled **Check a message**.

Paste each of the four messages below, one at a time, tap **Check message**, and read the result. **Take a screenshot of each result.**

---

### Test 4.1 — Fake support asking for your phrase

```
Hi, this is the Lantern support team. Your account has been locked
due to unusual activity. To verify your wallet and restore access,
reply with your 12-word recovery phrase immediately.
```

### Test 4.2 — The giveaway scam

```
🚀 XLM GIVEAWAY! Send any amount to the address below and we will
double your balance instantly. Limited spots — click here to claim
before it expires today: https://stellar-rewards-claim.example
```

### Test 4.3 — A mild, ambiguous one

```
Your pending payment request expires today. Please review it when
you get a chance.
```

### Test 4.4 — An ordinary, harmless message

```
Hey, thanks for covering lunch yesterday. I'll send you the 20 XLM
I owe you tonight once I'm home.
```

### 📸 Screenshots 4–7
**One screenshot per test**, showing the message you pasted and the verdict Lantern gave. Please label them `4.1`, `4.2`, `4.3`, `4.4`.

---

### Now the part we actually care about

For each of the four, before reading on, ask yourself:

- **Was the verdict right?** Did Lantern flag what you'd flag, and stay quiet when it should have?
- **Did the explanation teach you anything**, or did it just say "this is bad"?
- **Would this have stopped you?** Imagine you were tired, on your phone, and the message came from someone you half-recognised.

Write down anything where Lantern's verdict and your gut disagreed. **A wrong verdict is the single most useful thing you can report.** Both directions matter: a scam it missed, and an innocent message it cried wolf over.

### Test 4.5 — Bring your own

If you have a **real** scam message in your DMs, spam folder, or SMS — paste it in and screenshot the result. This is the most valuable test of all, because we didn't write it.

⚠️ Before screenshotting a real message, **blur or crop out the sender's name, phone number, and any personal details.** We want the scam text, not anybody's identity.

---

# Part 5 — Feedback interview

Please answer these in writing, or book a 20-minute call with us — whichever you prefer. **Short, blunt answers are more useful than polite ones.** If something was bad, say it was bad.

### 1. Walk us through the moment you first saw a warning. What did you think it meant, and what would you have done next if this had been your real money?

*(We want your reaction in your own words — not whether you thought the feature was "good".)*

### 2. Where did you get stuck, confused, or annoyed? Name the specific screen.

*(Every single spot. Small irritations count. If you had to re-read something twice, that's a finding.)*

### 3. Would you put real money in this today? If not — what specifically is missing, and what would have to be true for you to change your mind?

*(A "no" is a useful answer. We need to know the reason, not the verdict.)*

### 4. You already use a wallet, or you've chosen not to use one. Compared to that, what would actually make you switch to Lantern — and what's the one thing that would stop you?

*(Be honest if the answer is "nothing would make me switch".)*

### 5. Did the scanner ever get it wrong — flagged something harmless, or stayed quiet on something you'd have flagged? Which message, and what did you expect instead?

*(If it never got it wrong in your testing, say so — that's a data point too.)*

### Optional: anything else?

Bugs, crashes, a word that read strangely, something that felt untrustworthy, something you loved. All welcome.

---

# Sending it back

Please send us:

1. **Your screenshots** — 1 through 7, plus 4.5 if you did it.
2. **Your answers** to the five questions.
3. **Which platform** you tested (Android, Chrome, or both), and your **phone model or browser version**.

If you hit a crash or something clearly broken, tell us **what you did immediately before it happened**. That one sentence saves us hours.

**Send to:** *(contact to be filled in)*

---

Thank you. Genuinely — early testers catch the things that would otherwise reach real users with real money.

— The Lantern team
