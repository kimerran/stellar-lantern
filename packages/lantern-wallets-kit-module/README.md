# Lantern for Stellar Wallets Kit

A wallet module that puts **Lantern** in the wallet picker of any dApp built on
[`@creit.tech/stellar-wallets-kit`](https://github.com/Creit-Tech/Stellar-Wallets-Kit).
One file with no imports (`src/lantern.module.ts`), MIT-licensed. Copy it into your
codebase until it's upstream in the kit.

It works with kit **1.x** (tested on 1.9.5) and **2.x** (typed against 2.7.0).

## What Lantern does

- Lantern is a Chrome extension. On every https page it adds `window.lantern`, and
  this module talks to that.
- Every request opens **Lantern's own window**. Connecting asks once per site,
  account and network. **Every signature** is asked for separately, after Lantern
  has scanned the transaction and explained it in plain words.
- **Sign-only:** Lantern returns the signed XDR and never submits it.
  `signTransaction(xdr, { submit: true })` is refused.
- **Testnet only** in this version. `signAuthEntry` and `signMessage` aren't
  supported yet.

## Use it

```ts
import { StellarWalletsKit, WalletNetwork, FreighterModule, FREIGHTER_ID } from '@creit.tech/stellar-wallets-kit';
import { LanternModule } from './lantern.module';

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: [new FreighterModule(), new LanternModule()],
});

// The user picks Lantern in the kit's modal, then:
const { address } = await kit.getAddress(); // Lantern asks the user to connect this site
const { signedTxXdr } = await kit.signTransaction(xdr, {
  networkPassphrase: WalletNetwork.TESTNET,
  address,
});
// Submit signedTxXdr yourself.
```

## Errors

Errors use the kit's `{ code, message, ext }` shape, with Lantern's own code in `ext`:

| `code` | `ext` | Meaning |
|---|---|---|
| -4 | `user_rejected` | The user said no or closed Lantern's window. `message` is always "User rejected the request". |
| -3 | `not_allowed` | The site isn't connected (call `getAddress()` first), or this is Mainnet. |
| -3 | `account_mismatch` | `address` isn't the account this site is connected to. |
| -1 | `network_mismatch` | The passphrase isn't the network Lantern is on. |
| -1 | `invalid_request` | The XDR doesn't decode, is a fee bump, or doesn't need this account's signature. |
| -1 | `unsupported` | Not supported in this version (`signAuthEntry`, `signMessage`, `submit`). |
| -1 | `busy`, `timeout`, `connection_lost`, `internal` | Too many waiting requests; no answer in 10 minutes; the extension restarted; a bug. |

## Icon

`https://golantern.xyz/wallet-icon.png`, 180 × 180, hosted by Lantern.
