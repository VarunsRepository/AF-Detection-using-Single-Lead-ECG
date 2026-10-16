#!/usr/bin/env python3
"""
Kymograph icon set.

THE MARK
    Carl Ludwig's kymograph was a rotating drum and a stylus: the drum
    turns, the stylus rides the signal, and a trace appears on smoked
    paper. The mark is that -- an amber drum arc with a mint stylus trace
    riding over it, spiking once.

    The spike plus its magenta apex dot is the one shape that appears in
    every screenshot of the app, so it carries the brand rather than
    illustrating it.

OPTICAL SIZING
    16px and 32px drop the drum arc and the apex dot, and thicken the
    trace. A ring at 16px is one grey pixel of mush, and a mark that
    dissolves in a browser tab is a mark that failed at its main job.
    Large sizes get the full drawing.

Everything is drawn at 8x and downsampled with LANCZOS: Pillow has no
antialiased stroking, so supersampling is how the diagonals stay clean.
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path("/home/claude/icons")
OUT.mkdir(exist_ok=True)
FONTS = Path("/tmp/claude-0/-home-claude/55beaf51-1cd7-55d3-9d1c-3d231aa912ba"
             "/scratchpad/fonts/ttf")

GROUND = (10, 12, 18)        # #0a0c12  -- between the ECG and TCA cards
TRACE  = (46, 218, 196)      # #2edac4  -- sampled off the ECG trace
AMBER  = (217, 164, 65)      # #d9a441  -- sampled off the TCA ring
MARKER = (255, 51, 102)      # #ff3366  -- sampled off an R-peak dot
GRID   = (24, 30, 40)

SS = 8                        # supersample factor


def _trace_points(S, simple=False, spike_h=0.30, baseline=0.545):
    """
    The stylus path. Flat, a small P-wave bump, the R spike, a T-wave
    bump, flat. Proportions exaggerated from a real ECG -- at icon size a
    physiologically honest P-wave is invisible.

    `simple` is the 16/32px cut: P and T waves removed, span narrowed,
    spike taller. Those bumps are 1px of grey at tab size and all they do
    is thicken the baseline into a smear, which is what the first render
    of this looked like.
    """
    if simple == "tiny":
        # 16 and 32px. The spike is OFF CENTRE and a T wave follows it.
        #
        # A centred spike on a full-width baseline is a PLUS SIGN -- four
        # variants of thinner, taller and shorter all read as a cross,
        # because that is geometrically what they are. Breaking the
        # symmetry is what makes the eye read "waveform". The large icons
        # keep their centred spike: inside the drum arc, with the apex
        # marker on top, there is enough context that the cross reading
        # never arises.
        pts = [
            (0.12, 0.620),
            (0.325, 0.620),
            (0.365, 0.120),              # R  <- the apex
            (0.405, 0.700),              # S
            (0.44, 0.620),
            (0.60, 0.620),
            (0.68, 0.420),               # T wave
            (0.76, 0.620),
            (0.88, 0.620),
        ]
        return [(x * S, y * S) for x, y in pts], 2

    if simple:
        pts = [
            (0.13, baseline),
            (0.41, baseline),
            (0.455, baseline + 0.045),   # Q
            (0.50, baseline - 0.355),    # R  <- the apex
            (0.545, baseline + 0.070),   # S
            (0.59, baseline),
            (0.87, baseline),
        ]
        return [(x * S, y * S) for x, y in pts], 3

    pts = [
        (0.10, baseline),
        (0.26, baseline),
        (0.305, baseline - 0.045),   # P wave
        (0.35, baseline),
        (0.425, baseline),
        (0.445, baseline + 0.055),   # Q
        (0.50, baseline - spike_h),  # R  <- the apex
        (0.555, baseline + 0.075),   # S
        (0.60, baseline),
        (0.66, baseline),
        (0.715, baseline - 0.065),   # T wave
        (0.77, baseline),
        (0.90, baseline),
    ]
    return [(x * S, y * S) for x, y in pts], 6


def draw_mark(size, *, rounded=True, drum=True, dot=True,
              content_scale=1.0, bleed=False, tiny=False):
    """One icon, drawn big and shrunk."""
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # ── ground ───────────────────────────────────────────────────────
    if bleed:
        d.rectangle([0, 0, S, S], fill=GROUND + (255,))
    elif rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.215),
                            fill=GROUND + (255,))
    else:
        d.rectangle([0, 0, S, S], fill=GROUND + (255,))

    # Everything below is drawn into a layer that gets scaled about the
    # centre, so the maskable variant can pull content inside the safe
    # circle without re-deriving every coordinate.
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)

    # ── drum: an open arc, gapped at the top right so it reads as
    #    turning rather than as a plain circle ────────────────────────
    if drum:
        r = 0.355
        box = [S * (0.5 - r), S * (0.5 - r), S * (0.5 + r), S * (0.5 + r)]
        ld.arc(box, start=-58, end=238, fill=AMBER + (150,),
               width=int(S * 0.050))
        # Tick marks at the drum edge: the paper's time graduations.
        for ang in (238, 270, 302):
            import math
            a = math.radians(ang)
            x0 = S * (0.5 + (r - 0.055) * math.cos(a))
            y0 = S * (0.5 + (r - 0.055) * math.sin(a))
            x1 = S * (0.5 + (r + 0.005) * math.cos(a))
            y1 = S * (0.5 + (r + 0.005) * math.sin(a))
            ld.line([x0, y0, x1, y1], fill=AMBER + (90,),
                    width=int(S * 0.022))

    # ── stylus trace ─────────────────────────────────────────────────
    pts, apex_i = _trace_points(S, simple=("tiny" if tiny else not drum))
    w = int(S * (0.060 if tiny else 0.055 if not drum else 0.062))
    ld.line(pts, fill=TRACE + (255,), width=w, joint="curve")
    # Round the ends by hand: Pillow's line() leaves square caps, which
    # look chopped where the baseline meets the icon edge.
    for end in (pts[0], pts[-1]):
        ld.ellipse([end[0] - w / 2, end[1] - w / 2,
                    end[0] + w / 2, end[1] + w / 2], fill=TRACE + (255,))

    # ── apex marker ──────────────────────────────────────────────────
    if dot:
        ax, ay = pts[apex_i]
        # NO knockout ring. The first version punched a dark hole wider
        # than the dot, which ate the top of a spike only 0.06 wide and
        # left the marker floating above a severed line like a balloon on
        # a string. Magenta on mint has contrast to spare; the dot simply
        # sits on top.
        rr = S * 0.047
        ld.ellipse([ax - rr, ay - rr, ax + rr, ay + rr],
                   fill=MARKER + (255,))

    if content_scale != 1.0:
        n = int(S * content_scale)
        small = layer.resize((n, n), Image.LANCZOS)
        layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        off = (S - n) // 2
        layer.paste(small, (off, off), small)

    img.alpha_composite(layer)
    return img.resize((size, size), Image.LANCZOS)


# ── the set ──────────────────────────────────────────────────────────
def build_icons():
    made = {}

    # Small: no drum, no dot, fatter trace. Legibility beats fidelity.
    made[16] = draw_mark(16, drum=False, dot=False, tiny=True)
    made[16].save(OUT / "favicon-16.png")
    made[32] = draw_mark(32, drum=False, dot=False, tiny=True)
    made[32].save(OUT / "favicon-32.png")

    # 48 goes into the .ico only -- Windows taskbar uses it.
    ico48 = draw_mark(48, drum=False, dot=True, tiny=True)

    for n in (180, 192, 512):
        made[n] = draw_mark(n)

    # Apple does not round corners for you and does not honour alpha --
    # a transparent-cornered touch icon comes out with black corners on
    # older iOS, so this one is drawn square and opaque.
    # Flattened to RGB: iOS ignores alpha entirely and older versions
    # composite transparent pixels onto BLACK, so an RGBA touch icon is a
    # standing invitation to black corners.
    draw_mark(180, rounded=False).convert("RGB").save(
        OUT / "apple-touch-icon.png")
    made[192].save(OUT / "icon-192.png")
    made[512].save(OUT / "icon-512.png")

    # Maskable: full bleed, content inside the central 80% safe circle.
    # Android crops this to whatever shape the launcher uses, so anything
    # near a corner is gambling.
    draw_mark(512, bleed=True, content_scale=0.74).save(
        OUT / "icon-512-maskable.png")

    # Multi-resolution .ico: 16/32/48 in one file, which is what legacy
    # Windows and a few feed readers still ask for by root path.
    # Saved from the 48px frame, not the 32px one: Pillow builds missing
    # sizes by DOWNSCALING the base image and silently drops any size
    # larger than it, so a 32px base yields an .ico with no 48px frame at
    # all -- which is the size Windows actually uses for taskbar and
    # desktop shortcuts.
    ico48.save(OUT / "favicon.ico",
               sizes=[(16, 16), (32, 32), (48, 48)],
               append_images=[made[16], made[32]])
    return made


# ── open graph card ──────────────────────────────────────────────────
def build_og():
    W, H = 1200, 630
    S = 2                                   # draw at 2x, downsample
    img = Image.new("RGB", (W * S, H * S), GROUND)
    d = ImageDraw.Draw(img)

    # Faint graph paper, as on the pathway cards.
    step = 40 * S
    for x in range(0, W * S, step):
        d.line([x, 0, x, H * S], fill=GRID, width=1)
    for y in range(0, H * S, step):
        d.line([0, y, W * S, y], fill=GRID, width=1)

    # A long trace across the lower third: three beats, the thing the
    # app actually shows.
    #
    # The baseline sits at 0.80 rather than 0.72 because at 0.72 the R
    # peaks reached up THROUGH the provenance line -- magenta dots sitting
    # on top of "Carl Ludwig". Text and signal need separating by more
    # than looks safe on the first attempt.
    base = int(H * S * 0.80)
    amp = H * S * 0.155
    # P and T get three points each instead of one. A single apex between
    # two baseline points draws a triangle, and a row of triangles reads
    # as a saw blade, not an electrocardiogram.
    BEAT = [(0.00, 0), (0.16, 0),
            (0.195, -0.07), (0.225, -0.105), (0.26, -0.07),      # P
            (0.30, 0), (0.40, 0),
            (0.435, 0.10), (0.475, -1.0), (0.515, 0.23),         # QRS
            (0.55, 0), (0.63, 0),
            (0.675, -0.13), (0.72, -0.185), (0.765, -0.125),     # T
            (0.81, 0), (1.00, 0)]
    APEX = 8                                     # index of the R peak

    path, apexes, x = [], [], 0.0
    beat = W * S / 3.0
    while x < W * S + beat:
        for i, (fx, fy) in enumerate(BEAT):
            pt = (x + fx * beat, base + fy * amp)
            path.append(pt)
            if i == APEX:
                apexes.append(pt)
        x += beat
    d.line(path, fill=TRACE, width=int(3.2 * S), joint="curve")
    # Marker dots placed from the recorded apex list rather than by
    # striding the point array -- a stride silently drifts the moment the
    # beat gains or loses a point, which is how the P wave got a dot.
    for px, py in apexes:
        r = 7 * S
        d.ellipse([px - r, py - r, px + r, py + r], fill=MARKER)

    # Mark, top left.
    mark = draw_mark(148 * S, rounded=True)
    img.paste(mark, (84 * S, 86 * S), mark)

    f_name = ImageFont.truetype(str(FONTS / "IBMPlexMono-SemiBold.ttf"), 86 * S)
    f_tag  = ImageFont.truetype(str(FONTS / "IBMPlexMono-Regular.ttf"), 27 * S)
    f_dom  = ImageFont.truetype(str(FONTS / "IBMPlexMono-Medium.ttf"), 23 * S)

    d.text((262 * S, 96 * S), "kymograph", font=f_name, fill=(238, 243, 248))
    d.text((266 * S, 196 * S),
           "algorithms, one step at a time",
           font=f_tag, fill=(126, 142, 158))

    # The provenance line. Worth the pixels: it is the reason the name
    # is the name, and it turns an unfamiliar word into a story in the
    # two seconds someone spends on a link preview.
    d.text((86 * S, 300 * S),
           "ECG  ·  WAVELETS  ·  CIPHERS  ·  METABOLISM  ·  SIMD",
           font=f_dom, fill=AMBER)
    d.text((86 * S, 346 * S),
           "after Carl Ludwig's recording drum, 1847",
           font=f_tag, fill=(96, 110, 124))

    d.text((86 * S, 552 * S), "kymograph.dev", font=f_dom,
           fill=(150, 166, 182))

    img.resize((W, H), Image.LANCZOS).save(OUT / "og_preview.png",
                                           optimize=True)


if __name__ == "__main__":
    build_icons()
    build_og()
    for p in sorted(OUT.iterdir()):
        print(f"{p.name:28} {p.stat().st_size / 1024:7.1f} KB")
