# D2 evidence package (#109)

The two reviewer decks for Deliverable 2, mirroring the D1 pair slide for slide:

- `Lantern-D2-01-Proof-of-Deliverables.pptx` — title, executive summary, six PROOF slides, the invariant slide.
- `Lantern-D2-02-Technical-Documentation-Demo-Evidence.pptx` — title, verify-it-yourself, recordings, documentation map, engineering evidence, next week.

Every PROOF slide is a `npm run scan` capture made on commit `73d5b34` with the command line in the shot; the raw output per slide is in `raw/` so a reviewer can diff a slide against its source. `raw/registry-stellar-expert.png` is the explorer page of the D1 registry at capture time. `img/` holds the rendered slide images. `build.py` regenerates both decks from the D1 decks (passed as arguments; they are the template) plus `raw/`.

The D2 recording (#61) is not made yet: deck 2's recordings slide says so and shows the Plan-B runbook instead of embedding a video. Re-run `build.py` with the recording's poster once it exists.
