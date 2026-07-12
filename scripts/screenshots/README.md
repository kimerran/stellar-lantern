# docs/ui screenshot generator

Regenerates `docs/ui/overview.png` and `docs/ui/settings-advanced.png` — the
reference renders of the wallet popup.

```bash
npm run screenshots
```

That builds this harness and captures both images. Requires **Google Chrome /
Chromium** on `PATH` and network access to Google Fonts (the app loads Inter,
Roboto Mono, and Material Symbols from the CDN).

## How it works

The app can't boot in a plain browser — it needs the extension / Capacitor
runtime and an unlocked wallet, and its screens fetch live Horizon / Soroban
data. So this harness renders the **real screen components** against the app's
**actual compiled Tailwind CSS + fonts**, with only the data layer swapped out:

- `vite.config.ts` aliases the data-fetching modules (`@core/stellar/client`,
  `@core/history/history`, `@core/blend/apr`, `@core/blend/positions`) to the
  fixtures in `stubs/`. Everything else — components, styles, tokens, icons — is
  the real app code, so the renders track the UI automatically.
- `main.tsx` mounts the popup shell (AppBar + screen + BottomNav) for each
  surface. `?view=overview` renders the 2×2 grid; `?view=settings-advanced`
  renders the full Settings screen with the Advanced disclosure opened.
- `fixtures.ts` holds the representative placeholder data (balances, history,
  APYs). None of it is real.
- `capture.mjs` serves the build, drives headless Chrome per view (waiting for
  fonts via `--virtual-time-budget`), then trims + pads the result with `sharp`.

To change what's shown (balances, history rows, APYs), edit `fixtures.ts`. To
add a surface, add a `?view=` branch in `main.tsx` and an entry in the `VIEWS`
list in `capture.mjs`.

The build output (`dist/`) is gitignored.
