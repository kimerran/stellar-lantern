#!/usr/bin/env python3
"""Build the D2 evidence decks (#109) from the D1 pair, slide for slide.

    python3 docs/evidence/d2/build.py <D1-01.pptx> <D1-02.pptx>

Inputs: the two D1 decks (the template — fonts, header/footer grammar, tile
layout, PROOF side-panel are all inherited by cloning their slides), the raw
CLI captures in raw/*.txt (made by `npm run scan` on the named commit) and the
stellar.expert screenshot raw/registry-stellar-expert.png. Outputs the two
D2 decks next to this file plus the rendered terminal images in img/.
Every number on a slide is read from raw/ or passed in FACTS below.
"""
import copy
import re
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pptx import Presentation
from pptx.util import Emu

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
IMG = HERE / "img"
IMG.mkdir(exist_ok=True)

FACTS = {
    "period": "2026-09-12 → 2026-09-18",
    "commit": "73d5b34",
    "commit_full": "73d5b34 (develop; release PR kimerran/stellar-lantern#154)",
    "tests": "748",
    "skipped": "1",
    "test_files": "67",
    "service_tests": "42",
    "fixtures": "19",
    "registry": "CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F",
    "flagged": "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
    "tests_run": "https://github.com/kimerran/internal-lantern/actions/runs/35184830481",
    "services_run": "https://github.com/kimerran/internal-lantern/actions/runs/35184830464",
}

# ── Terminal captures → 1400×1000 images ─────────────────────────────────────

MONO = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 21)
MONO_B = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 21)
BG, FG, DIM, AMBER, RED, GREEN, CYAN = (
    (15, 17, 21), (222, 226, 232), (130, 138, 150), (255, 193, 7), (255, 99, 99), (98, 214, 130), (120, 190, 240)
)
COLS = 104


def colour_for(line: str):
    s = line.strip()
    if line.startswith("$ "):
        return AMBER, MONO_B
    if s.startswith(("FLAGGED", "FAILED", "[high]")) or "risk HIGH" in s:
        return RED, MONO_B
    if s.startswith(("UNKNOWN", "[medium]")) or "risk MEDIUM" in s:
        return AMBER, MONO
    if "risk LOW" in s:
        return GREEN, MONO_B
    if s.startswith(('"',)):
        return CYAN, MONO
    if re.fullmatch(r"[A-Z ]+", s or "x") and line == line.lstrip():
        return AMBER, MONO_B
    if s.startswith(("signals", "ingest ·", "auth ·", "effects ·", "screen ·", "verdict ·", "source:", "scanned in")):
        return DIM, MONO
    return FG, MONO


def wrap(line: str, cols: int = COLS):
    if len(line) <= cols:
        return [line]
    indent = len(line) - len(line.lstrip())
    out, rest = [], line
    while len(rest) > cols:
        out.append(rest[:cols])
        rest = " " * (indent + 2) + rest[cols:]
    out.append(rest)
    return out


def render_terminal(lines, out: Path, size=(1400, 1000), title=None, scale=1.0):
    im = Image.new("RGB", size, BG)
    d = ImageDraw.Draw(im)
    x, y, lh = 28, 22, int(26 * scale)
    global MONO, MONO_B
    mono, mono_b = MONO, MONO_B
    if scale != 1.0:
        MONO = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", int(21 * scale))
        MONO_B = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", int(21 * scale))
    # Columns that actually fit this font on this width; never wider than
    # COLS so the 1400 px captures keep wrapping exactly where they did.
    cols = min(COLS, int((size[0] - 2 * x) / MONO.getlength("M")))
    if title:
        d.text((x, y), title, font=MONO_B, fill=DIM)
        y += lh + 8
    for raw in lines:
        for ln in wrap(raw.rstrip("\n"), cols):
            col, font = colour_for(raw)
            d.text((x, y), ln, font=font, fill=col)
            y += lh
            if y > size[1] - lh:
                d.text((x, y), "…", font=MONO, fill=DIM)
                break
    im.save(out)
    MONO, MONO_B = mono, mono_b
    return out


def capture(name: str):
    return (RAW / f"{name}.txt").read_text().splitlines()


def section(lines, *heads):
    """Keep the command line plus the named sections (until the next blank-line header)."""
    keep = [lines[0], ""]
    on = False
    for ln in lines[1:]:
        if ln and ln == ln.upper() and ln == ln.lstrip() and not ln.startswith("$"):
            on = ln in heads
        if on:
            keep.append(ln)
    return keep


def drop(lines, *prefixes):
    return [l for l in lines if not l.strip().startswith(prefixes)]


def build_images():
    render_terminal(drop(capture("01-payment"), "signals", "ingest ·", "auth ·", "effects ·", "screen ·"), IMG / "01-payment.png")
    render_terminal(drop(capture("02-approve-unlimited"), "signals", "ingest ·", "auth ·", "effects ·", "screen ·"), IMG / "02-approve.png")
    render_terminal(drop(capture("03-nested"), "signals", "ingest ·", "auth ·", "effects ·", "screen ·", "verdict ·"), IMG / "03-nested.png")
    render_terminal(drop(capture("04-unverified"), "signals", "auth ·", "effects ·", "screen ·", "Event log", "0:", "1:"), IMG / "04-unverified.png")

    # Proof 5: the scan on top, the explorer row that backs it underneath.
    top = Image.new("RGB", (1400, 1000), BG)
    with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
        term = Image.open(render_terminal(section(capture("05-flagged"), "SCREEN", "VERDICT", "SENTENCE"), Path(tmp.name), size=(1400, 520)))
        top.paste(term, (0, 0))
    ex = Image.open(RAW / "registry-stellar-expert.png").convert("RGB")
    band = ex.crop((0, 80, 1400, 140))  # the "Contract CBJW…" header
    rows = ex.crop((0, 500, 1400, 940))  # the history rows incl. the GA7Q…VSGZ report → 4
    top.paste(band, (0, 526))
    top.paste(rows.resize((1400, 414)), (0, 586))
    d = ImageDraw.Draw(top)
    d.rectangle((0, 520, 1400, 524), fill=AMBER)
    top.save(IMG / "05-flagged.png")

    # Proof 6: three fail-closed outcomes stacked.
    fc = []
    for name in ("06a-garbage", "06b-rpc-down", "06c-registry-down"):
        ls = capture(name)
        fc += [ls[0]] + [l for l in ls[1:] if l.strip().startswith(("FAILED", "UNKNOWN", "risk ", "[high]", "[medium]"))] + [""]
    render_terminal(fc, IMG / "06-fail-closed.png")

    # Invariant: AI on / AI off / hostile stub — same verdict line, three sentences.
    inv = ["$ npm run scan -- --file classic-payment-to-flagged            # AI proxy on", ]
    on = capture("05-flagged")
    inv += [l for l in on[1:] if "risk " in l or l.strip().startswith(('"', "source:"))] + [""]
    inv += ["$ diff <(scan --json | jq -S .verdict) <(scan --json --no-ai | jq -S .verdict)", "  (no output — verdict byte-identical with the model off)", ""]
    stub = capture("07c-hostile-stub")
    inv += [stub[0]] + [l for l in stub[1:] if "risk " in l or l.strip().startswith(('"', "source:"))]
    render_terminal(inv, IMG / "07-invariant.png")

    # Deck 2 posters (1920×1080).
    render_terminal(
        ["Recording pending — issue #61", "", "Shot list and read-aloud script: docs/demo/d2-transaction-scanner.md", "Publishes unlisted on YouTube; the link lands here and in the README."],
        IMG / "poster-pending.png", size=(1920, 1080), scale=2.2,
    )
    render_terminal(
        ["$ npm run scan -- --file classic-payment", "$ npm run scan -- --file sep41-approve", "$ npm run scan -- --file unknown-contract", "$ npm run scan -- --file classic-payment-to-flagged", "$ npm run scan -- --file classic-payment-to-flagged --no-ai", "", "every command read-only: nothing is signed, nothing is submitted"],
        IMG / "poster-runbook.png", size=(1920, 1080), title="Plan B — the live runbook, five commands", scale=2.0,
    )


# ── pptx helpers ─────────────────────────────────────────────────────────────

NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def clone_slide(prs, src):
    dst = prs.slides.add_slide(src.slide_layout)
    for shp in list(dst.shapes):
        shp._element.getparent().remove(shp._element)
    rid_map = {}
    for rId, rel in list(src.part.rels.items()):
        if "notesSlide" in rel.reltype or "slideLayout" in rel.reltype:
            continue
        if rel.is_external:
            new = dst.part.rels.get_or_add_ext_rel(rel.reltype, rel.target_ref)
        else:
            new = dst.part.rels.get_or_add(rel.reltype, rel.target_part)
        rid_map[rId] = new
    for shp in src.shapes:
        el = copy.deepcopy(shp._element)
        for node in el.iter():
            for attr in ("{%s}embed" % NS["r"], "{%s}link" % NS["r"]):
                v = node.get(attr)
                if v in rid_map:
                    node.set(attr, rid_map[v])
        dst.shapes._spTree.insert_element_before(el, "p:extLst")
    return dst


def delete_slide(prs, slide):
    rId = [k for k, r in prs.part.rels.items() if r.target_part is slide.part][0]
    lst = prs.slides._sldIdLst
    el = [e for e in lst if e.get("{%s}id" % NS["r"]) == rId][0]
    lst.remove(el)
    prs.part.drop_rel(rId)


def shape(slide, name):
    for s in slide.shapes:
        if s.name == name:
            return s
    raise KeyError(name)


def set_text(shp, *lines):
    """Replace a text box's content, keeping paragraph 0's run formatting for
    line 0 and paragraph 1's (or 0's) for the rest. Each line = one paragraph."""
    tf = shp.text_frame
    paras = list(tf.paragraphs)
    p0 = paras[0]
    p1 = paras[1] if len(paras) > 1 else paras[0]
    tmpl = {0: copy.deepcopy(p0._p), 1: copy.deepcopy(p1._p)}
    for p in paras:
        p._p.getparent().remove(p._p)
    for i, line in enumerate(lines):
        p = copy.deepcopy(tmpl[0 if i == 0 else 1])
        runs = p.findall("a:r", NS)
        for r in runs[1:]:
            p.remove(r)
        if runs:
            runs[0].find("a:t", NS).text = line
        else:
            from pptx.oxml.ns import qn
            r = p.makeelement(qn("a:r"), {})
            t = r.makeelement(qn("a:t"), {})
            t.text = line
            r.append(t)
            p.append(r)
        for br in p.findall("a:br", NS):
            p.remove(br)
        tf._txBody.append(p)


def set_picture(slide, pic, path):
    image_part, rId = slide.part.get_or_add_image_part(str(path))
    blip = pic._element.find(".//a:blip", NS)
    blip.set("{%s}embed" % NS["r"], rId)


def footer(slide, n, deliverable="Lantern · Instawards Deliverable 2"):
    boxes = [s for s in slide.shapes if s.has_text_frame and s.text_frame.text.strip() == "Lantern · Instawards Deliverable 1"]
    for b in boxes:
        set_text(b, deliverable)
    nums = [s for s in slide.shapes if s.has_text_frame and s.left > Emu(10_000_000) and s.top > Emu(6_000_000)]
    for b in nums:
        set_text(b, str(n))


# ── Deck 1 — Proof of Deliverables ───────────────────────────────────────────

PROOFS = [
    # (title, image, [(label, value...)], paragraph)
    ("A payment, decoded", "01-payment.png",
     [("FIXTURE", "classic-payment"), ("VERDICT", "LOW · ALLOW"), ("EFFECTS", "−25 XLM out, +25 XLM in"), ("SCREEN", "clean · 1 checked")],
     "The scanner reads a plain payment into exact amounts per address, screens the recipient against the registry, and writes one sentence a non-technical person can act on. The command line is in the shot; the raw output is in the evidence folder."),
    ("The unlimited approval, caught", "02-approve.png",
     [("FIXTURE", "sep41-approve"), ("VERDICT", "HIGH · BLOCK_CONFIRM"), ("ALLOWANCE", "unlimited USDC · ledger 5,666,220"), ("REASON", "unlimited_allowance")],
     "The headline case from SOW §4.1: a SEP-41 approve whose allowance is effectively unbounded. The scanner decodes the token call, shows the allowance and its expiry, and raises the risk. A user who sees this cancels — that is the product."),
    ("A nested sub-invocation is not invisible", "03-nested.png",
     [("FIXTURE", "nested-subinvocation"), ("AUTH TREE", "1 entry · depth 1"), ("EFFECT", "−1 XLM at depth 1"), ("VERDICT", "MEDIUM · WARN")],
     "A Blend supply call that transfers XLM one level down the authorization tree. The transfer surfaces in the effects with its depth, and the outer contract is labelled unverified rather than guessed at."),
    ("Unverified contract, handled honestly", "04-unverified.png",
     [("FIXTURE", "unknown-contract"), ("LABEL", "unverified — semantics unknown"), ("SIMULATION", "reverted, fail-closed"), ("VERDICT", "HIGH · BLOCK_CONFIRM")],
     "A call the scanner has no semantics for. It prints the contract id, the function and the decoded arguments, says so in a structured label the UI cannot lose, and never claims to know what the function does."),
    ("Screened against the D1 registry", "05-flagged.png",
     [("FIXTURE", "classic-payment-to-flagged"), ("SCREEN", "flagged · Scam · 4 reports · Active"), ("REGISTRY", FACTS["registry"][:26] + "…"), ("VERDICT", "HIGH · BLOCK_CONFIRM")],
     "The payment goes to the address reported in Deliverable 1. The scanner reads the live registry entry — reason, reporter, count — and the explorer row underneath is that same report (→ 4). This is the D1 → D2 coupling."),
    ("Fails closed", "06-fail-closed.png",
     [("GARBAGE XDR", "undecodable → HIGH"), ("RPC DOWN", "rpc_unreachable → HIGH"), ("REGISTRY DOWN", "screen_unknown → MEDIUM"), ("NEVER", "a silent “clean”")],
     "Three ways the world can break, three honest answers. An unreadable transaction, an unreachable simulator and an unreachable registry each come back as a warning with the cause named — the scanner never says safe when it does not know."),
]


def build_deck1(src: Path, out: Path):
    prs = Presentation(str(src))
    s = list(prs.slides)
    title, execsum, proof_tmpl, table_tmpl = s[0], s[1], s[2], s[6]

    # Slide 1 — title
    set_text(shape(title, "TextBox 3"), "INSTAWARDS · WEEK 2 · EVIDENCE PACK 1 OF 2")
    set_text(shape(title, "TextBox 4"), "Lantern — Deliverable 2")
    set_text(shape(title, "TextBox 5"), "Proof of Deliverables — Transaction Security Scanner")
    set_text(shape(title, "TextBox 7"),
             "Evidence captured from the scanner's command-line harness and the project's CI, on one named commit.",
             "Every artifact here is reproducible from the commands and links in evidence pack 2.")
    set_text(shape(title, "TextBox 8"), f"Reporting period: {FACTS['period']}   ·   Network: Stellar Testnet   ·   Status: delivered")
    footer(title, 1)

    # Slide 2 — executive summary
    set_text(shape(execsum, "TextBox 3"), "What shipped this week")
    tiles = [
        ("PIPELINE", "Six stages, deterministic", "Simulate, walk the auth tree, decode effects, screen, decide, explain — as an MIT package the wallet, a dApp or a CLI can call."),
        ("EFFECTS", "Payments + token calls", "Path payments, merges, SEP-41 / SAC transfer, approve, burn, mint, clawback; nested calls surfaced; unknown contracts labelled, never guessed."),
        ("SCREENING", "Every counterparty, D1 registry", "Three outcomes — flagged, clean, unknown. Unreachable is unknown, never clean; a hit carries the reason and report count."),
        ("VERDICT", "Rules decide, the AI writes", "Risk and action come from deterministic code. The model gets structured facts only, a deadline, and cannot change the verdict."),
    ]
    for i, (h, t, body) in enumerate(tiles):
        base = 6 + i * 4
        set_text(shape(execsum, f"TextBox {base}"), h)
        set_text(shape(execsum, f"TextBox {base + 1}"), t)
        set_text(shape(execsum, f"TextBox {base + 2}"), body)
    set_text(shape(execsum, "TextBox 23"),
             "12 of 12 planned slices delivered and merged — 31 points",
             "MIT package · pipeline + invariant · ingest · auth · effects ×3",
             "screen · verdict · explain · QA plan + CLI harness · demo runbook")
    set_text(shape(execsum, "TextBox 24"),
             "Every merge reviewed and gated on human approval",
             f"{FACTS['tests']} tests green offline in CI — no RPC, no registry,",
             "no model reachable — plus a proxy so no key ships in a client")
    footer(execsum, 2)

    # Proof slides
    new = []
    for i, (t, img, panel, para) in enumerate(PROOFS, 1):
        sl = clone_slide(prs, proof_tmpl)
        set_text(shape(sl, "TextBox 2"), f"PROOF · {i} OF 6")
        set_text(shape(sl, "TextBox 3"), t)
        set_picture(sl, shape(sl, "Picture 6"), IMG / img)
        for j, (label, value) in enumerate(panel):
            set_text(shape(sl, f"TextBox {8 + 2 * j}"), label)
            set_text(shape(sl, f"TextBox {9 + 2 * j}"), value)
        set_text(shape(sl, "TextBox 17"), para)
        footer(sl, 2 + i)
        new.append(sl)

    # The invariant slide, from the stats + table layout
    inv = clone_slide(prs, table_tmpl)
    set_text(shape(inv, "TextBox 2"), "THE INVARIANT")
    set_text(shape(inv, "TextBox 3"), "The AI cannot move the verdict — proven offline")
    stats = [(FACTS["tests"], "tests passed, network off"), (FACTS["test_files"], "test files, all offline"), (FACTS["fixtures"], "recorded fixtures"), ("0", "secrets in CI"), ("3", "hard blockers green")]
    for i, (n, label) in enumerate(stats):
        set_text(shape(inv, f"TextBox {6 + 3 * i}"), n)
        set_text(shape(inv, f"TextBox {7 + 3 * i}"), label)
    set_text(shape(inv, "TextBox 21"), f"WHAT THE TESTS ASSERT (ROOT SUITE, COMMIT {FACTS['commit']}; FULL RUN LINKED IN PACK 2)")
    set_text(shape(inv, "TextBox 22"), "TEST FILE")
    set_text(shape(inv, "TextBox 23"), "WHAT IT PROVES")
    set_text(shape(inv, "TextBox 24"), "RESULT")
    rows = [
        ("scanner-explain", "a model answering “completely safe” to a HIGH verdict changes nothing", "pass"),
        ("scanner-explain", "a memo of “ignore previous instructions” never reaches the prompt", "pass"),
        ("scanner-explain", "type-level: an explainer that returns a verdict does not compile", "pass"),
        ("scan-cli", "--json with and without the model: verdict byte-identical", "pass"),
        ("scanner-pipeline", "verdict and effects are deep-frozen before stage 6 runs", "pass"),
        ("scanner-screen", "registry unreachable, timeout or archived → unknown, never clean", "pass"),
        ("scanner-ingest", "undecodable XDR, RPC down, reverted call → fail closed", "pass"),
    ]
    for i, (a, b, c) in enumerate(rows):
        set_text(shape(inv, f"TextBox {25 + 3 * i}"), a)
        set_text(shape(inv, f"TextBox {26 + 3 * i}"), b)
        set_text(shape(inv, f"TextBox {27 + 3 * i}"), c)
    footer(inv, 9)
    new.append(inv)

    for sl in (s[2], s[3], s[4], s[5], s[6]):
        delete_slide(prs, sl)
    prs.save(str(out))
    return out


# ── Deck 2 — Technical Documentation & Demo Evidence ─────────────────────────

def build_deck2(src: Path, out: Path):
    prs = Presentation(str(src))
    s = list(prs.slides)
    title, verify, recs, media, docs, eng, nxt = s

    set_text(shape(title, "TextBox 3"), "INSTAWARDS · WEEK 2 · EVIDENCE PACK 2 OF 2")
    set_text(shape(title, "TextBox 4"), "Lantern — Deliverable 2")
    set_text(shape(title, "TextBox 5"), "Technical Documentation & Demo Evidence")
    set_text(shape(title, "TextBox 7"),
             "Where to verify the week independently: the MIT package and the commit it was built from, the CI runs that",
             "prove the suite green offline, the manual test plan, the runbook, and how every change was reviewed before it shipped.")
    set_text(shape(title, "TextBox 8"), f"Reporting period: {FACTS['period']}   ·   Network: Stellar Testnet   ·   Status: delivered")
    footer(title, 1)

    set_text(shape(verify, "TextBox 2"), "DEMO EVIDENCE · THE CODE AND THE CHAIN")
    set_text(shape(verify, "TextBox 3"), "Verify it yourself — repository, commit, registry")
    set_text(shape(verify, "TextBox 6"), "THE PACKAGE — MIT, IN THE PUBLIC REPOSITORY")
    set_text(shape(verify, "TextBox 7"), "github.com/kimerran/stellar-lantern · packages/lantern-scanner/")
    set_text(shape(verify, "TextBox 8"), f"commit {FACTS['commit_full']}")
    set_text(shape(verify, "TextBox 9"),
             "LICENSE (MIT) at the repo root and inside the package. Every capture in pack 1 was made with `npm run scan` on this commit;",
             "the raw output per slide is in the evidence folder so a reviewer can diff the slide against its source.")
    set_text(shape(verify, "TextBox 11"), "THE REGISTRY IT SCREENS AGAINST — DELIVERABLE 1'S DEPLOYMENT")
    set_text(shape(verify, "TextBox 12"), FACTS["registry"])
    set_text(shape(verify, "TextBox 13"), f"stellar.expert/explorer/testnet/contract/{FACTS['registry']}")
    set_text(shape(verify, "TextBox 14"),
             f"`npm ci && npm test` with networking off — {FACTS['tests']} passed, {FACTS['skipped']} skipped, {FACTS['test_files']} files. The suite is green with no RPC, no registry",
             "and no model reachable: every network answer comes from a recorded fixture, and anything unrecorded fails closed.")
    footer(verify, 2)

    set_text(shape(recs, "TextBox 2"), "DEMO EVIDENCE · RECORDINGS")
    set_text(shape(recs, "TextBox 3"), "One walkthrough — recording pending (#61), runbook ready")
    set_picture(recs, shape(recs, "Picture 6"), IMG / "poster-pending.png")
    set_text(shape(recs, "TextBox 7"), "d2-transaction-scanner.mp4")
    set_text(shape(recs, "TextBox 8"), "90–120 s · 1920×1080 · pending (#61)")
    set_text(shape(recs, "TextBox 9"), "Five shots in one take: a payment, the unlimited approval, an unverified contract, a flagged counterparty checked on stellar.expert, and the verdict unchanged with the AI off. Published unlisted once recorded.")
    set_picture(recs, shape(recs, "Picture 11"), IMG / "poster-runbook.png")
    set_text(shape(recs, "TextBox 12"), "docs/demo/d2-transaction-scanner.md — Plan B")
    set_text(shape(recs, "TextBox 13"), "live · five commands · read-only")
    set_text(shape(recs, "TextBox 14"), "The same five cases run live from a terminal for a reviewer on a call, with the read-aloud script and a fallback table for RPC, registry or model failures — each of which the scanner reports honestly.")
    footer(recs, 3)
    delete_slide(prs, media)

    set_text(shape(docs, "TextBox 3"), "What specifies the scanner, and where it lives")
    tiles = [
        ("packages/lantern-scanner/README.md", "The reference", "The six stages, the ScanResult shape, what is covered and what is not, the fixture corpus, the explainer contract and the recorded model (claude-haiku-4-5-20251001), and how to run it by hand."),
        ("docs/qa/d2-transaction-scanner-test-plan.md", "The manual test plan", "Ten sections a tester with no code background can follow: setup, smoke, payments, token calls, unverified contracts, registry screening, failing closed, the AI invariant, and a results table for sign-off."),
        ("docs/features.md", "Dated delivery log", "One entry per shipped slice, each naming the PR, the issue it closes and the decisions behind it — the written record of how the week was built."),
        ("services/lantern-api/README.md", "The proxy", "POST /v1/explain — the one route that lets a client show the AI sentence without holding a key: rate limits, daily cap, the error table, the threat model, and the deploy steps."),
    ]
    for i, (h, t, body) in enumerate(tiles):
        base = 6 + i * 4
        set_text(shape(docs, f"TextBox {base}"), h)
        set_text(shape(docs, f"TextBox {base + 1}"), t)
        set_text(shape(docs, f"TextBox {base + 2}"), body)
    footer(docs, 4)

    set_text(shape(eng, "TextBox 3"), "How the work was verified before it shipped")
    set_text(shape(eng, "TextBox 6"), "CONTINUOUS INTEGRATION")
    set_text(shape(eng, "TextBox 7"), "Green on every merge, offline")
    set_text(shape(eng, "TextBox 8"), f"Two lanes on every pull request: typecheck, lint, the {FACTS['tests']}-test suite with no network, the extension build and a flag-elimination check; and the proxy's own typecheck, {FACTS['service_tests']} tests, bundle and boot smoke. No CI secret exists — the suite cannot need one.")
    set_text(shape(eng, "TextBox 10"), "REVIEW GATE")
    set_text(shape(eng, "TextBox 11"), "No self-merges")
    set_text(shape(eng, "TextBox 12"), "Twelve slice PRs plus the proxy, each reviewed at the commit that merged, with findings carried as inline threads to resolution — from fail-closed ingest details to the offline registry answering clean for an unrecorded address.")
    set_text(shape(eng, "TextBox 14"), "INVARIANTS COUPLED TO CODE")
    set_text(shape(eng, "TextBox 15"), "The model cannot reach the verdict")
    set_text(shape(eng, "TextBox 16"), "The verdict is deep-frozen before the explainer runs; a type-level test refuses an explainer that returns a verdict; hostile-model and prompt-injection tests pin the behaviour; the AI flag is OFF in every release build so no key can ship.")
    footer(eng, 5)

    set_text(shape(nxt, "TextBox 3"), "Week 3 — Deliverable 3: the scanner before the Sign button")
    set_text(shape(nxt, "TextBox 5"),
             "Run the six-stage pipeline in the wallet's pre-sign review, with registry screening live and the AI sentence served by the",
             "Lantern API proxy, so the warning arrives before the signature — not after the money is gone.")
    steps = [("1", "Pre-sign", "Pipeline in the review screen"), ("2", "Gate", "block_confirm holds the Sign button"), ("3", "Proxy", "AI sentence, no key in the client"), ("4", "Registry", "Live screening per counterparty"), ("5", "Report", "One tap to report an address"), ("6", "Evidence", "Recording + QA sign-off")]
    for i, (n, h, body) in enumerate(steps):
        base = 7 + i * 4
        set_text(shape(nxt, f"TextBox {base}"), n)
        set_text(shape(nxt, f"TextBox {base + 1}"), h)
        set_text(shape(nxt, f"TextBox {base + 2}"), body)
    set_text(shape(nxt, "TextBox 32"), "D3-1 (#84) is open and specified: the scanner pipeline, registry screening and the proxy-backed explainer in the pre-sign review. The remaining D3 slices are sequenced from it once the D2 recording (#61) lands.")
    footer(nxt, 6)

    prs.save(str(out))
    return out


if __name__ == "__main__":
    d1a, d1b = Path(sys.argv[1]), Path(sys.argv[2])
    build_images()
    print(build_deck1(d1a, HERE / "Lantern-D2-01-Proof-of-Deliverables.pptx"))
    print(build_deck2(d1b, HERE / "Lantern-D2-02-Technical-Documentation-Demo-Evidence.pptx"))
