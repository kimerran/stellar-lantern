# Mini-app bridge protocol

How a dApp running inside Lantern's **Apps tab** talks to the wallet. Lantern
doesn't inject a provider or speak WalletConnect: it frames the dApp in an
`<iframe>` and answers `window.postMessage` requests from it. This page is the
contract; you shouldn't need to read Lantern's bundle to integrate.

Source: `src/popup/screens/Apps.tsx` (the `Browser` component) and
`src/core/miniapps/bridge.ts` (request validation). Shipped in the Chrome
extension and the Android app; the web app (app.golantern.xyz) lists bundled
mini-apps only, so a remote dApp never runs there.

## Messages at a glance

| dApp sends | Lantern replies | Needs a connection |
|---|---|---|
| `{ type: "lantern:getPublicKey" }` | `lantern:connecting` at once, then `lantern:publicKey { publicKey, network }` or `lantern:connectRejected` | No (this is the connection) |
| `{ type: "lantern:signMessage", message }` | `lantern:messageSigned { signature, publicKey }` or `lantern:signRejected { error? }` | Yes |
| `{ type: "lantern:signAndSubmit", intent }` | `lantern:signing` once the intent is valid, then `lantern:txResult { hash }` or `lantern:txRejected`; `lantern:txError { error }` at any point before review | Yes |
| `{ type: "lantern:signXdr", xdr, networkPassphrase, id? }` | `lantern:signing` at once, then `lantern:xdrSigned { signedXdr }`, `lantern:signRejected { error? }` or `lantern:txError { error }` (see below) | Yes |

Every message is a plain object whose `type` starts with `lantern:`. Lantern
ignores any message it doesn't recognise, and anything without a `type`.

## Frames, origins and trust

- **Who Lantern listens to.** Only messages whose `event.source` is the frame
  of the app currently open, and whose `event.origin` is one Lantern expects:
  `"null"` for an opaque frame, or one of a session app's origins (below).
  Messages from any other window or origin are dropped.
- **How Lantern replies.** `frame.contentWindow.postMessage(reply, target)`.
  For an opaque frame `target` is `"*"`: its origin is `"null"`, which can't be
  named. For a session app it is never `"*"`: it's the `event.origin` of the
  latest message Lantern accepted from the frame when that origin is one of the
  app's, otherwise the origin of the URL Lantern opened. Either way, **check the
  sender yourself**: accept only messages where `event.source === window.parent`
  and `event.origin` is a Lantern origin you trust.
- **Lantern's origin**, i.e. the `event.origin` of its replies:
  - Chrome extension: `chrome-extension://iflpkjgolcbleombhldiibhojohjpnmd` (a fixed id in
    builds after 0.6.2; earlier builds' id came from the folder each person loaded them
    from, so it differed per install). The key that fixes this id ships in every
    manifest, so a sideloaded extension can claim the same id, and on a user's
    machine take over the wallet stored under it. An origin match tells you which
    page framed you, not who wrote it: never treat it as authentication.
  - Android: `https://android.golantern.xyz` (its own origin in builds after 0.5.1;
    earlier builds used Capacitor's shared `https://localhost`, so don't trust that)
  - Web app: `https://app.golantern.xyz` (bundled mini-apps only)
- **Sandbox.** Remote dApps (directory entries with a `url`, and anything opened
  from the URL bar) load with `sandbox="allow-scripts allow-forms allow-popups"`:
  no `allow-same-origin`, so your page has an opaque origin (`event.origin` of
  your own messages is `"null"`), and no cookies or storage that survive.
  Bundled first-party mini-apps load unsandboxed from Lantern's own origin.
- **Session apps** (directory entries marked `session`, e.g. Centient) also get
  `allow-same-origin`, so they run at their real origin and can keep a login.
  Lantern never grants it to one of its own origins.
- **An app's origins.** A directory entry's origins are its `url`'s origin plus
  any extra https origins it lists in `origins`: hosts that serve the same app.
  Centient opens at `https://beta.centient.work/` and also lists
  `https://centient.work`. Every per-origin rule uses the whole set:
  - a session frame may message Lantern from any of them, so the bridge keeps
    working if your page redirects from one to another, and replies follow it
    there; any other origin (`https://evil.centient.work`) is refused;
  - an "Open in Lantern" link (`lantern://open?url=…`) opens only a URL whose
    origin is exactly one of them, and opens that URL;
  - the Android app's `asset_statements` list all of them, so
    `navigator.getInstalledRelatedApps()` can see Lantern on each (your web
    manifest must still name `com.lantern.wallet` in `related_applications`).
  Origins only: no paths, wildcards or other subdomains. Adding one is a
  directory change plus `npm run android:assets`, so it ships with a release.
- **Many sites refuse to be framed** (`X-Frame-Options`, CSP
  `frame-ancestors`). Lantern can't read those headers; it shows *This site
  can't be embedded* with an *Open in a new tab* button instead.

## Requests have no id

Replies carry no request id (except `lantern:signXdr`'s, below), so run **one
request at a time** and match a reply by its `type`. While a transaction review
is open or a signature is in flight, a new `lantern:signXdr` or
`lantern:signAndSubmit` is refused with `lantern:txError`
`"Another request is waiting for review."` and the open review is left as it
is. Time out on your side: the user can leave a prompt open indefinitely.

## Connection

A dApp is *connected* once the user approves `lantern:getPublicKey`. The grant
lasts while that app stays open, including across Lantern's reload button. It
resets (and the user is asked again) when the app is closed, a different app is
opened, or the user switches account or network. `signMessage` and `signAndSubmit` sent before
a connection are refused with the error `"Connect the wallet first."`.

## `lantern:getPublicKey`

Ask for the user's address and network.

```js
parent.postMessage({ type: "lantern:getPublicKey" }, "*");
```

| Reply | Fields | When |
|---|---|---|
| `lantern:connecting` | none | Immediately, before the prompt. Wait for the user after this. |
| `lantern:publicKey` | `publicKey`: the user's `G…` address. `network`: `"TESTNET"` or `"PUBLIC"`, Lantern's network id. | The user approved, or the app is already connected (then it follows `connecting` at once, with no prompt). |
| `lantern:connectRejected` | none | The user declined. |

Only the address and network are shared. Check `network` against the network
you expect and tell the user to switch in Lantern if it differs.
A directory entry can also name the networks its app runs on (`networks` in
`src/core/miniapps/directory.ts`). When Lantern is on another network, the
Apps tab still lists the app but marks it with a chip, e.g. "Testnet" for a
testnet-only dApp while Lantern is on mainnet. The chip is only a label: the
bridge still reports Lantern's real network, so your own check still applies.

## `lantern:signMessage`

Sign an arbitrary text message, to prove the user controls the address
(sign-in challenges). No funds move. **This format is frozen** (#265): sign-in
at existing dApps, such as Centient, verifies it exactly as below.

```js
parent.postMessage({ type: "lantern:signMessage", message: "Sign in to Example\nnonce: 3f2a…" }, "*");
```

| Field | Type | Notes |
|---|---|---|
| `message` | string | Required. Shown to the user as text. A non-string `message` is ignored (no reply). |

| Reply | Fields | When |
|---|---|---|
| `lantern:messageSigned` | `signature`: base64 of the 64-byte ed25519 signature. `publicKey`: the signing `G…` address. | The user tapped **Sign**. |
| `lantern:signRejected` | none | The user tapped **Reject**. |
| `lantern:signRejected` | `error`: string | Not connected (`"Connect the wallet first."`) or the signer failed, e.g. `"Wallet is locked."`. |

**What is signed:** the UTF-8 bytes of the fixed prefix followed by the message,
**not hashed**:

```
signature = ed25519_sign( UTF-8( "Lantern signed message:\n" + message ) )
```

The prefix keeps a signed message from ever being a valid transaction
signature. **This is not SEP-53** (which signs
`SHA-256("Stellar Signed Message:\n" + message)`). Verify it like this:

```js
import { Keypair } from "@stellar/stellar-sdk";

function verifyLanternMessage(address, message, signatureB64) {
  const sig = Buffer.from(signatureB64, "base64");
  if (sig.length !== 64) return false;
  const signed = Buffer.concat([Buffer.from("Lantern signed message:\n", "utf8"), Buffer.from(message, "utf8")]);
  return Keypair.fromPublicKey(address).verify(signed, sig);
}
```

Always verify against the address you connected, not just the `publicKey` in
the reply. Test vector (`tests/sign-message-format.test.ts`): the key with
ed25519 seed `0x07 × 32` (`GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57`)
signing `"Centient sign-in\nnonce: 3f2a9c1e-0b7d-4e55-9a61-7c2d8e4f1b90"` gives
`gjcodILf2PMv2oaOf3b6lOs3cKbIbJpu1F74p5s3l5LG1ja/NTOFsKug18iCBKUkgOMHUCp5e5fewthMbSclAw==`.

**SEP-53** will be a separate method (`lantern:signMessageSep53` on this bridge,
and `signMessage` in the web-connect API, #253). `lantern:signMessage` will not
change.

## `lantern:signAndSubmit`

Ask Lantern to make a payment. You send an *intent*, not a transaction: Lantern
builds it from the user's account, runs it through the security review, signs it
and submits it to the network.

```js
parent.postMessage({
  type: "lantern:signAndSubmit",
  intent: { destination: "G…", amount: "10", memo: "order 42", asset: { code: "USDC", issuer: "G…" } },
}, "*");
```

| `intent` field | Type | Notes |
|---|---|---|
| `destination` | string | Required. A valid `G…` address. |
| `amount` | string or number | Required. Greater than zero, in whole units (`"10"` is 10 XLM). |
| `memo` | string | Optional text memo, at most 28 bytes UTF-8. Trimmed; an empty memo is dropped. |
| `asset` | `{ code, issuer }` | Optional; omit for XLM. `code` non-empty, `issuer` a valid `G…` address. |

| Reply | Fields | When |
|---|---|---|
| `lantern:txError` | `error`: string | The intent is invalid (no `signing` is sent first; errors include `"Invalid destination address."`, `"Invalid amount."`, `"Amount must be greater than zero."`, `"Memo must be 28 bytes or fewer."`, `"Invalid asset issuer."`), not connected, the destination doesn't exist and the asset isn't XLM, or the transaction couldn't be prepared (`"Could not prepare the transaction."`). |
| `lantern:signing` | none | The intent is valid; Lantern is building and reviewing it. Wait for the user after this. |
| `lantern:txResult` | `hash`: the transaction hash | Signed and accepted by the network. |
| `lantern:txRejected` | none | The user rejected it (button or Escape). |

A payment to an account that doesn't exist yet becomes a `createAccount`
(XLM only). The review sheet shows the plain-language explanation and risk
verdict; a high-risk transaction needs a typed `CONFIRM` or a press-and-hold,
and is re-checked just before signing. If submission fails, the error is shown
to the user in Lantern, who can retry or reject; the dApp hears nothing until
one of those happens.

Contract calls (Soroban) aren't exposed on the bridge.

## `lantern:signXdr`

Sign a transaction the dApp built (and may already have signed, e.g. as a fee
sponsor) and return it **without submitting**. Lantern keeps the signatures
already on the envelope and adds the user's. Builds before this one ignore the
message, so treat no `lantern:signing` within 5 s as "this Lantern can't sign
transactions".

| dApp sends | Lantern replies |
|---|---|
| `{ type: "lantern:signXdr", xdr, networkPassphrase, id? }` | `{ type: "lantern:signing" }` **at once**, then `{ type: "lantern:xdrSigned", signedXdr }`, or `{ type: "lantern:signRejected", error? }` (the user said no), or `{ type: "lantern:txError", error }` (refused or failed) |

- The app must be connected first (`lantern:getPublicKey`).
- Refused before review, with `lantern:txError`: a `networkPassphrase` other
  than Lantern's active network; XDR that doesn't decode as a transaction
  envelope; a **fee-bump** envelope (send the inner transaction and wrap it
  after Lantern returns it); and a transaction that needs no signature from
  the user.
- Otherwise it goes through the same review as `signAndSubmit`: every
  operation is explained, including which ones need the user's signature and
  which are someone else's (e.g. a sponsor's), and a high-risk verdict needs
  the typed CONFIRM or press-and-hold.
- Every reply echoes the request's `id` when it has one (a non-empty string of
  up to 128 characters, or a finite number).
- One request at a time (see *Requests have no id*).

## Bundled mini-apps

First-party mini-apps (`public/miniapps/`) get the user's address as a query
parameter (`?addr=G…`) for display, and can use the same bridge for anything else.
