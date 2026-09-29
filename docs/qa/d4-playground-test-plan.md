# D4 — Public demo playground: manual test plan

**Deliverable 4 (Instawards SOW, Week 4).** Issue #189 · build order #192 · slices #183–#188.
Written to be run by someone **outside the Lantern team**, from the public URL alone. No repository, no terminal, no wallet, no install.

> *"QA sweep with a non-team reviewer."* — SOW §5.1, Week 4
> *"Public demo URL anyone can run end-to-end without team support."* — SOW §5.1, Week 4 expected output

## 0. What you are testing

A web page, **https://golantern.xyz/demo/**, where anyone can give Lantern a Stellar **testnet** transaction and see what Lantern thinks of it before they sign: a plain-language summary, a risk verdict, and a check of every address it pays against an on-chain scam registry.

Three things matter more than any single case:

1. **It must never say "safe" when it does not know.** If the registry can't be reached, an address reads *"Not checked — unverified"*, never as clean.
2. **The pre-seeded malicious example must be caught, every time.** Example 2 (*Payment to a reported scammer*) must read **High risk**, with the address *Reported in the scam registry*, on demand. That holds even with the network off.
3. **Nothing here moves money, and nothing asks for a key.** If any step asks you for a secret key or recovery phrase, stop and file a blocker.

**How to run it:** open the URL cold, with no help from the team. If you get stuck, that is a finding: write down where and why, then carry on. Screenshot every result you record. The screenshots are part of the Instawards evidence package.

### Reference values

| | |
|---|---|
| Playground | `https://golantern.xyz/demo/` |
| Registry contract (testnet) | `CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F` |
| Registry WASM sha256 | `40fd37718c3fbc7f849c4d414364cdd86c01b4db9ab86be9099007ba5be23783` |
| Reported address (live `Active` entry, reason `Scam`) | `GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ` |
| A funded testnet account (for *From*) | `GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK` |
| An ordinary, unreported address (for *To*) | `GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57` |
| Explorer | `https://stellar.expert/explorer/testnet` |

**Safe payment XDR** (25 XLM to the ordinary address), for §2:

```
AAAAAgAAAAAY0gqcnifD/QFRi3Um28AFmWZwoXTXZlkgmYh/UZB/SQAAAGQANjQYAAAATAAAAAEAAAAAAAAAAAAAAABqp2PvAAAAAQAAAAZjb2ZmZWUAAAAAAAEAAAAAAAAAAQAAAADqSmxj4pxSCr71UHsTLsX5lUd2rr6+e5JCHuppFEbSLAAAAAAAAAAADuaygAAAAAAAAAAA
```

**Payment-to-scammer XDR** (5 XLM to the reported address), for §2:

```
AAAAAgAAAAAY0gqcnifD/QFRi3Um28AFmWZwoXTXZlkgmYh/UZB/SQAAAGQAAAAA/N5BswAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAA/DDS/k60NmXHQTMyQ9wVRHIOKrZc0pKL7DXoD/H/omgAAAAAAAAAAAvrwgAAAAAAAAAAA
```

Every example card also has **Copy XDR**, so you can get the same text from the page itself.

### Status of the slices when this plan was written

| Section | Slice | State |
|---|---|---|
| §1–§6, §10, §11 | #183, #184 (paste / compose), #185, #186 | Merged to `develop`. They are live once the next release is pushed |
| §7 Report | #187 | **Not built** (waiting on the signer decision). Mark every §7 case **blocked** until it ships |
| §8 AI explainer | #184, explainer part | **Not built** (waiting on `ALLOWED_ORIGINS` and the explain budget). Until then the summary is rules-based: run §8.1, mark §8.2–§8.3 **blocked** |
| §9 Wallet unaffected | #184, explainer part | Runs **after** the `ALLOWED_ORIGINS` change. Blocked until then |
| §10.3 Telemetry | #188 | **Not built.** Mark **blocked** |

## 1. Cold open

| # | Step | Expected |
|---|---|---|
| 1.1 | On a **phone**, in a browser with no Lantern installed (a private tab is fine), open the playground URL | The page loads with a yellow bar: *"Testnet demo — nothing here moves real funds."* Nothing asks you to install, sign in or connect a wallet |
| 1.2 | Same on a **desktop** browser | Same page. On a wide screen the scam registry sits in a column on the right |
| 1.3 | Without any instructions, try to get a verdict for *something* | You reach a verdict (a coloured badge such as *High risk — action needed*) within about a minute, most likely via **Run it** on an example. Write down what you clicked and anything that confused you |
| 1.4 | On the phone, scroll the whole page | Nothing runs off the right edge. No sideways scrolling |
| 1.5 | Click **← Back to golantern.xyz** and the **Lantern** logo | Both go to the golantern.xyz home page. Nothing mentions `lantern.artisam.xyz` anywhere |

## 2. Paste a transaction (#184)

| # | Step | Expected |
|---|---|---|
| 2.1 | **Paste a transaction** tab → paste the *Safe payment XDR* → **Scan it** | **Checked by Lantern** badge; *Risk low · action allow*. The screening line reads *Not in the scam registry* for `GDVEU3…JCZA57`. *What moves* shows one address sending 25 XLM and the other receiving it. The line *effects shown, terms not judged* is there |
| 2.2 | Paste the *Payment-to-scammer XDR* → **Scan it** | **High risk — action needed**; *Risk high · action block_confirm*. A red *Reported address* reason. Screening: *Reported in the scam registry — Scam · N reports · Active* |
| 2.3 | Empty the box → **Scan it** | *"Paste a transaction first."* No spinner stuck on *Scanning…* |
| 2.4 | Type `hello world` → **Scan it** | A plain sentence saying it isn't a transaction. No code, no stack trace, no `Error:` |
| 2.5 | Paste the safe XDR but delete its last 10 characters → **Scan it** | A plain sentence saying it couldn't be read as a Stellar transaction |
| 2.6 | Paste the safe XDR with extra spaces and line breaks in the middle → **Scan it** | Scans exactly as in 2.1: whitespace is ignored |
| 2.7 | Each summary box | Above it: *Summary · rules-based (no AI)* (or *written by Lantern's AI explainer* once §8 ships). The label always says which one wrote it |

## 3. Compose a payment (#184)

| # | Step | Expected |
|---|---|---|
| 3.1 | **Compose a payment** → From: the funded account, To: the ordinary address, Amount `1` → **Scan it** | A verdict (**low / allow** expected) with *What moves* showing 1 XLM. The note under the form says you never enter a key and nothing is submitted. Nothing asks for a key |
| 3.2 | Same, but To: the **reported address**, Amount `5` | **High risk — action needed**, *Reported in the scam registry*. **Hard blocker if it reads anything else while the registry is reachable** |
| 3.3 | From: a made-up but valid-looking address that has never been used on testnet (ask anyone with a Stellar wallet to generate one, or use the lab at `https://lab.stellar.org` → *Create keypair*, public key only) | *"The 'from' account doesn't exist on testnet…"* with a **See the examples** link that jumps to the examples |
| 3.4 | From: `GABC` (too short) | *"The 'from' address isn't a valid Stellar address (G…)."* |
| 3.5 | To: same as From | *"The 'from' and 'to' addresses are the same."* |
| 3.6 | Amount `0`, then `-1`, then `1.12345678`, then `abc` | Each: a sentence asking for an amount greater than zero with at most 7 decimals |
| 3.7 | Amount `99999999999999` | *"That amount is too large for a Stellar payment."* The button returns to **Scan it**, and the page isn't stuck on *Scanning…* |

## 4. Seeded examples (#185)

Click **Run it** on each card, one at a time. Above each result the page says either *Live testnet answer* or *Using cached simulation*.

| # | Example | Expected verdict |
|---|---|---|
| 4.1 | A safe payment | **low / allow**, *Checked by Lantern* |
| 4.2 | **Payment to a reported scammer** (marked *The malicious one*) | **high / block_confirm**, *Reported in the scam registry — Scam · … · Active*. **Hard blocker if not, on every run** |
| 4.3 | Unlimited token approval | **high / block_confirm**, a reason about an unlimited allowance |
| 4.4 | An unverified contract | **high / block_confirm**. The card says this contract isn't deployed, so the call would fail. Reasons include that the call would fail and that the contract is unverified |
| 4.5 | Signer takeover | **high / block_confirm**, reason *Gives up account control* |
| 4.6 | Account merge | **high / block_confirm**, a reason about the entire balance leaving |
| 4.7 | On any card, **Copy XDR**, then paste it into the *Paste a transaction* box → **Scan it** | The same verdict as that card's live run. (Nothing is rigged: the card runs exactly the text it lets you copy) |
| 4.8 | Click **Run it** on *Unlimited token approval*, then immediately on *A safe payment* | The result shown is *A safe payment*: the last card you clicked |
| 4.9 | If any live answer carries *"This differs from the recording"* | Write down the exact text. It means testnet changed (a reset, or the entry was revoked). It is a finding for the team, not a pass |

## 5. Offline

Open the page first, then turn the network off: Wi-Fi off / airplane mode on the phone, or on desktop DevTools → **Network** → **Offline**.

| # | Step | Expected |
|---|---|---|
| 5.1 | **Run it** on each of the six examples | Every one renders a verdict with **"Using cached simulation."** and the recording dates visible. The verdicts match §4.1–§4.6 |
| 5.2 | Example 2 offline | **high / block_confirm**, *Reported in the scam registry*. **Hard blocker if not** |
| 5.3 | Paste the safe XDR → **Scan it** | It **fails closed**: the address reads *Not checked — unverified — Couldn't check: the registry couldn't be reached*, and the risk is **not** low (the badge reads *Caution — review below*). **Hard blocker if it shows *Not in the scam registry* or *Checked by Lantern*** |
| 5.4 | Compose anything → **Scan it** | A sentence that testnet (Horizon) couldn't be reached. Not stuck on *Scanning…* |
| 5.5 | Scam registry → **Refresh** | *"Registry unavailable right now … That doesn't mean nothing has been reported."* **Not** an empty list and **not** a count of 0 |
| 5.6 | Turn the network back on → **Refresh** | The registry list comes back |

## 6. Scam registry panel (#186)

| # | Step | Expected |
|---|---|---|
| 6.1 | Look at the panel on load | *Live from Stellar testnet*, then two numbers: **Addresses reported** and **Reports filed**. Record both, with the date and time |
| 6.2 | Read the labels | The second number says **Reports filed**, and the line under it says admin status changes aren't included. The word *executions* appears nowhere |
| 6.3 | An entry | Shows the **full** address (never shortened), a reason (`Scam`, `Phishing`, …), a status, the report count, *reported by*, and *first reported* / *updated* dates |
| 6.4 | Click an entry's address | stellar.expert **testnet** opens on that address |
| 6.5 | Find a **Disputed** entry, if any | Visibly different from **Active**: grey rather than red, and it says *under dispute: no warning*. Active says *raises a warning*. A line above the list says only Active makes Lantern warn. If none is Disputed, write *none present* |
| 6.6 | Find the reported address from the Reference values | Listed, `Scam`, `Active` |
| 6.7 | Compare **Addresses reported** with the contract on stellar.expert (the *Contract* link at the bottom of the panel) | The contract link opens the registry. The WASM sha256 shown matches the Reference value |
| 6.8 | With more than 50 entries: **Older →** / **← Newer** | 50 per page, newest first. (Fewer than 50 entries: no page buttons, mark N/A) |
| 6.9 | **Refresh** | The panel reloads. It never reloads on its own |

## 7. Report an address (#187) — blocked until #187 ships

| # | Step | Expected |
|---|---|---|
| 7.1 | Happy path: report an address, sign with the wallet the page asks for | A success message with a **stellar.expert** link to the transaction. The address then appears in the registry panel after **Refresh** |
| 7.2 | The reason picker | No reason is pre-selected. You must choose one |
| 7.3 | Before signing | The fee is shown |
| 7.4 | Report an address that is already reported | A warning that it's already reported, before you sign |
| 7.5 | Report your own address | Blocked, with a reason |
| 7.6 | Scan a payment to the address you just reported | Now reads *Reported in the scam registry* |

## 8. Explainer

| # | Step | Expected |
|---|---|---|
| 8.1 | Any scan | A sentence in the summary box, labelled with who wrote it: *rules-based (no AI)* today |
| 8.2 | *(Blocked until the explainer ships)* The same example twice | Labelled *written by Lantern's AI explainer*. The risk and action are the same both times |
| 8.3 | *(Blocked until the explainer ships)* With the Lantern API unreachable (ask the team to block it, or DevTools → Network request blocking on `lantern-api`) | The summary falls back to *rules-based (no AI)*, and **the risk and action are unchanged**. **Hard blocker if the verdict changes** |

## 9. Wallet unaffected — blocked until `ALLOWED_ORIGINS` is set (#184)

This needs the team to confirm in writing that lantern-api's `ALLOWED_ORIGINS` now lists the playground. It is the regression most likely to ship unnoticed.

| # | Step | Expected |
|---|---|---|
| 9.1 | In the **Chrome extension** (latest build), review any send | The review's sentence is the AI one (not rules-based), as before the change |
| 9.2 | Same in the **Android** app | Same |

## 10. Privacy

Desktop browser, DevTools open.

| # | Step | Expected |
|---|---|---|
| 10.1 | DevTools → **Network**, reload the page | Requests go only to `golantern.xyz` and `soroban-testnet.stellar.org`. No fonts or scripts from anyone else (no Google Fonts, no CDN) |
| 10.2 | Run a few examples, paste, compose. Then **Application** → Cookies, Local storage, Session storage, IndexedDB | **All empty.** No cookie, nothing stored. (Composing also contacts `horizon-testnet.stellar.org`. That is expected) |
| 10.3 | *(Blocked until #188 ships)* Page footer and `golantern.xyz/privacy-policy.html` | Both say what the playground counts: only enum values, no addresses, amounts or XDR, and no identifier that links two visits |

## 11. Accessibility

| # | Step | Expected |
|---|---|---|
| 11.1 | Keyboard only (Tab / Shift-Tab / Enter / Space), from the top of the page | Focus goes: logo, back link, the two input tabs, the text box, **Scan it**, then each example's **Run it** and **Copy XDR**, then the registry. Focus is always visible |
| 11.2 | Keyboard only: paste the scammer XDR (Ctrl/Cmd-V) → Tab to **Scan it** → Enter | The verdict appears without using the mouse |
| 11.3 | With a screen reader (VoiceOver on iPhone/Mac, TalkBack on Android, NVDA on Windows), scan an example | The result is announced (it sits in a live region), including the risk |
| 11.4 | Zoom the desktop browser to 200% | Everything is still readable and usable. No text is cut off |

## 12. Results

Fill one row per case: **pass**, **fail** (with a one-line description and a screenshot name), **blocked** (with the reason), or **N/A**.

| # | Result | Notes / screenshot | |
|---|---|---|---|
| 1.1 | | | |
| 1.2 | | | |
| 1.3 | | | **without team support** |
| 1.4 | | | |
| 1.5 | | | |
| 2.1 | | | |
| 2.2 | | | |
| 2.3 | | | |
| 2.4 | | | |
| 2.5 | | | |
| 2.6 | | | |
| 2.7 | | | |
| 3.1 | | | |
| 3.2 | | | **hard blocker** |
| 3.3 | | | |
| 3.4 | | | |
| 3.5 | | | |
| 3.6 | | | |
| 3.7 | | | |
| 4.1 | | | |
| 4.2 | | | **hard blocker** |
| 4.3 | | | |
| 4.4 | | | |
| 4.5 | | | |
| 4.6 | | | |
| 4.7 | | | |
| 4.8 | | | |
| 4.9 | | | |
| 5.1 | | | |
| 5.2 | | | **hard blocker** |
| 5.3 | | | **hard blocker** |
| 5.4 | | | |
| 5.5 | | | |
| 5.6 | | | |
| 6.1 | | | |
| 6.2 | | | |
| 6.3 | | | |
| 6.4 | | | |
| 6.5 | | | |
| 6.6 | | | |
| 6.7 | | | |
| 6.8 | | | |
| 6.9 | | | |
| 7.1 | | | |
| 7.2 | | | |
| 7.3 | | | |
| 7.4 | | | |
| 7.5 | | | |
| 7.6 | | | |
| 8.1 | | | |
| 8.2 | | | |
| 8.3 | | | **hard blocker** |
| 9.1 | | | |
| 9.2 | | | |
| 10.1 | | | |
| 10.2 | | | |
| 10.3 | | | |
| 11.1 | | | |
| 11.2 | | | |
| 11.3 | | | |
| 11.4 | | | |

Reviewer (not on the Lantern team): ______ · Date: ______ · Browser/phone: ______ · Build (commit shown in the release, or the date the URL was opened): ______ · Sign-off: ☐

## Coverage

| Slice | Cases |
|---|---|
| #183 Scaffold (URL, shell, no third-party loads) | 1.1–1.5, 10.1 |
| #184 Paste / compose / live pipeline | 2.1–2.7, 3.1–3.7, 5.3, 5.4, 8.1 |
| #184 Explainer on the public origin (`ALLOWED_ORIGINS`, budget) | 8.2, 8.3, 9.1, 9.2 |
| #185 Seeded examples, cached fallback | 4.1–4.9, 5.1, 5.2 |
| #186 Registry panel | 5.5, 5.6, 6.1–6.9 |
| #187 Report from the demo | 7.1–7.6 |
| #188 Demo telemetry and privacy notice | 10.2, 10.3 |
| All | 11.1–11.4 |

## Notes for the reviewer

- **Testnet is periodically reset.** If the registry suddenly shows 0 addresses, or example 2 reads *"This differs from the recording"*, that is probably a reset. Record it and tell the team: it is not your mistake.
- The public testnet can be slow or rate-limited. If a live run fails, wait a minute and retry once before recording a fail. The seeded examples should still work via *Using cached simulation*.
- Never paste a mainnet transaction, a secret key or a recovery phrase into this page. It only ever needs public addresses and unsigned transactions.
