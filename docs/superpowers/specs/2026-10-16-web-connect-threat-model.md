# Web connect: threat model and decision

**Date:** 2026-10-16 · **Status:** decision for product-owner sign-off · issue #247 (slice 1 of epic #246)

## Decision

**Go**, on these terms:

- **Extension only.** The web app and the Android app don't take requests from web pages. Android reaches dApps through WalletConnect instead (#256).
- **Behind a build flag**, so the bundle can leave it out until the slices are done.
- **Testnet only in the first release.** Mainnet needs its own sign-off once the extension and Android slices have passed QA with a real dApp (Paiflow, #294 / #303).
- **Connect and sign-only `signTransaction` first.** `signMessage` (#253) and `signAuthEntry` (#254) come later and get their own review, because each is close to a blind signature.

The decision recorded in week 4 (with #187) was the opposite: "a bridge into it would be exactly the surface wallet phishing attacks". That reasoning still stands, and the whole design below exists to contain it. What changed is the demand. Stellar dApps that already offer Freighter (Paiflow first) want to offer Lantern too, and today they can't. A wallet that can't connect to dApps is used for those dApps with a different wallet, one that doesn't scan.

## What exists today

- **One privileged listener.** `src/background/index.ts` passes every `chrome.runtime.onMessage` request to `handle()`, whatever the sender. The message types include `SIGN_ONLY`, `SIGN_AND_SUBMIT` and wallet management. The safety net today is that only extension pages can send messages. There's no content script, and no `externally_connectable` key, so web pages can't reach the listener.
- **Permissions:** `storage`, plus host access to Horizon, friendbot, Soroban RPC and the Lantern API (`manifest.config.ts`).
- **Embedded dApps** reach Lantern only through the Apps-tab iframe bridge (`src/core/miniapps/bridge.ts`), which checks `event.source` and the origin.
- **`src/core/dapp/sign-xdr.ts`** (#262) already signs a dApp-built envelope without submitting it. It rejects a different network passphrase, undecodable XDR, fee-bump envelopes, and transactions that need no signature from the user.

## Threats and mitigations

### 1. A content script turns into a path to the privileged listener
A content script calling `chrome.runtime.sendMessage` reaches the **same** `onMessage` listener as the popup. If we add one without changing that listener, any page that controls the content script's input could ask for `SIGN_AND_SUBMIT` or a wallet export.

**Rule:**
- The existing listener accepts a message only when `sender.id === chrome.runtime.id` and the origin of `sender.url` is the extension's own (`chrome.runtime.getURL('')`). Content scripts report the page's URL, so they are refused, and Lantern's own popup, tab and approval window still work. Having a `sender.tab` is not the test: the approval window (#249) has one too.
- Web connect uses a **separate** `chrome.runtime.onConnect` port with its own name and its own small set of message types, validated like the bridge's.
- Nothing on that port reaches `handle()` directly. The background turns each request into a queued approval (#249), and only an approval the user gave in Lantern's own window leads to `SIGN_ONLY`.
- A unit test proves that a content-script sender is refused for every existing message type. This is #248's first acceptance item.

### 2. Phishing dApps
A copy of a real dApp asks the user to connect and sign.

- **Show the real origin.** The approval window shows the origin the browser reports (`sender.origin`), in full, with the scheme, and never a name the page supplies. Origins listed in the Apps directory get a "Listed in Lantern" chip; every other origin says "Unverified site".
- **Show what it does.** Every `signTransaction` goes through the full scan, explanation and confirm screens. The registry check covers every counterparty. A high-risk verdict needs the same type-CONFIRM or press-and-hold as in-wallet sends.
- **A failed simulation fails closed:** it's treated as high risk, never low.
- **No domain blocklist yet.** The registry knows addresses, not domains. A bundled blocklist of known drainer domains is a follow-up; until then, a phishing page still has to get past a review that shows its real origin and what the transaction does.

### 3. Clickjacking the approval
A page tricks the user into clicking Approve.

- Approvals open in Lantern's own window (`chrome.windows.create({ type: 'popup' })`), never in the page. The page can't overlay, frame or script that window.
- The Approve button is disabled for the first 600 ms after the window gets focus. Signing keeps its existing hold-to-confirm.

### 4. Request spam and races
A page floods requests, or swaps the request while the user is reading.

- One request is on screen at a time, and each request is fixed when it's queued: its XDR, origin, tab and account can't change after that.
- At most **3** pending requests per origin; a fourth is rejected straight away.
- Closing the tab or navigating away rejects that tab's pending requests.
- Queue state lives in `chrome.storage.session`, so a service-worker restart can't leave a request half-approved.

### 5. Iframes and other tabs
- Lantern answers the **top frame only**: `all_frames: false`, and `sender.frameId === 0` is checked in the background.
- A request from a frame is refused, so a dApp can't be embedded by a phishing page that borrows its origin.
- A grant belongs to an origin, not a tab, so revoking it revokes it in every tab.

### 6. Leaking the address
- Before the user approves a connection, a site learns only that Lantern is installed. Every wallet extension reveals that, and it's how SWK's `isAvailable` works.
- `getAddress` from an unconnected site rejects with `not_allowed`, the same way whether the wallet is locked, empty or set up.
- Grants are per origin, per network and per account (#250). Switching account or network never carries a grant over.

### 7. Blind signatures
- `signTransaction` is sign-only: no sign-and-submit API exists for web pages. The returned envelope has the exact body Lantern was given, and any signatures already on it stay.
- Fee-bump envelopes stay refused, as in `sign-xdr.ts`.
- `signAuthEntry` and `signMessage` are not in the first release.

### 8. Cross-network signatures
- A request whose `networkPassphrase` isn't Lantern's active network is rejected before any window opens.
- Lantern never switches networks on a dApp's behalf. It can only offer the user the switch.
- The first release refuses Mainnet passphrases entirely.

## Permission model

| Option | Lantern detectable before the user acts? | Install warning | Verdict |
|---|---|---|---|
| Static `content_scripts` on `https://*/*` | Yes | "Read and change all your data on all websites" | **Chosen** |
| `optional_host_permissions`, granted per site | No: SWK's wallet list can't see Lantern until the user grants the site from Lantern's menu | None at install | Breaks discovery |
| `activeTab` + `scripting.executeScript` | No: needs a click on the toolbar icon first | None | Breaks the normal "Connect wallet" flow |

The chosen option is what Freighter does (its MV3 manifest runs a content script on `<all_urls>` at `document_start`). The scripts it needs:
- **An isolated-world relay** (`document_start`, top frame only). It never reads the page's DOM, cookies or storage, and only forwards namespaced `postMessage` envelopes after checking `event.source === window`.
- **A main-world script** (`"world": "MAIN"`, Chrome 111+) that defines `window.lantern`.

Development builds add `http://localhost/*`; release builds don't.

What it costs:
- The manifest comment "minimal permissions" and the install guide have to say what the broader permission is for.
- A future Chrome Web Store submission will get a longer review and needs a written justification.
- A Settings switch, **Let websites connect to Lantern** (on by default, #303), for anyone who wants the old behaviour. Off, Lantern answers every page as if it weren't installed: `isConnected` says false and every other call is refused with `not_allowed`, at once rather than after a timeout, so wallet lists don't stall. `window.lantern` itself is still defined (a MAIN-world script can't read Lantern's settings at `document_start`), so a page can still tell the extension is installed; it can't learn anything else or make a request.

## What Lantern will never do for a web page

1. Sign without its own window showing the full review.
2. Sign for a network other than the active one, or for an account the site wasn't granted.
3. Submit a transaction.
4. Reveal the address before the user approves the connection.
5. Remember an approval for **signing**. Connection grants persist; every signature is asked for.
6. Act while locked without asking the user to unlock first.
7. Answer a frame, a non-https origin (outside development builds), or a message that didn't come through the port.
8. Answer `@stellar/freighter-api` calls as if it were Freighter (#257 leans no).

## Web app and Android

- **Web app** (#236, `app.golantern.xyz`): no page API and no dApp requests. Third-party connector code never shares an origin with a stored vault, which is why the web app exists on its own origin, and this keeps it that way.
- **Android:** no content scripts. dApps in the phone's browser reach Lantern over WalletConnect v2 (#256), with registration and deep links in #302. The same rules apply: every request gets the full review, sign-only, one network.

  Android adds its own threats, which #256/#302 must cover:
  - another app registering the `lantern://` scheme, so use a verified App Link for anything that carries a pairing;
  - a dApp lying about its name, so show the domain WalletConnect's Verify API checked, and "Unverified" otherwise.

## Slices this binds

- **#248:** the sender check on the existing listener (extension id and extension-origin URL, not `sender.tab`), a separate port, the build flag, the relay and the main-world script. The Settings switch moves to #250, beside Connected sites: hiding `window.lantern` needs the content scripts registered at runtime, which belongs with the per-site controls.
- **#249:** the approval window, focus delay, per-origin cap of 3, and tab-close cleanup.
- **#250:** grants per origin, network and account; `not_allowed` without leaking state; directory chip versus Unverified.
- **#252:** sign-only; body and existing signatures kept; network and account checks before any window; fail closed.
- **#253, #254:** each needs its own threat note before it ships.
- **#301:** the public connect page publishes the "never" list and the error codes.
