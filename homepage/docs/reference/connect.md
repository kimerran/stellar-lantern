> Markdown twin of https://golantern.xyz/docs/reference/connect/ — index of every page: https://golantern.xyz/docs/llms.txt

# Connect with Lantern (for dApp developers)

How a website connects to the Lantern wallet and asks it to sign. It covers the page API, what Lantern guarantees, the error codes, and the Stellar Wallets Kit module.

## Status

| Piece | Status |
|---|---|
| Chrome extension: `window.lantern` page API, connect, `signTransaction` | **Shipped in 0.7.0** (testnet builds). |
| Stellar Wallets Kit module (kit 1.x and 2.x) | **Built.** One file you can copy in; see below. Not yet upstream in the kit. |
| Android app, over WalletConnect v2 | **Planned.** Not in any build. |
| Web app (`app.golantern.xyz`) | Takes no requests from websites, by design. |
| `signAuthEntry`, `signMessage` (SEP-53) | Not supported. Calls reject with `unsupported`. |
| Mainnet | Not supported. The first release connects on **Testnet only**. |
| SEP-7 links | Not supported. Don't show Lantern for SEP-7. |

Lantern 0.6.3 and earlier don't have any of this.

## Detection

The extension adds `window.lantern` to every https page before the page's own scripts run, in the top frame only (not in iframes). It's frozen and can't be replaced.

```js
if (window.lantern?.isLantern) {
  const { isConnected, apiVersion } = await window.lantern.isConnected(); // { isConnected: true, apiVersion: 1 }
}
```

If the user switched off **Let websites connect to Lantern** in Lantern's Settings, `isConnected()` answers `{ isConnected: false, apiVersion }` and every other call rejects with `not_allowed`. Treat Lantern as not installed.

`apiVersion` is `1`. It changes only when a method or a response shape changes in a way that breaks callers. The extension's id is `iflpkjgolcbleombhldiibhojohjpnmd`, the same for every install.

## Methods

Every method returns a promise. Failures throw a `LanternError` with a stable `code` and a `message` meant for people.

| Method | Returns | Needs |
|---|---|---|
| `isConnected()` | `{ isConnected: true, apiVersion }` | nothing (it means "Lantern is installed") |
| `requestAccess()` | `{ address }` | the user approves in Lantern's window, unless this site is already connected for the current account and network |
| `getAddress()` | `{ address }` | a connected site |
| `getNetwork()` | `{ network: 'TESTNET', networkPassphrase }` | a connected site |
| `getNetworkDetails()` | `{ network, networkPassphrase, networkUrl, sorobanRpcUrl }` | a connected site; the URLs are the ones Lantern actually uses, including the user's own servers if they set any |
| `signTransaction(xdr, { networkPassphrase?, address? })` | `{ signedTxXdr, signerAddress }` | a connected site, then the user approves in Lantern's window |
| `signAuthEntry`, `signMessage` | rejects with `unsupported` | |
| `on('change', cb)` / `off('change', cb)` | | `cb({ reason })` with `reason` one of `account`, `network`, `revoke`. Call `getAddress()` again when it fires. |

How long a call waits before it rejects with `timeout`:
- `requestAccess`, `signTransaction`, `signAuthEntry` and `signMessage` wait 10 minutes, so the user has time to read the review.
- Everything else waits 15 seconds.

## Connecting

- Connecting is per **site, account and network**. If the user switches account or network in Lantern, the site has to connect again.
- A site that isn't connected learns nothing: `getAddress()` rejects with `not_allowed` the same way whether Lantern has a wallet or not, and whether it's locked or not.
- The approval window shows the site's full origin, as the browser reports it. Sites listed in Lantern's Apps directory are marked **Listed in Lantern**; every other site is marked **Unverified site**.
- Users can disconnect a site in Lantern's Settings, under Connected sites. The site's open tabs then get a `change` event with `reason: 'revoke'`.

## Signing: what Lantern guarantees

`signTransaction` is **sign-only**:

1. Lantern **never submits** the transaction. Your app submits it and checks the result.
2. The returned envelope has **exactly the transaction body you sent**, so the same hash. Lantern doesn't re-prepare it, change the fee, or bump the sequence.
3. **Signatures already on the envelope stay**, for example a sponsor's. Lantern adds one signature, from the connected account.
4. Before showing the user anything, Lantern refuses:
   - a site that isn't connected (`not_allowed`);
   - an `address` other than the connected account (`account_mismatch`);
   - a `networkPassphrase` other than the network Lantern is on (`network_mismatch`);
   - XDR that doesn't decode, a **fee-bump** envelope, or a transaction this account doesn't need to sign (`invalid_request`).

   Leaving out `networkPassphrase` means "the network Lantern is on".
5. Every request that passes is **scanned and explained** in Lantern's window: who signs which operation, what the transaction does, and its risk. High-risk transactions need an extra confirmation. Lantern simulates the transaction again right before signing, and stops if the result got worse.

**Fee bumps:** send the inner transaction, and wrap it in the fee bump after Lantern returns it.

**Supported envelopes:** classic transactions with any number of operations, where the connected account is the transaction source or an operation source, and Soroban `invokeHostFunction` transactions that have already been simulated and assembled. The XDR can be up to 200,000 characters.

**One request at a time:** Lantern shows one request at a time. At most 3 can wait per site; a fourth is refused with `busy`.

## Error codes

| `code` | When | Suggested handling |
|---|---|---|
| `user_rejected` | The user said no, or closed Lantern's window. `message` is always `User rejected the request`. | Treat as cancelled. Don't retry on your own. |
| `not_allowed` | The site isn't connected, Lantern is on Mainnet, or the user turned websites off in Lantern's Settings. | Call `requestAccess()`. If that also fails with `not_allowed`, show its `message`: it says whether to switch to Testnet or turn websites on. |
| `account_mismatch` | `address` isn't the connected account. | Call `getAddress()` and rebuild the transaction. |
| `network_mismatch` | The passphrase isn't Lantern's network. | Ask the user to switch networks in Lantern. |
| `invalid_request` | Malformed call, undecodable XDR, fee bump, or not this account's transaction. | Fix the request. |
| `unsupported` | A method this version doesn't support. | Hide that feature for Lantern. |
| `busy` | Too many waiting requests from this site. | Wait for the open request to finish. |
| `timeout` | No answer in time. | The outcome is unknown: don't sign the same transaction again without checking. |
| `connection_lost` | The extension restarted or was updated while the call was open. | Same as `timeout`. |
| `internal` | A bug in Lantern. Nothing signed left Lantern. | Retry once, then report it. |

## Stellar Wallets Kit

Most Stellar dApps get their wallet list from [Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit). Lantern's module is a single file with no imports, MIT-licensed: [`lantern.module.ts`](https://github.com/kimerran/stellar-lantern/blob/main/packages/lantern-wallets-kit-module/src/lantern.module.ts) in Lantern's public repository. Copy it into your app until it's upstream in the kit. It works with kit 1.x (tested on 1.9.5) and 2.x (typed against 2.7.0).

```ts
import { StellarWalletsKit, WalletNetwork, FreighterModule, FREIGHTER_ID } from '@creit.tech/stellar-wallets-kit';
import { LanternModule } from './lantern.module';

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: [new FreighterModule(), new LanternModule()],
});
```

The module turns Lantern's errors into the kit's `{ code, message, ext }` shape:
- `user_rejected` becomes **-4**;
- `not_allowed` and `account_mismatch` become **-3**;
- everything else becomes **-1**.

Lantern's own code is kept in `ext`. `signTransaction(xdr, { submit: true })` is refused, because Lantern signs only. The wallet icon is `https://golantern.xyz/wallet-icon.png` (180 × 180).

## Android (planned)

Lantern for Android will connect over WalletConnect v2, using the `stellar` namespace, the chain `stellar:testnet`, and the method `stellar_signXDR` (sign-only). Its wallet id, deep link and universal link will be listed here once it's in a build. Until then, don't list Lantern in a mobile wallet picker.

## Verifying a build

Each release publishes its builds and a `SHA256SUMS.txt`; see [Verify it yourself](/docs/reference/verify/). The extension's id is `iflpkjgolcbleombhldiibhojohjpnmd`. The Android package is `com.lantern.wallet`; its signing-certificate fingerprint will be published here with the first release that supports connecting.
