---
title: Verify it yourself
---
# Verify it yourself

A reviewer packet: how someone outside the team can check three things without trusting us.

1. **The registry contract running on testnet is built from the public source.**
2. **A wallet build you downloaded is the one we published.**
3. **The web app your browser loads is built from the public source.**

All three come down to comparing SHA-256 hashes. Each takes about ten minutes. When you're done, please send us what you got (the section at the end says what).

## 1. The registry contract's bytecode

The claim: the contract at [`CBJWD6SA…G623F`](https://stellar.expert/explorer/testnet/contract/CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F) runs WASM whose SHA-256 is

```
40fd37718c3fbc7f849c4d414364cdd86c01b4db9ab86be9099007ba5be23783
```

This is the hash [the README publishes](https://github.com/kimerran/stellar-lantern#testnet-smart-contracts), and a build of the public source produces the same bytes.

### What you need

- `git` and `sha256sum` (on macOS, `shasum -a 256` does the same).
- **Rust via [rustup](https://rustup.rs).** The repository pins the compiler in `contracts/rust-toolchain.toml` (Rust **1.95.0**, target `wasm32v1-none`), and rustup installs exactly that version the first time you build. A different compiler can produce different bytes, which is why it's pinned.
- **The Stellar CLI, version 26.0.0**, the one the project's CI builds with: [stellar-cli v26.0.0 releases](https://github.com/stellar/stellar-cli/releases/tag/v26.0.0). Check with `stellar --version`.

### Build it from the tagged source

```bash
git clone --depth 1 --branch v0.2.0-testnet.13 https://github.com/kimerran/stellar-lantern.git
cd stellar-lantern/contracts/blacklist-registry
stellar contract build
sha256sum target/wasm32v1-none/release/blacklist_registry.wasm
```

**Expected:** `40fd37718c3fbc7f849c4d414364cdd86c01b4db9ab86be9099007ba5be23783`

The contract's source is unchanged from this tag to the current `main`, so a clone of `main` gives the same hash.

### Fetch what's actually deployed, and compare

```bash
stellar contract fetch --id CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F \
  --network testnet --out-file deployed.wasm
sha256sum deployed.wasm
```

**Expected:** the same hash. This downloads the bytecode from the Stellar testnet itself, not from us. As a third check, the [contract's page on stellar.expert](https://stellar.expert/explorer/testnet/contract/CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F) shows the WASM hash it runs.

### What a match proves

Your build of the public source, the bytes on the ledger, and the README all agree. So the contract anyone can call is this source code, and nothing else.

## 2. A wallet build you downloaded

Wallet builds are served through `https://lantern-api-production-3fad.up.railway.app/download/…`, and each release publishes a `SHA256SUMS.txt` beside them.

```bash
# The build (Chrome extension shown; use /download/android for the APK):
curl -sLOJ https://lantern-api-production-3fad.up.railway.app/download/extension
# The checksums for the same release:
curl -sL https://lantern-api-production-3fad.up.railway.app/download/checksums -o SHA256SUMS.txt
sha256sum --check --ignore-missing SHA256SUMS.txt
```

**Expected:** your file's name followed by `OK`, for example `lantern-extension-0.5.0.zip: OK`. Anything else, `FAILED` or no line at all, means don't install it, and tell us.

## 3. The web app

The wallet also runs in a browser, as a web app at `https://app.golantern.xyz` (testnet only). An extension or an APK is a fixed file you can check once; a website sends its files every time you open it. So the web app publishes the hash of every file it serves, and the same list is committed to the repository beside the files, in `webapp/SHA256SUMS`.

### Rebuild it from the source

```bash
git clone https://github.com/kimerran/stellar-lantern.git
cd stellar-lantern
npm ci
npm run build:web -- --check
```

**Expected:** `build:web: webapp/ is up to date`. This builds the web app from the source and compares the result, byte for byte, with the committed `webapp/`, including `SHA256SUMS`.

### Compare the site with the repository

```bash
cd webapp
# The site's list should be the committed one:
curl -sf https://app.golantern.xyz/SHA256SUMS | diff - SHA256SUMS && echo "lists match"
# Download every file the site serves, then check each one against the list:
mkdir -p ../served && cd ../served
while read -r _ file; do curl -sf --create-dirs -o "$file" "https://app.golantern.xyz/$file"; done < ../webapp/SHA256SUMS
sha256sum --check ../webapp/SHA256SUMS
```

**Expected:** `lists match`, then `OK` on every line. A `FAILED` line means the site is serving something that isn't in the repository, and that's worth telling us about.

### What a match proves

The files the site served you, the files the public source builds, and the committed list all agree. The page also carries a strict Content-Security-Policy (look for it at the top of `webapp/index.html`), so it runs no inline script and no script from any other site.

## Send us your result

For the evidence record, send the Lantern team (hello@artisam.xyz):
- the three hashes from section 1: your build, `deployed.wasm`, and what stellar.expert shows;
- your `stellar --version` and `rustc --version`, and your operating system;
- for section 2, the `sha256sum --check` line;
- for section 3, the `build:web` line and the `sha256sum --check` summary.

If anything doesn't match, that's exactly what this page is for. Please send it too.
