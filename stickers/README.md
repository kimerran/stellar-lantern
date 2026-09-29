# Lantern sticker pack

Eight stickers, one system. See [`brand-brief.md`](brand-brief.md) for the brand decisions and [`preview.html`](preview.html) to see the whole pack on light and dark backgrounds at a common physical scale.

| # | Files | Concept | Final size (cut) | Checks needed |
|---|---|---|---|---|
| 01 | `01-logo.svg` / `.png` | **Logo** — the lantern mark alone, contour die-cut | 1.77 × 2.95 in · 44.9 × 75.0 mm | **Logo trace** — flat redraw of `logo.jpg`; owner sign-off on the redraw |
| 02 | `02-name.svg` / `.png` | **Name** — "Lantern" wordmark, Inter Black | 3.50 × 1.50 in · 88.9 × 38.1 mm | Inter (OFL 1.1) |
| 03 | `03-lockup.svg` / `.png` | **Logo + name** — horizontal lockup, mark standing on the wordmark baseline | 3.50 × 1.50 in · 88.9 × 38.1 mm | Inter; logo trace |
| 04 | `04-tagline.svg` / `.png` | **Tagline** — "Stop getting scammed" | 3.00 × 3.00 in · 76.2 × 76.2 mm | Inter; logo trace |
| 05 | `05-on-stellar.svg` / `.png` | **Lantern on Stellar** — "Stellar" set as text; generic four-point sparkles, not Stellar's mark | 3.00 × 3.00 in · 76.2 × 76.2 mm | Inter; logo trace; **Stellar name usage** |
| 06 | `06-website.svg` / `.png` | **Website** — `golantern.xyz`; 8.9 mm caps / 6.3 mm x-height for reading at ~1 m | 4.00 × 1.50 in · 101.6 × 38.1 mm | Inter; **URL live** |
| 07 | `07-meme.svg` / `.png` | **Meme** — "I reviewed the XDR." + a stamped **LGTM** over a wall of base64 | 3.00 × 3.00 in · 76.2 × 76.2 mm | Inter, Roboto Mono (OFL 1.1); logo trace |
| 08 | `08-built-with-soroban.svg` / `.png` | **Bonus: hex dev badge** — "Built with Soroban" + `is_flagged()` | 1.73 × 1.89 in · 44.0 × 48.0 mm | Inter, Roboto Mono; logo trace; **Soroban name usage** |

Every PNG is 300 DPI, transparent outside the cut line, sized exactly to the cut — for printers that take a PNG and generate their own cut.

## About the meme (07)

The joke: nobody can review a raw transaction XDR, so approving one is the same rubber-stamp **LGTM** developers give a pull request they didn't read. That is exactly the blind-signing problem Lantern exists to solve.

**The XDR is real and complete.** It is the unsigned envelope from `packages/lantern-scanner/fixtures/classic-payment-to-flagged.json`, and decoding it gives:

- operation: **PAYMENT, 5 XLM**
- destination: **`GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ`** — the address flagged in Lantern's on-chain scam registry

So the sticker is a stamped approval of a payment to a reported scammer, and `// decode it` invites developers to find that out. The build refuses to let the stamp cover any of the 192 characters, so the XDR stays decodable. It's testnet fixture data: no real funds, no real person.

## Print notes

- **Layers.** Every SVG has three top-level layers: `white` (the white border, extended into the bleed), `art`, and `cutline`. The cut path has the id **`CutContour`** and a 0.25 pt magenta stroke — the usual convention, but confirm the spot-colour name your printer's RIP expects.
- **Bleed.** Each canvas is the cut size plus 3 mm on every side. The white layer runs to the canvas edge.
- **Text.** Converted to outlines — no fonts needed to print. All text sits inside the keyline, at least 5.7 mm from the cut.
- **Minimums.** No type under 8 pt. No line under 0.25 mm (≈ 0.7 pt; the brief's floor is 0.5 pt). The hex badge's logo lines are optically thickened to stay above it.
- **Colour.** Built in sRGB from the brand palette. None of it is neon, but **ask for a proof of Lantern Amber `#FFC107`**: bright yellow-orange sits near the edge of the CMYK gamut and usually prints a little warmer and duller than on screen. Testnet Sky `#84D5FF` loses some saturation too.
- **Hex (08).** A pointy-top hex, 2 in (50.8 mm) point to point *before* corner rounding. The pack's 9 mm cut radius brings it to 48.0 mm tall, so it won't tile edge-to-edge with standard hexb.in-spec stickers.
- **Logo sticker (01).** The contour cut includes a ~16 mm neck around the hanging rod — well within normal die-cut tolerances.

## Things to verify before printing

1. **The URL.** `golantern.xyz` was confirmed by the owner, but this build environment couldn't reach the domain to check that it loads.
2. **The logo trace.** A flat vector redraw of `logo.jpg`. It keeps every part and proportion (measured from the raster), but the glow gradient becomes flat fills and the globe uses brand amber, not the original's orange gradient.
3. **Stellar and Soroban names.** No official Stellar logo is used anywhere — "Stellar" and "Soroban" are set as plain text in Inter. The wording is limited to factual claims: Lantern runs on Stellar, and its registry is a Soroban contract. Nothing says or implies endorsement by the Stellar Development Foundation. SDF publishes guidelines for its **names** as well as its logos, so check "on Stellar" and "Built with Soroban" against them.
4. **Fonts.** Inter and Roboto Mono are both **SIL Open Font License 1.1**, which allows commercial use, merch included. Neither font file is embedded, since all text is outlined. Licence texts: [Inter](https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt), [Roboto Mono](https://github.com/google/fonts/blob/main/ofl/robotomono/OFL.txt).

## Rebuilding

```bash
pip install fonttools uharfbuzz shapely pillow
python3 stickers/src/build.py          # SVGs
python3 stickers/src/build.py --png    # + 300-DPI PNGs (needs headless Chromium; set CHROME=… if not at the default path)
```

The fonts download into `stickers/src/fonts/` on first run (git-ignored). Every design rule lives in `build.py` as a named constant — plate radius, border, bleed, keyline, logo size and position. Before writing a file, the build checks each sticker for:

- type under 8 pt
- lines under 0.25 mm
- text outside the keyline or within 3 mm of the cut
- off-palette colours
- the meme stamp covering the XDR

It stops with an error on any of them.
