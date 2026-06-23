# Lantern — Stellar Wallet (Chrome Extension)

A non-custodial browser-extension wallet for the [Stellar](https://stellar.org) network.
Create or import a wallet, view balances, send assets, and review history — keys never
leave the device and are encrypted at rest behind a password.

## Stack

TypeScript (strict) · React 18 · Tailwind CSS · Vite + `@crxjs/vite-plugin` (MV3) ·
`@stellar/stellar-sdk` · `bip39` + `stellar-hd-wallet` (SEP-0005) · Web Crypto (AES-GCM / PBKDF2).

## Commands

```bash
npm install        # install deps
npm run dev        # Vite dev build, watch mode (loadable unpacked from dist/)
npm run build      # typecheck + production build → dist/
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run test       # vitest run
npm run icons      # regenerate extension icons
```

## Load in Chrome

1. `npm run build`
2. Open `chrome://extensions` → enable **Developer mode**
3. **Load unpacked** → select the `dist/` folder
4. Pin **Lantern** and open the popup.

## Architecture

- **`src/popup/`** — React UI (Onboarding, Unlock, Assets, Activity, Send). Never holds
  the decrypted secret in state.
- **`src/background/`** — MV3 service worker. Owns the unlocked session: decrypts on unlock,
  keeps the `Keypair` in memory, signs/submits transactions, auto-locks. Treated as ephemeral
  (re-unlock required if the worker is torn down).
- **`src/core/`** — framework-agnostic, unit-tested logic: `crypto/` (vault), `wallet/`
  (SEP-0005 derivation), `stellar/` (network-aware Horizon client + tx builders), `history/`
  (operation → display model).
- **`src/shared/`** — types, the popup↔worker messaging contract, storage wrapper, constants,
  formatting.

### Component diagram

```mermaid
flowchart TB
    user([User])

    subgraph ext["Lantern Extension (MV3)"]
        subgraph popup["Popup — src/popup/"]
            ui["React UI<br/>Onboarding · Unlock · Assets<br/>Activity · Send · Scan"]
        end
        subgraph worker["Service Worker — src/background/"]
            session["Unlocked session<br/>in-memory Keypair<br/>sign · submit · auto-lock"]
        end
        subgraph core["Core — src/core/"]
            crypto["crypto/ — AES-GCM vault"]
            wallet["wallet/ — SEP-0005"]
            stellar["stellar/ — client + tx"]
            history["history/ — display model"]
            scan["scan/ — tx scan engine"]
        end
        shared["shared/ — types · messaging · storage · format"]
    end

    storage[("chrome.storage<br/>encrypted vault only")]
    horizon["Horizon / RPC<br/>+ Friendbot"]
    network(("Stellar Network"))

    user --> ui
    ui <-->|"messaging contract"| session
    ui --> shared
    session --> shared
    session --> crypto
    session --> wallet
    session --> stellar
    session --> history
    session --> scan
    crypto <--> storage
    stellar --> horizon
    horizon --> network
```

### Sequence — unlock & send a payment

```mermaid
sequenceDiagram
    actor U as User
    participant P as Popup (UI)
    participant W as Service Worker
    participant V as core/crypto (vault)
    participant S as core/stellar
    participant H as Horizon / RPC

    U->>P: Enter password (Unlock)
    P->>W: UNLOCK { password }
    W->>V: decrypt vault
    V-->>W: Keypair (held in memory)
    W-->>P: UNLOCKED (no secret leaves worker)

    U->>P: Enter destination + amount, confirm
    P->>W: SIGN_AND_SUBMIT { tx params }
    W->>S: build transaction
    S-->>W: unsigned XDR
    W->>W: sign with in-memory Keypair
    W->>H: submit signed XDR
    H-->>W: result (hash / error)
    W-->>P: result
    P-->>U: success + updated balance
```

## Security notes

- Only the **encrypted** vault (AES-GCM, PBKDF2 ≥ 600k iterations) is persisted; the decrypted
  secret lives solely in worker memory while unlocked.
- No secret material is ever logged, persisted in plaintext, or sent to the popup beyond the
  transient onboarding display of a freshly generated phrase.
- Minimal permissions: `storage` plus host access limited to the Horizon + Friendbot endpoints.
- Testnet vs Mainnet is always visually distinct (BRAND §8).

## Networks

Toggle Testnet/Mainnet from the top app bar. On Testnet, unfunded accounts can be funded via
Friendbot; on Mainnet they show a base-reserve explainer.

## Roadmap

Lantern today is a focused, non-custodial wallet. The next phases extend it from "hold and
send" into a safer, programmable surface for the Stellar ecosystem.

### AI-powered security scans

Before a user signs anything, Lantern will run the request through an AI-assisted review layer
that explains *what the user is actually about to authorize* in plain language and flags risk.

- **Transaction intent analysis** — decode the operations in a transaction (payments, trustline
  changes, offers, account merges, `setOptions`) and summarize them in human terms, highlighting
  irreversible or high-impact actions (e.g. removing a signer, raising/lowering thresholds,
  draining XLM below reserve).
- **Soroban contract scanning** — for contract invocations, inspect the called contract,
  arguments, and authorization entries; warn on unlimited token allowances, unexpected
  authorizers, or interactions with contracts not seen before.
- **Address & asset reputation** — cross-check destinations and assets against allow/deny lists
  and heuristics (known scam addresses, look-alike/homoglyph asset codes, unverified issuers)
  and surface a clear trust signal.
- **Phishing & dApp-origin checks** — validate the requesting site's origin against the
  transaction it asks for, catching mismatches and spoofed connection prompts.
- **Privacy-preserving by design** — scans run with the minimum data needed and never expose
  secret key material; on-device heuristics handle the common cases, with optional cloud-assisted
  analysis the user can opt into.

The goal is a "second pair of eyes" at signing time that turns opaque XDR into an informed
decision, without taking custody or blocking the user from proceeding.

#### Sequence — scan before signing

```mermaid
sequenceDiagram
    actor U as User
    participant P as Popup (UI)
    participant W as Service Worker
    participant SC as Scan Engine
    participant LO as Local heuristics<br/>(decode · reputation lists)
    participant AI as AI analysis<br/>(opt-in, cloud)

    U->>P: Initiate / paste transaction
    P->>W: REVIEW { xdr }
    W->>SC: scan(xdr)
    SC->>LO: decode ops, check addresses/assets
    LO-->>SC: intent summary + heuristic flags
    opt User opted into cloud analysis
        SC->>AI: minimal request context
        AI-->>SC: risk assessment + rationale
    end
    SC-->>W: verdict { summary, risk, warnings }
    W-->>P: render scan result
    P-->>U: plain-language review + risk callout
    alt User confirms
        U->>P: Approve
        P->>W: SIGN_AND_SUBMIT
    else User cancels
        U->>P: Reject (nothing signed)
    end
```

### Mini-app browser for Stellar dApps

Lantern will host an in-wallet **mini-app browser** so Stellar dApps can run inside a trusted,
permissioned container instead of arbitrary web tabs — the wallet, identity, and signing context
travel with the user.

- **Sandboxed runtime** — mini-apps load in an isolated frame with no direct access to the vault
  or service worker; all chain interactions go through a brokered, capability-scoped API.
- **Standard connection layer** — a wallet API (aligned with Stellar interop standards such as
  SEP-0043 / Wallet Standard and Soroban RPC) for connecting, requesting the public key,
  building, and signing transactions — so existing dApps integrate with minimal changes.
- **Per-app permissions** — users grant scoped, revocable permissions per mini-app (which
  network, which accounts, spending/allowance limits, which operations), reviewable from a single
  place.
- **Every action runs through the security-scan layer** — mini-app transaction requests are
  reviewed by the AI scans above before any signing prompt, so a compromised or malicious app
  still can't slip an opaque transaction past the user.
- **Discovery & curation** — a vetted directory of Stellar dApps (DeFi, payments, NFTs, anchors)
  with metadata, verification badges, and clear network/permission expectations before launch.
- **Seamless UX** — connect once, switch accounts and networks without re-pasting addresses, and
  keep history and balances in sync across the wallet and the apps the user runs.

#### Architecture — mini-app container

```mermaid
flowchart TB
    subgraph ext["Lantern Extension"]
        direction TB
        subgraph sandbox["Sandboxed mini-app frame"]
            dapp["Stellar dApp<br/>(isolated, no vault access)"]
        end
        broker["Connection broker<br/>capability-scoped wallet API<br/>(SEP-0043 / Wallet Standard)"]
        perms["Per-app permissions<br/>network · accounts · limits · ops"]
        scan["AI security-scan layer"]
        worker["Service Worker<br/>in-memory Keypair · sign · submit"]
    end
    dir["Curated dApp directory<br/>verification badges"]
    rpc["Soroban RPC / Horizon"]
    network(("Stellar Network"))

    dir -.launch.-> sandbox
    dapp <-->|"request: connect / getPublicKey / signTx"| broker
    broker --> perms
    broker --> scan
    scan --> worker
    worker --> rpc
    rpc --> network
```

#### Sequence — mini-app requests a signature

```mermaid
sequenceDiagram
    actor U as User
    participant D as Mini-app (sandbox)
    participant B as Connection broker
    participant PM as Permissions
    participant SC as Scan Engine
    participant W as Service Worker
    participant H as Soroban RPC / Horizon

    D->>B: connect()
    B->>PM: check / prompt for grant
    PM-->>B: scoped permission (revocable)
    B-->>D: public key

    D->>B: signTransaction(xdr)
    B->>PM: within granted scope?
    PM-->>B: allowed
    B->>SC: scan(xdr)
    SC-->>B: verdict { summary, risk }
    B->>U: review + risk callout
    alt User approves
        U-->>B: approve
        B->>W: sign with in-memory Keypair
        W->>H: submit
        H-->>W: result
        W-->>B: result
        B-->>D: signed result / hash
    else User rejects
        U-->>B: reject
        B-->>D: error (nothing signed)
    end
```

Together these make Lantern a place to *use* Stellar safely, not just store it — programmable
surface for dApps, with an AI safety net between the user and every signature.
