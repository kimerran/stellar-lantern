# Lantern sticker pack — Brand Brief

*Derived from the repository, not invented — sources are cited per field.*

> **Approved 2026-09-29.**
> - Name: **Lantern** · nothing off-limits
> - Website: **`golantern.xyz`** (confirmed)
> - Logo: **flat vector trace** of `logo.jpg` approved
> - Tagline: **"Stop getting scammed"** — the owner's own line, chosen over options A–C below

## 1. Project name

**Lantern** — capital L, one word.

- Extension manifest: `Lantern — Stellar Wallet` (`manifest.config.ts`)
- Package: `lantern-stellar-wallet` (`package.json`)
- Homepage and README: **Lantern**
- ⚠️ `docs/submission-description.md` titles it **Stellar Lantern**. The stickers use *Lantern* unless told otherwise — "Stellar Lantern on Stellar" would not read well on sticker 5.

## 2. The problem, in one sentence

People using Stellar wallets and dApps approve transactions they cannot actually read, so a scam payment or an account-draining contract call looks exactly like a normal one until the money is gone.

*(What Lantern does about it, for context: it simulates and decodes every transaction before signing, explains it in plain language, scores the risk, and checks every recipient against a shared on-chain scam registry — a Soroban contract any wallet can read.)*

## 3. Existing logo

**`logo.jpg`** — 1024 × 1024 JPEG. Copies at `public/logo.jpg` and `homepage/logo.jpg`; extension icons at `public/icons/icon-{16,32,48,128}.png`.

**No vector version exists anywhere in the repo.** The mark is a hanging lantern in thin gold line-work — rod, ring, arched handle, a round glowing globe with a cream flame, a domed base — on a navy rounded-square tile with a soft radial glow.

**Proposal:** a flat vector trace of that exact mark for print (same parts, same proportions, flat fills instead of the glow gradient). JPEG artefacts and 1 %-width lines don't survive enlargement or die-cutting cleanly. This is a redraw of the official mark, so it needs your sign-off.

## 4. Colour palette

All taken from `tailwind.config.ts` / `homepage/styles.css`:

| Role | Name | Hex | Source token |
|---|---|---|---|
| Base | Night Navy | `#0B1326` | `background` / `--bg` |
| Primary | Lantern Amber | `#FFC107` | `primary.container` / `--amber` |
| Highlight | Glow Cream | `#FFE4AF` | `primary.DEFAULT` / `--amber-bright` |
| Text on navy | Mist | `#DAE2FD` | `on-surface` |
| Accent (sparingly) | Testnet Sky | `#84D5FF` | `tertiary.container` |

Plus white (die-cut border) and black (never used as a fill).

**CMYK:** none of these is a neon value. Lantern Amber is the one to proof — bright yellow-orange sits near the edge of the CMYK gamut and usually prints slightly warmer and duller than on screen. Testnet Sky loses a little saturation. Navy, cream and mist convert cleanly.

## 5. Typography

| Role | Font | Why | License |
|---|---|---|---|
| Display | **Inter** — Black / ExtraBold | Already the brand UI font (`fontFamily.sans`) | SIL OFL 1.1 |
| Supporting | **Roboto Mono** — Medium / Bold | Already the brand mono font (`fontFamily.mono`); right for the URL, CLI and code stickers | SIL OFL 1.1 |

Both are on Google Fonts and cleared for commercial print. *(Corrected after approval: Roboto Mono was first listed here as Apache 2.0. Google Fonts now distributes it under the SIL OFL 1.1 — confirmed from `ofl/robotomono/OFL.txt` in the google/fonts repository. Either licence permits printing it on merch.)*

⚠️ The t-shirt artwork made earlier uses **Archivo Black**, which is not a brand font. For one merch identity, the shirt should move to Inter too.

## 6. Visual style

**Flat vector, bold rounded outlines** — the logo is already line-art on a rounded-square tile, and flat fills with rounded shapes print cleanly on vinyl and repeat the app-icon silhouette across the pack.

## 7. Tone

**Calm, confident, dry.** It is a wallet: trust comes first, so no fear-mongering and no alarm-red. The wit lives in the meme sticker and one dev sticker, not everywhere.

---

## Pack system (applies to every sticker)

*As built — `stickers/src/build.py` enforces every rule below and refuses to write a sticker that breaks one.*

- **Artboard:** 3 × 3 in (76.2 mm) cut size unless the shape needs otherwise; 3 mm bleed beyond the cut.
- **Die-cut:** 3 mm white border — the `cutline` is the navy plate offset outward by exactly 3 mm, on its own layer.
- **Base plate:** Night Navy, **corner radius 6 mm on every shape** (so the cut radius is 9 mm). *Changed from the draft's "9 mm, rectangles only" — one radius on every shape, hex included, is what keeps the pack consistent.*
- **Keyline:** 0.5 mm (≈ 1.4 pt) Lantern Amber, 2.2 mm inside the plate edge, on every sticker — including the contour-cut logo.
- **Logo line-art:** scales with the logo but never prints thinner than 0.25 mm (≈ 0.7 pt); small logos get optically thickened lines rather than dropping below that.
- **Logo placement:** on every 3 in square, 16 mm tall, top-centred, 7.5 mm below the plate top. On the hex, the same proportion of the sticker's height. In the lockup it sits left of the wordmark, 2.2× the wordmark's cap height, its base on the text baseline.
- **Type:** Inter for everything display; Roboto Mono only for URL, code and CLI content. Minimum 8 pt. All text is converted to outlines and kept inside the keyline — at least 5.7 mm from the cut.
- **Stellar:** the word *Stellar* set in Inter as text — **no official Stellar logo** — so there is nothing to redraw or recolour. Wording is limited to "on Stellar" / "Built with Soroban"; nothing that implies endorsement by the Stellar Development Foundation.

## Tagline options (sticker 4) — pick one

| | Tagline | Note |
|---|---|---|
| **A** | **Don't sign in the dark.** | Ties the problem to the name; matches the shirt. *Recommended.* |
| B | **Stop signing blind.** | Blunt; "blind signing" is the term devs and crypto people already use. |
| C | **Read it before you sign it.** | Plainest; lands with non-crypto people. |

## Website (sticker 6)

The only product URL in the repo is **`https://golantern.xyz`** — README line 8, the docs-site generator, and the homepage. The sticker would print **`golantern.xyz`**. *Needs your confirmation. This sandbox's network blocks the domain, so I couldn't load it to check.*
