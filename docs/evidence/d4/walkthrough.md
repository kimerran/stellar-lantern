# D4 walkthrough: runbook, shot list and script

The 3-minute, captioned walkthrough that SOW §6.1 asks for as Deliverable 4 evidence. It follows the SOW §5.1 shot list:

> *"open wallet / demo → scan a safe tx → scan a malicious tx that gets flagged → report the address → re-scan shows it flagged"*

Recorded against the **live** page, `https://golantern.xyz/demo/`, never localhost. The report filed in scene 4 is also the D4 evidence's **report transaction hash**, so it's a real, permanent testnet write. Do the prep first.

## Prep (about 15 minutes, the day of recording)

1. **Check the page is on the current release.** Open `https://golantern.xyz/demo/` and run *A safe payment*. The summary label should read *written by Lantern's AI explainer* (if it reads *rules-based (no AI)*, the release with the AI summary isn't live yet, or the explainer is down; wait, don't record around it).
2. **A wallet to report with.** In a desktop browser, open [albedo.link](https://albedo.link), create an account (it lives in the browser, nothing to install), and copy its public key (G…). Fund it on testnet: `https://friendbot.stellar.org/?addr=<that key>`. Friendbot gives 10,000 test XLM; a report costs 1 XLM plus a tiny network fee.
3. **A fresh address to report.** It must never have been reported, or scene 5 has nothing to show. Generate one at [lab.stellar.org](https://lab.stellar.org) → *Create keypair* (keep only the public key), or use any G… address that isn't in the registry panel. Paste it into a text file you can copy from on camera. Don't use a real person's address.
4. **Browser for recording:** a clean profile, zoom 110–125% so text is readable at 1080p, notifications off, bookmarks bar hidden, window 1280×800 or similar. Close other tabs.
5. **Dry run once** without recording: scenes 1–3 only (don't file the report). Check the registry panel loads, and note its two numbers.

## Shot list and narration (≈ 3:00)

Timecodes are targets. Narration is about 150 words a minute; cut words before you speed up.

### 1 · Open the demo — `0:00–0:20`
**On screen:** `golantern.xyz/demo` loads: *Scan a Stellar transaction*, the yellow *Testnet demo — nothing here moves real funds* bar, the four regions.

> "This is Lantern's playground. It runs the same security scanner that's built into the Lantern wallet, in a normal web page. There's nothing to install and nothing to sign in to. It reads a Stellar transaction before anyone signs it, and tells you what it really does."

### 2 · Scan a safe transaction — `0:20–0:50`
**On screen:** *Try an example* → **A safe payment** → *Run it*. Hold on the result: the *Checked by Lantern* badge, *Risk low · action allow*, the summary labelled *written by Lantern's AI explainer*, the screening row *Not in the scam registry*, and *What moves*.

> "First, an ordinary payment: twenty-five XLM to another account. Lantern decodes it, works out exactly what moves and to whom, and checks the recipient against an on-chain scam registry. Low risk. The sentence is written by an AI model, and the label says so, but the verdict never comes from the AI. It comes from the scanner's own rules."

### 3 · Scan a malicious transaction — `0:50–1:25`
**On screen:** **Payment to a reported scammer** (the card marked *The malicious one*) → *Run it*. Hold on: red *High risk — action needed*, *Risk high · action block_confirm*, the *Reported address* reason, and the screening row *Reported in the scam registry — Scam · N reports · Active*.

> "Now the one that matters. This payment goes to an address people have already reported as a scam. Lantern catches it: high risk, and the reason is right there. The address is in the registry, reported as a scam, with a report count anyone can check on-chain. In the Lantern wallet, this verdict holds the Sign button until you deliberately confirm."

### 4 · Report an address — `1:25–2:20`
**On screen:** *Your transaction* → **Compose a payment**. From: the Albedo account. To: the fresh address. Amount: `5` → *Scan it*. The screening row reads *Not in the scam registry*. Click its **Report** link: the *Report an address* panel fills in. Choose a reason (`Scam`). *Connect a wallet to report* → **Albedo** (*Web wallet, nothing to install*), approve in the Albedo window. *Review the report*: pause on the sheet (the full address, the reason, *Registry fee 1 XLM*, *public and permanent*, and **Lantern's scan of the report transaction itself**). *Sign with Albedo and report*, approve in Albedo. Hold on *Reported.* and the stellar.expert link.

> "Suppose you've found a new scam address. Here it is: nothing's recorded against it yet. So I'll report it, right from this page. I connect my own Stellar wallet. This is Albedo, which also runs in the browser. Before anything is signed, Lantern scans the report transaction itself, the same way it scans anything else. Our own contract gets no shortcut. There's a one-XLM fee, which is what keeps the registry from being spammed. The report is public and permanent. Sign, and it's on-chain."

### 5 · Re-scan: now it's flagged — `2:20–2:45`
**On screen:** the panel's *Checked again just now: Reported in the scam registry (1 report)*. Scroll to *Scam registry*: the count went up by one, and the new address is at the top. Back to *Your transaction* → *Scan it* again on the same payment: now **High risk**, *Reported in the scam registry*.

> "Scan the same payment again, and it's flagged. The registry panel shows the new entry, straight from the ledger. That report now protects everyone: any wallet or app that reads the registry will warn on this address."

### 6 · Close — `2:45–3:00`
**On screen:** click *See the transaction on stellar.expert* → the report transaction on the public explorer. End card: `golantern.xyz/demo`.

> "That's the whole loop, verifiable on the public explorer: check a transaction before you sign it, and report the ones that aren't safe. Try it yourself at golantern-dot-x-y-z slash demo. Lantern: self-custody you can actually read."

## Captions

- **Required** (SOW §5.1: *"Captioned 3-minute YouTube walkthrough video"*). Upload an `.srt` made from the narration above, timed to the final edit. Don't rely on YouTube's auto-captions alone: they mangle product names and addresses.
- Spell these exactly: **Lantern**, **Stellar**, **XLM**, **Albedo**, **stellar.expert**, **golantern.xyz**. Never caption a full G… address; say "the address" instead.
- Burned-in captions are fine too, if the editor prefers.

## After recording

1. Upload to YouTube (the channel the homepage links to), with the captions file. Title suggestion: *Lantern: check a Stellar transaction before you sign it (3-minute demo)*.
2. Copy the **report transaction hash** from the stellar.expert link in scene 6. It goes into the D4 evidence page as the report tx.
3. Put the video URL on the D4 evidence page and into the launch post (`docs/launch/lantern-instawards-launch.md`).
4. Take a note of the registry's numbers after the report, for the final metrics snapshot.

## If something goes wrong on camera

- **A live scan is slow or fails:** the seeded examples fall back to *Using cached simulation*, which is honest and fine to show. Pasted and composed transactions have no fallback; wait a minute and re-take.
- **Albedo's window is blocked:** allow pop-ups for golantern.xyz and re-take the scene.
- **Scene 5 still shows *Not in the scam registry*:** the address was already reported before, or the report didn't submit. Check the stellar.expert link, pick a fresh address, and re-take scenes 4–5.
- **The summary label reads *rules-based (no AI)*:** the explainer is down or its daily budget is spent. The verdict is unaffected, but re-take later so the video shows the normal path.
