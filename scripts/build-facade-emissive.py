#!/usr/bin/env python3
"""
Generate public/beamng_facade_e.png: a night emissive map for BeamNG's
t_highrise_plaster window sheet (the facade material of MapNG buildings).

The game's own t_highrise_plaster_e lights only band 1 (the four panel
windows); bands 0, 2 and 3 (tall windows, sash windows on plaster, sash
windows on brick) are black, so houses (one band-2 sash window, WIN_UV in
services/beamngBuildings.js) and most apartment walls never lit at night.
This map keeps the official band 1 and lights the glass of the other
bands from their own colour (curtains and blinds glow brighter than clear
glass), warm-tinted, in about half the bays so a block reads lived-in;
band 2's bay 0 (the house window) is always lit and the black "open"
windows stay dark. Frames and walls stay black: only an inset of each
window rectangle is lit.

Window rectangles are in 1024 px sheet coordinates, measured from the
0.40 colour map. Run from the repo root after a BeamNG update:
    python3 scripts/build-facade-emissive.py
"""
import io
import os
import zipfile

from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRIM = os.path.join(REPO, "refs/beamng/content/assets/materials/trim.zip")
OUT = os.path.join(REPO, "public/beamng_facade_e.png")
BASE = "assets/materials/trim/plaster/t_highrise_plaster/t_highrise_plaster_b.color.dds"
EMIT = "assets/materials/trim/plaster/t_highrise_plaster/t_highrise_plaster_e.color.dds"

S = 1024
# (x0, y0, x1, y1, lit) window rectangles per band, 1024 px, top-left origin
WINDOWS = [
    # band 0: tall windows (3 bays across the sheet, the third a wide pane)
    (76, 20, 204, 240, True), (324, 20, 451, 240, False), (573, 20, 993, 240, True),
    # band 2: sash windows on plaster (bay 0 = the house window, always lit)
    (53, 560, 154, 727, True), (253, 560, 354, 727, False), (460, 560, 560, 727, True),
    (664, 560, 764, 727, False), (870, 560, 971, 727, True),
    # band 3: sash windows on brick
    (40, 807, 160, 965, True), (247, 807, 367, 965, False), (453, 807, 573, 965, True),
    (657, 807, 777, 965, True), (863, 807, 983, 965, False),
]
INSET = 7                      # px of frame left dark
WARM = (1.0, 0.82, 0.58)       # interior light
GAIN = 0.75


def main():
    with zipfile.ZipFile(TRIM) as zf:
        base = Image.open(io.BytesIO(zf.read(BASE))).convert("RGB").resize((S, S))
        emit = Image.open(io.BytesIO(zf.read(EMIT))).convert("RGB").resize((S, S))
    out = Image.new("RGB", (S, S), (0, 0, 0))
    # band 1: the official lit panel windows
    out.paste(emit.crop((0, S // 4, S, S // 2)), (0, S // 4))
    bp = base.load()
    op = out.load()
    for x0, y0, x1, y1, lit in WINDOWS:
        if not lit:
            continue
        for y in range(y0 + INSET, y1 - INSET):
            for x in range(x0 + INSET, x1 - INSET):
                r, g, b = bp[x, y]
                lum = (r + g + b) / 3
                if lum < 40:      # the black "open" windows and deep shadows
                    continue
                v = min(255, lum * GAIN)
                op[x, y] = tuple(int(v * w) for w in WARM)
    out.save(OUT, optimize=True)
    print(f"Wrote {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
