#!/usr/bin/env python3
"""Generate iBay Plus extension icons (bag + heart motif on a teal rounded square)."""
from PIL import Image, ImageDraw

BG = (0, 150, 136, 255)      # teal
FG = (255, 255, 255, 255)    # white
ACCENT = (255, 87, 34, 255)  # deep orange heart


def rounded_rect(draw, xy, radius, fill):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill)


def make_icon(size: int) -> Image.Image:
    s = 4  # supersample factor for crisp edges
    S = size * s
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Background rounded square
    pad = 0.06 * S
    rounded_rect(d, (pad, pad, S - pad, S - pad), radius=0.18 * S, fill=BG)

    # Shopping bag body
    bag_l, bag_r = 0.24 * S, 0.76 * S
    bag_t, bag_b = 0.34 * S, 0.82 * S
    d.rounded_rectangle((bag_l, bag_t, bag_r, bag_b), radius=0.06 * S, fill=FG)

    # Bag handle (arc)
    handle_w = 0.09 * S
    d.arc((0.36 * S, 0.16 * S, 0.64 * S, 0.44 * S), start=180, end=360,
          fill=FG, width=int(handle_w))

    # Heart on the bag
    cx, cy = 0.5 * S, 0.58 * S
    w = 0.30 * S  # heart width
    r = w / 2
    top = cy - 0.10 * S
    d.ellipse((cx - r, top, cx, top + r), fill=ACCENT)
    d.ellipse((cx, top, cx + r, top + r), fill=ACCENT)
    d.polygon([(cx - r, top + r * 0.7), (cx + r, top + r * 0.7),
               (cx, cy + 0.18 * S)], fill=ACCENT)

    return img.resize((size, size), Image.LANCZOS)


for px in (16, 32, 48, 128):
    make_icon(px).save(f"icons/icon{px}.png")
    print(f"icons/icon{px}.png written")
