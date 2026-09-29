"""Lantern sticker pack generator.

Builds every sticker from one design system so the pack stays consistent:
the same plate shapes, corner radius, keyline, die-cut border, logo trace and
fonts. All geometry is real vector geometry (shapely), so the white border and
the `cutline` are true offsets of the artwork, and all text is converted to
outlines — the output SVGs need no fonts installed.

    python3 stickers/src/build.py            # SVGs + preview-ready assets
    python3 stickers/src/build.py --png      # also 300-DPI PNGs (needs Chromium)

Requires: fonttools, uharfbuzz, shapely, pillow. Fonts (Inter, Roboto Mono —
both SIL OFL 1.1) are downloaded into stickers/src/fonts/ on first run.
"""
from __future__ import annotations

import io
import math
import os
import subprocess
import sys
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from shapely import affinity
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union

HERE = Path(__file__).resolve().parent
OUT = HERE.parent
FONT_DIR = HERE / "fonts"

# ── Brand palette (stickers/brand-brief.md §4 — from tailwind.config.ts) ──────
NAVY = "#0B1326"    # Night Navy — plate
AMBER = "#FFC107"   # Lantern Amber — logo line-work, keyline, emphasis
CREAM = "#FFE4AF"   # Glow Cream — flame, headline type
MIST = "#DAE2FD"    # Mist — secondary text
SKY = "#84D5FF"     # Testnet Sky — sparing accent ("on Stellar")
WHITE = "#FFFFFF"   # die-cut border
CUT = "#EC008C"     # cutline stroke — technical only, never printed
PALETTE = {NAVY, AMBER, CREAM, MIST, SKY, WHITE}

# ── Pack system (brand-brief.md "Pack system") ───────────────────────────────
PT = 25.4 / 72                 # 1 pt in mm
BORDER = 3.0                   # white die-cut border (mm)
BLEED = 3.0                    # bleed beyond the cut (mm)
PLATE_R = 6.0                  # plate corner radius — cut radius is PLATE_R + BORDER
KEY_INSET = 2.2                # keyline inset from the plate edge
KEY_W = 0.5                    # keyline weight (≈1.4 pt)
MIN_TEXT = 8 * PT              # 8 pt minimum type size (em, mm)
MIN_LINE = 0.25                # floor for any stroke (≈0.7 pt, above the 0.5 pt rule)
LOGO_SQ = 16.0                 # logo height on every 3 in square sticker
LOGO_SQ_TOP = 7.5              # …and its top edge, from the plate top
SQUARE = 76.2                  # 3 in cut → plate = SQUARE - 2*BORDER
WIDE = (88.9, 38.1)            # 3.5 × 1.5 in cut
URL = (101.6, 38.1)            # 4 × 1.5 in cut
HEX_H = 50.8                   # 2 in point-to-point hex

FONTS = {
    "Inter.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf",
    "RobotoMono.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/robotomono/RobotoMono%5Bwght%5D.ttf",
}


# ════════════════════════════════════════════════════════════════════════════
# Fonts & type — shaped with HarfBuzz (real kerning), outlined with fontTools
# ════════════════════════════════════════════════════════════════════════════
def _font_file(name: str) -> Path:
    FONT_DIR.mkdir(exist_ok=True)
    p = FONT_DIR / name
    if not p.exists():
        print(f"downloading {name} …")
        urllib.request.urlretrieve(FONTS[name], p)
    return p


class Face:
    """One static instance of a variable font, ready to shape and outline."""

    def __init__(self, file: str, **axes):
        tt = instancer.instantiateVariableFont(TTFont(_font_file(file)), axes)
        buf = io.BytesIO()
        tt.save(buf)
        self.tt = TTFont(io.BytesIO(buf.getvalue()))
        self.hb = hb.Font(hb.Face(buf.getvalue()))
        self.upm = self.tt["head"].unitsPerEm
        self.order = self.tt.getGlyphOrder()
        self.gs = self.tt.getGlyphSet()
        self.cap = self.tt["OS/2"].sCapHeight / self.upm
        self.xh = self.tt["OS/2"].sxHeight / self.upm
        self.label = f"{Path(file).stem} {axes}"


FACES: dict[str, Face] = {}


def face(key: str) -> Face:
    if key not in FACES:
        spec = {
            "black": ("Inter.ttf", dict(wght=900, opsz=32)),
            "xbold": ("Inter.ttf", dict(wght=800, opsz=32)),
            "semi": ("Inter.ttf", dict(wght=600, opsz=14)),
            "mono": ("RobotoMono.ttf", dict(wght=500)),
            "monob": ("RobotoMono.ttf", dict(wght=700)),
        }[key]
        FACES[key] = Face(spec[0], **spec[1])
    return FACES[key]


@dataclass
class Run:
    """A shaped, outlined line of text in local coords (baseline at y=0, y down)."""
    d: str
    adv: float
    ink: tuple[float, float, float, float]  # xmin, ymin, xmax, ymax
    size: float
    font: str


def shape(fkey: str, text: str, size: float, tracking: float = 0.0) -> Run:
    f = face(fkey)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(f.hb, buf, {"kern": True, "liga": True})
    k = size / f.upm
    pen, bp = SVGPathPen(f.gs), BoundsPen(f.gs)
    x = 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        g = f.order[info.codepoint]
        t = (k, 0, 0, -k, x + pos.x_offset * k, -pos.y_offset * k)
        f.gs[g].draw(TransformPen(pen, t))
        f.gs[g].draw(TransformPen(bp, t))
        x += pos.x_advance * k + tracking * size
    adv = x - tracking * size
    return Run(pen.getCommands(), adv, bp.bounds or (0, 0, 0, 0), size, f.label)


# ════════════════════════════════════════════════════════════════════════════
# The logo — flat vector trace of logo.jpg (1024 px source coordinates)
# Measured from the raster: rod x≈511 y198–316; ring c(511.5,342) r26;
# handle arch legs x=411/611 with r70 shoulders; globe c(511.5,552) r131;
# waist at y678 flaring to a bell; plate line y714; three-tongue flame.
# ════════════════════════════════════════════════════════════════════════════
SRC_TOP, SRC_BOTTOM = 193.0, 719.5  # ink extent of the mark (rod top → plate)
SRC_H = SRC_BOTTOM - SRC_TOP
CX = 511.5
LINE = 8.5                           # source stroke weight

FLAME_PTS = [
    (509, 509), (515, 515), (520, 521), (525, 527), (529, 533), (533, 539), (536, 545), (538, 551),
    (540, 557), (541, 563), (542, 569), (542, 575), (541, 584), (540, 594),                   # main, right
    (546, 588), (551, 583), (556, 579), (561, 576),                                            # notch → right tip
    (564, 581), (566, 587), (568, 593), (569, 599), (570, 606), (570, 613), (570, 620), (569, 628),
    (567, 635), (565, 641), (562, 647), (558, 653), (554, 659), (548, 665), (539, 671), (525, 676),
    (511, 677), (497, 676), (483, 671), (474, 665), (468, 659), (463, 653), (460, 647), (457, 641),
    (455, 635), (453, 629), (453, 622), (453, 615), (454, 608), (456, 601), (459, 595),        # left tongue
    (461, 603), (463, 611), (466, 619), (470, 627), (476, 634), (483, 640),                    # → notch
    (481, 632), (478, 624), (476, 616), (475, 607), (475, 598), (476, 590), (478, 583), (481, 576),
    (485, 569), (489, 562), (494, 556), (498, 549), (502, 541), (505, 533), (507, 525), (508, 517),
]


def _arc(cx, cy, r, a0, a1, n=48):
    return [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
            for a in (a0 + (a1 - a0) * i / n for i in range(n + 1))]


def lantern_parts(line_w: float):
    """Returns [(geometry, colour)] in source px, strokes already outlined."""
    lw = line_w / 2
    rod = LineString([(CX, 197), (CX, 316)]).buffer(lw)
    ring = Point(CX, 342).buffer(26 + lw).difference(Point(CX, 342).buffer(26 - lw))
    arch_pts = ([(411, 662), (411, 420)] + _arc(481, 420, 70, 180, 270)
                + [(541, 350)] + _arc(541, 420, 70, 270, 360) + [(611, 662)])
    arch = LineString(arch_pts).buffer(lw, join_style="round")
    # legs pinch into the waist, then flare into the bell
    left = LineString([(411, 662), (414, 670), (424, 678), (416, 690), (411, 706)]).buffer(lw)
    right = affinity.scale(left, xfact=-1, origin=(CX, 0))
    collar = LineString([(424, 678), (599, 678)]).buffer(lw)
    plate = LineString([(405, 714.5), (618, 714.5)]).buffer(lw + 0.5)
    globe = Point(CX, 552).buffer(131)
    flame = Polygon(FLAME_PTS).buffer(2.5).buffer(-2.5).simplify(0.4)
    highlight = LineString(_arc(CX, 552, 114, 223, 250, 24)).buffer(lw)  # same clamped weight as the lines
    lines = unary_union([rod, ring, arch, left, right, collar, plate])
    return [(unary_union([lines, globe]), AMBER), (flame, CREAM), (highlight, CREAM)]


@dataclass
class Placed:
    svg: str
    ink: object          # shapely geometry of everything drawn, for checks
    kind: str            # 'text' | 'logo' | 'shape'
    min_size: float = 0  # em for text, stroke for logo
    colours: set = field(default_factory=set)


def geom_to_d(g) -> str:
    polys = [g] if isinstance(g, Polygon) else list(getattr(g, "geoms", []))
    out = []
    for p in polys:
        if p.is_empty:
            continue
        for ring in [p.exterior, *p.interiors]:
            c = list(ring.coords)
            out.append("M" + "L".join(f"{x:.3f} {y:.3f}" for x, y in c[:-1]) + "Z")
    return "".join(out)


def logo(height: float, cx: float, top: float) -> Placed:
    """The mark at `height` mm, centred on cx, top edge at `top`."""
    s = height / SRC_H
    # Optical floor: never let a line print thinner than MIN_LINE.
    line_w = max(LINE, MIN_LINE / s)
    parts = lantern_parts(line_w)
    svg, inks = [], []
    for g, col in parts:
        g = affinity.translate(affinity.scale(g, s, s, origin=(0, 0)), cx - CX * s, top - SRC_TOP * s)
        svg.append(f'<path fill="{col}" fill-rule="evenodd" d="{geom_to_d(g)}"/>')
        inks.append(g)
    return Placed("".join(svg), unary_union(inks), "logo", line_w * s, {AMBER, CREAM})


def logo_width(height: float) -> float:
    return (643 - 379) * height / SRC_H


def text(fkey: str, s: str, size: float, x: float, baseline: float, fill: str,
         tracking: float = 0.0, anchor: str = "start", rotate: float = 0.0,
         pivot: tuple | None = None) -> Placed:
    r = shape(fkey, s, size, tracking)
    if anchor == "middle":
        x -= r.adv / 2
    elif anchor == "end":
        x -= r.adv
    x0, y0, x1, y1 = r.ink
    ink = box(x + x0, baseline + y0, x + x1, baseline + y1)
    tf = f"translate({x:.3f} {baseline:.3f})"
    if rotate:
        px, py = pivot or (x + r.adv / 2, baseline)
        tf = f"rotate({rotate} {px:.3f} {py:.3f}) " + tf
        ink = affinity.rotate(ink, rotate, origin=(px, py))
    return Placed(f'<path fill="{fill}" transform="{tf}" d="{r.d}"/>', ink, "text", size, {fill})


def fit(fkey: str, s: str, max_w: float, tracking: float = 0.0) -> float:
    """Largest em (mm) at which `s` fits in max_w — width is linear in size."""
    return 100 * max_w / shape(fkey, s, 100, tracking).adv


# ════════════════════════════════════════════════════════════════════════════
# Plates, sticker assembly, checks
# ════════════════════════════════════════════════════════════════════════════
def rrect(w: float, h: float, r: float = PLATE_R, x: float = 0, y: float = 0):
    return box(x + r, y + r, x + w - r, y + h - r).buffer(r, quad_segs=32)


def square_plate():
    side = SQUARE - 2 * BORDER
    return rrect(side, side), side


def hex_cut(h: float):
    rc = h / 2
    pts = [(rc * math.cos(math.radians(90 + 60 * i)), rc * math.sin(math.radians(90 + 60 * i))) for i in range(6)]
    sharp = affinity.translate(Polygon(pts), rc * math.sqrt(3) / 2, rc)
    r = PLATE_R + BORDER
    return sharp.buffer(-r, join_style="mitre").buffer(r, quad_segs=32)


@dataclass
class Sticker:
    num: str
    slug: str
    title: str
    concept: str
    plate: object
    items: list[Placed]
    notes: str = ""
    keyline: bool = True

    # geometry derived from the plate — identical rules for every sticker
    @property
    def cut(self):
        return self.plate.buffer(BORDER, quad_segs=32)

    @property
    def bleed(self):
        return self.plate.buffer(BORDER + BLEED, quad_segs=32)

    def keyline_geom(self):
        inner = self.plate.buffer(-KEY_INSET, quad_segs=32)
        return inner.difference(inner.buffer(-KEY_W, quad_segs=32))

    def size_in(self):
        x0, y0, x1, y1 = self.cut.bounds
        return (x1 - x0) / 25.4, (y1 - y0) / 25.4

    def check(self):
        """Enforce the print specs. Raises on any violation."""
        errs = []
        safe = self.plate.buffer(-(KEY_INSET + KEY_W))   # inside the keyline
        for p in self.items:
            if p.kind == "text":
                if p.min_size < MIN_TEXT - 1e-6:
                    errs.append(f"text {p.min_size / PT:.1f} pt < 8 pt")
                if not safe.buffer(0.01).contains(p.ink):
                    errs.append(f"text crosses the keyline / safe area: {p.ink.bounds}")
            if p.kind == "logo" and p.min_size < MIN_LINE - 1e-6:
                errs.append(f"logo line {p.min_size:.3f} mm < {MIN_LINE} mm")
            if not self.plate.buffer(0.01).contains(p.ink):
                errs.append(f"{p.kind} leaves the plate: {p.ink.bounds}")
            if p.colours - PALETTE:
                errs.append(f"off-palette colour {p.colours - PALETTE}")
        # text must sit ≥ 3 mm inside the cut line (it is ≥ BORDER + KEY_INSET + KEY_W)
        for p in self.items:
            if p.kind == "text" and self.cut.exterior.distance(p.ink) < 3.0:
                errs.append("text closer than 3 mm to the cut line")
        if errs:
            raise SystemExit(f"{self.num}-{self.slug}: " + "; ".join(errs))

    def svg(self, mode: str = "print") -> str:
        """mode='print': bleed + art + cutline layer. mode='png': cut-clipped, no cutline."""
        frame = self.bleed if mode == "print" else self.cut
        x0, y0, x1, y1 = frame.bounds
        w, h = x1 - x0, y1 - y0
        t = f"translate({-x0:.3f} {-y0:.3f})"
        layers = []
        white = self.bleed if mode == "print" else self.cut
        layers.append(f'<g id="white" inkscape:groupmode="layer" inkscape:label="white"><path fill="{WHITE}" d="{geom_to_d(white)}"/></g>')
        art = [f'<path fill="{NAVY}" d="{geom_to_d(self.plate)}"/>']
        if self.keyline:
            art.append(f'<path fill="{AMBER}" fill-rule="evenodd" d="{geom_to_d(self.keyline_geom())}"/>')
        art += [p.svg for p in self.items]
        layers.append(f'<g id="art" inkscape:groupmode="layer" inkscape:label="art">{"".join(art)}</g>')
        if mode == "print":
            layers.append(
                f'<g id="cutline" inkscape:groupmode="layer" inkscape:label="cutline">'
                f'<path id="CutContour" fill="none" stroke="{CUT}" stroke-width="{0.25 * PT:.4f}" d="{geom_to_d(self.cut)}"/></g>'
            )
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" '
            f'width="{w:.3f}mm" height="{h:.3f}mm" viewBox="0 0 {w:.3f} {h:.3f}">'
            f"<title>Lantern sticker {self.num} — {self.title}</title>"
            f'<g transform="{t}">{"".join(layers)}</g></svg>'
        )


# ════════════════════════════════════════════════════════════════════════════
# The stickers
# ════════════════════════════════════════════════════════════════════════════
def s01_logo() -> Sticker:
    h = 60.0
    mark = logo(h, 0, 0)
    plate = mark.ink.buffer(4.5, quad_segs=32).buffer(-1.5).buffer(1.5)  # smooth navy contour
    return Sticker("01", "logo", "Logo", "The lantern mark alone, contour die-cut.", plate, [mark],
                   notes="Contour cut follows the lantern.")


def s02_name() -> Sticker:
    w, h = WIDE[0] - 2 * BORDER, WIDE[1] - 2 * BORDER
    plate = rrect(w, h)
    em = min(fit("black", "Lantern", w - 22, -0.01), (h - 18) / face("black").cap)
    t = text("black", "Lantern", em, w / 2, h / 2 + em * face("black").cap / 2, CREAM, -0.01, "middle")
    return Sticker("02", "name", "Project name", "Wordmark only — Inter Black.", plate, [t])


def s03_lockup() -> Sticker:
    w, h = WIDE[0] - 2 * BORDER, WIDE[1] - 2 * BORDER
    plate = rrect(w, h)
    cap_h = 9.2
    em = cap_h / face("black").cap
    lh = 2.2 * cap_h                       # logo height is tied to the wordmark cap height
    gap = 0.45 * cap_h
    word = shape("black", "Lantern", em, -0.01)
    lw = logo_width(lh)
    total = lw + gap + word.adv
    x0 = (w - total) / 2
    baseline = (h + lh) / 2                # lockup: logo bottom sits on the text baseline
    mark = logo(lh, x0 + lw / 2, baseline - lh)
    t = text("black", "Lantern", em, x0 + lw + gap, baseline, CREAM, -0.01)
    return Sticker("03", "lockup", "Logo + name", "Horizontal lockup — mark on the wordmark baseline.", plate, [mark, t])


def s04_tagline() -> Sticker:
    plate, side = square_plate()
    mark = logo(LOGO_SQ, side / 2, LOGO_SQ_TOP)
    lines = [("Stop", CREAM), ("getting", CREAM), ("scammed", AMBER)]
    f = face("black")
    top, bottom = LOGO_SQ_TOP + LOGO_SQ + 7.0, side - 9.0
    em_w = min(fit("black", s, side - 16, -0.02) for s, _ in lines)
    lead = 1.06  # clears the g descenders in "getting" from the d ascender below
    em_h = (bottom - top) / (2 * lead + f.cap + 0.02)
    em = min(em_w, em_h)
    b0 = top + em * f.cap + ((bottom - top) - em * (2 * lead + f.cap)) / 2
    items = [mark] + [text("black", s, em, side / 2, b0 + i * lead * em, c, -0.02, "middle")
                      for i, (s, c) in enumerate(lines)]
    return Sticker("04", "tagline", "Tagline", "“Stop getting scammed” — the problem, not the features.", plate, items)


def sparkle(cx: float, cy: float, r: float, fill: str) -> Placed:
    """A plain four-point sparkle — a generic star, deliberately NOT Stellar's mark."""
    pts = []
    for i in range(8):
        a = math.radians(i * 45 - 90)
        rr = r if i % 2 == 0 else r * 0.28
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    g = Polygon(pts)
    return Placed(f'<path fill="{fill}" d="{geom_to_d(g)}"/>', g, "shape", colours={fill})


def s05_on_stellar() -> Sticker:
    plate, side = square_plate()
    mark = logo(LOGO_SQ, side / 2, LOGO_SQ_TOP)
    f = face("black")
    em1 = fit("black", "Lantern", side - 20, -0.01)
    b1 = LOGO_SQ_TOP + LOGO_SQ + 7.0 + em1 * f.cap
    em2 = em1 * 0.52
    b2 = b1 + 5.2 + em2 * face("xbold").cap
    items = [
        mark,
        text("black", "Lantern", em1, side / 2, b1, CREAM, -0.01, "middle"),
        text("xbold", "on Stellar", em2, side / 2, b2, SKY, 0.0, "middle"),
        sparkle(side / 2 - 17, LOGO_SQ_TOP + 6.5, 2.6, CREAM),
        sparkle(side / 2 + 16, LOGO_SQ_TOP + 3.0, 1.7, SKY),
        sparkle(side / 2 + 20.5, LOGO_SQ_TOP + 11.5, 1.2, CREAM),
    ]
    return Sticker("05", "on-stellar", "Lantern on Stellar", "Built on Stellar — “Stellar” as text, no official mark.", plate, items)


def s06_website() -> Sticker:
    w, h = URL[0] - 2 * BORDER, URL[1] - 2 * BORDER
    plate = rrect(w, h)
    em = min(fit("xbold", "golantern.xyz", w - 16, 0.0), 13.5)
    a = shape("xbold", "golantern", em)
    b = shape("xbold", ".xyz", em)
    x0 = (w - (a.adv + b.adv)) / 2
    # centre the ink (ascender top → descender bottom) vertically
    ink_top = min(a.ink[1], b.ink[1])
    ink_bot = max(a.ink[3], b.ink[3])
    baseline = h / 2 - (ink_top + ink_bot) / 2
    items = [
        text("xbold", "golantern", em, x0, baseline, CREAM),
        text("xbold", ".xyz", em, x0 + a.adv, baseline, AMBER),
    ]
    xh = em * face("xbold").xh
    return Sticker("06", "website", "Website", "golantern.xyz, sized to read at ~1 m.", plate, items,
                   notes=f"x-height {xh:.1f} mm, cap {em * face('xbold').cap:.1f} mm")


# The meme's XDR is a REAL fixture: an unsigned payment to the registry's
# demo-flagged address — decode it and you've signed money to a reported scammer.
MEME_XDR = ("AAAAAgAAAAAY0gqcnifD/QFRi3Um28AFmWZwoXTXZlkgmYh/UZB/SQAAAGQAAAAA/N5BswAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAA/DDS/k60NmXHQTMyQ9wVRHIOKrZc0pKL7DXoD/H/omgAAAAAAAAAAAvrwgAAAAAAAAAAA")
MEME_SOURCE = "packages/lantern-scanner/fixtures/classic-payment-to-flagged.json"


def s07_meme() -> Sticker:
    """Caption → the full XDR → a rubber-stamped LGTM. The stamp sits BELOW the
    XDR, never on it: all 192 characters stay legible, so the easter egg (it pays
    a reported scammer) survives for anyone who actually decodes it."""
    plate, side = square_plate()
    mark = logo(LOGO_SQ, side / 2, LOGO_SQ_TOP)
    items = [mark]
    cap_em = 5.2
    b_cap = LOGO_SQ_TOP + LOGO_SQ + 3.4 + cap_em * face("xbold").cap
    items.append(text("xbold", "I reviewed the XDR.", cap_em, side / 2, b_cap, CREAM, 0.0, "middle"))
    per = 32
    rows = [MEME_XDR[i:i + per] for i in range(0, len(MEME_XDR), per)]
    mono_em = MIN_TEXT * 1.04
    lead = mono_em * 1.14
    b0 = b_cap + 2.6 + mono_em * face("mono").cap
    xdr = [text("mono", r, mono_em, side / 2, b0 + i * lead, MIST, 0.0, "middle") for i, r in enumerate(rows)]
    items += xdr
    xdr_ink = unary_union([p.ink for p in xdr])
    # the rubber stamp, bottom right, tilted
    st_em, rot = 8.0, -9
    st = shape("black", "LGTM", st_em, 0.02)
    sw, sh = st.adv + 6.5, st_em * face("black").cap + 5.0
    half_v = (sh / 2) * math.cos(math.radians(abs(rot))) + (sw / 2) * math.sin(math.radians(abs(rot)))
    sc = (side - KEY_INSET - KEY_W - 4.0 - sw / 2, xdr_ink.bounds[3] + 1.2 + half_v)
    frame = rrect(sw, sh, 2.0, sc[0] - sw / 2, sc[1] - sh / 2)
    ring = frame.difference(frame.buffer(-0.9))
    frame_r, ring_r = (affinity.rotate(g, rot, origin=sc) for g in (frame, ring))
    if frame_r.intersects(xdr_ink):
        raise SystemExit("07-meme: stamp would cover part of the XDR")
    items.append(Placed(f'<path fill="{NAVY}" d="{geom_to_d(frame_r)}"/>'
                        f'<path fill="{AMBER}" fill-rule="evenodd" d="{geom_to_d(ring_r)}"/>',
                        frame_r, "shape", colours={NAVY, AMBER}))
    items.append(text("black", "LGTM", st_em, sc[0], sc[1] + st_em * face("black").cap / 2, AMBER, 0.02,
                      "middle", rotate=rot, pivot=sc))
    # the hint, bottom left, on the stamp's centre line
    left = KEY_INSET + KEY_W + 4.0
    items.append(text("mono", "// decode it", mono_em, left, sc[1] + mono_em * face("mono").cap / 2, AMBER))
    return Sticker("07", "meme", "Meme — “I reviewed the XDR. LGTM.”",
                   "Rubber-stamping an unreadable XDR. The XDR is real and complete: a payment to a reported scammer.",
                   plate, items, notes=f"XDR from {MEME_SOURCE}")


def s08_soroban_hex() -> Sticker:
    cut = hex_cut(HEX_H)
    plate = cut.buffer(-BORDER, quad_segs=32)
    x0, y0, x1, y1 = plate.bounds
    cx = (x0 + x1) / 2
    lh = LOGO_SQ * (y1 - y0) / (SQUARE - 2 * BORDER)   # same proportion of the sticker as on the squares
    top = y0 + LOGO_SQ_TOP * (y1 - y0) / (SQUARE - 2 * BORDER)
    mark = logo(lh, cx, top)
    b1 = top + lh + 5.2
    small = MIN_TEXT * 1.08
    em = fit("black", "Soroban", (x1 - x0) - 13, -0.01)
    b2 = b1 + 1.8 + em * face("black").cap
    b3 = b2 + 2.4 + small * face("monob").cap
    items = [
        mark,
        text("semi", "BUILT WITH", small, cx, b1, MIST, 0.18, "middle"),
        text("black", "Soroban", em, cx, b2, CREAM, -0.01, "middle"),
        text("monob", "is_flagged()", small, cx, b3, AMBER, 0.0, "middle"),
    ]
    return Sticker("08", "built-with-soroban", "Built with Soroban (hex)",
                   "Hex dev badge; `is_flagged()` is the registry contract’s real read function.",
                   plate, items, notes="Hex, 2 in point-to-point before corner rounding")


STICKERS = [s01_logo, s02_name, s03_lockup, s04_tagline, s05_on_stellar, s06_website, s07_meme, s08_soroban_hex]


# ════════════════════════════════════════════════════════════════════════════
# Output
# ════════════════════════════════════════════════════════════════════════════
CHROME = os.environ.get("CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")


def export_png(svg_path: Path, png_path: Path, w_mm: float, h_mm: float):
    from PIL import Image
    wpx, hpx = round(w_mm / 25.4 * 300), round(h_mm / 25.4 * 300)
    html = png_path.with_suffix(".render.html")
    html.write_text(f'<!doctype html><style>html,body{{margin:0;background:transparent}}</style>'
                    f'<img src="{svg_path.name}" style="display:block;width:{wpx}px;height:{hpx}px">')
    subprocess.run([CHROME, "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                    "--default-background-color=00000000", f"--window-size={wpx},{hpx + 160}",
                    f"--screenshot={png_path}", f"file://{html}"], check=True, capture_output=True)
    html.unlink()
    im = Image.open(png_path).convert("RGBA")
    ink = im.getbbox()
    if ink[2] > wpx or ink[3] > hpx:
        raise SystemExit(f"{png_path.name}: render clipped")
    im.crop((0, 0, wpx, hpx)).save(png_path, dpi=(300, 300))


def main():
    want_png = "--png" in sys.argv
    built = []
    for make in STICKERS:
        s = make()
        s.check()
        name = f"{s.num}-{s.slug}"
        (OUT / f"{name}.svg").write_text(s.svg("print"))
        if want_png:
            tmp = OUT / f".{name}.cut.svg"
            tmp.write_text(s.svg("png"))
            x0, y0, x1, y1 = s.cut.bounds
            export_png(tmp, OUT / f"{name}.png", x1 - x0, y1 - y0)
            tmp.unlink()
        wi, hi = s.size_in()
        built.append((s, wi, hi))
        print(f"{name:24s} {wi:.2f} × {hi:.2f} in   {s.notes}")
    return built


if __name__ == "__main__":
    main()
