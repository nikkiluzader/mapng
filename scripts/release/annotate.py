#!/usr/bin/env python3
"""Mark up a screenshot for an update page: numbered outlines with short labels.

  python scripts/release/annotate.py <in> <out> '<json list of marks>'

A mark: {"box": [x, y, w, h]} or {"ellipse": [cx, cy, rx, ry]}, with "n" (the badge's number,
matching the page's numbered list or caption) and optionally "label" (a few words drawn beside
the badge) and "at": "tl" | "tr" | "bl" | "br" (the outline's corner the badge sits on; tl by
default). Outlines are MapNG orange with a white edge so they read on light and dark pictures.
Needs Pillow.
"""
import json, sys
from PIL import Image, ImageDraw, ImageFont

ORANGE = (255, 102, 0); WHITE = (255, 255, 255); INK = (24, 24, 28)

def font(size):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'):
        try: return ImageFont.truetype(f, size)
        except Exception: pass
    return ImageFont.load_default()

def annotate(src, dst, marks, quality=90):
    im = Image.open(src).convert('RGB'); d = ImageDraw.Draw(im)
    s = max(1.0, im.width / 1440)                      # sizes follow the picture's width
    lw = round(4 * s); r = round(17 * s); f = font(round(20 * s)); fl = font(round(17 * s))
    for m in marks:
        if 'box' in m:
            x, y, w, h = m['box']; x0, y0, x1, y1 = x, y, x + w, y + h
            d.rounded_rectangle([x0 - 2, y0 - 2, x1 + 2, y1 + 2], radius=round(10 * s), outline=WHITE, width=lw + 4)
            d.rounded_rectangle([x0, y0, x1, y1], radius=round(8 * s), outline=ORANGE, width=lw)
        else:
            cx, cy, rx, ry = m['ellipse']; x0, y0, x1, y1 = cx - rx, cy - ry, cx + rx, cy + ry
            d.ellipse([x0 - 2, y0 - 2, x1 + 2, y1 + 2], outline=WHITE, width=lw + 4)
            d.ellipse([x0, y0, x1, y1], outline=ORANGE, width=lw)
        at = m.get('at', 'tl'); bx = x0 if 'l' in at else x1; by = y0 if 't' in at else y1
        bx = min(max(bx, r + 2), im.width - r - 2); by = min(max(by, r + 2), im.height - r - 2)
        label = m.get('label')
        if label:
            tw = d.textlength(label, font=fl); pad = round(8 * s)
            lx0 = bx + r - 2 if bx + r + tw + 2 * pad < im.width else bx - r - tw - 2 * pad + 2
            d.rounded_rectangle([lx0, by - r + 2, lx0 + tw + 2 * pad, by + r - 2], radius=round(6 * s), fill=INK)
            d.text((lx0 + pad, by), label, fill=WHITE, font=fl, anchor='lm')
        d.ellipse([bx - r - 2, by - r - 2, bx + r + 2, by + r + 2], fill=WHITE)
        d.ellipse([bx - r, by - r, bx + r, by + r], fill=ORANGE)
        d.text((bx, by), str(m.get('n', '')), fill=WHITE, font=f, anchor='mm')
    im.save(dst, quality=quality)

if __name__ == '__main__':
    annotate(sys.argv[1], sys.argv[2], json.loads(sys.argv[3]))
