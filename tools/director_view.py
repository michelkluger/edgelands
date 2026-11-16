"""Render what the projector "sees" for the Haiku level director.

Scene photo (camera space) is warped into projector tile space via calibration/map.bin,
edge tiles from level.json are outlined in cyan, and a labelled grid (every 10 tiles) lets the
director answer in tile coordinates (c, r) that the game uses directly.

Run: uv run --no-project --python 3.13 --with pillow python -I tools/director_view.py
"""

import json
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw

CAL = Path(__file__).resolve().parent.parent / "calibration"
SCALE = 1  # projector px per output px; 1280×720 stays readable for a vision model


def main() -> None:
    level = json.loads((CAL / "level.json").read_text())
    calib = json.loads((CAL / "calibration.json").read_text())
    tile, rows = level["tile"], level["map"]
    cols, nrows = len(rows[0]), len(rows)
    cw, ch = calib["cam"]
    photo_path = CAL / "edges.png" if (CAL / "edges.png").exists() else CAL / "white.png"
    photo = Image.open(photo_path).convert("L")
    if photo.size != (cw, ch):
        sys.exit(f"{photo_path.name} is {photo.size}, calibration says {(cw, ch)}: press C then E again")
    lut = (CAL / "map.bin").read_bytes()
    pix = photo.tobytes()

    # average the photo's brightness per projector tile
    total = [0] * (cols * nrows)
    count = [0] * (cols * nrows)
    for i, (u, v) in enumerate(struct.iter_unpack("<hh", lut)):
        if u < 0 or v < 0:
            continue
        c, r = u // tile, v // tile
        if c < cols and r < nrows:
            total[r * cols + c] += pix[i]
            count[r * cols + c] += 1

    img = Image.new("RGB", (cols * tile, nrows * tile), (20, 0, 30))  # purple = the beam doesn't reach here
    d = ImageDraw.Draw(img)
    for r in range(nrows):
        for c in range(cols):
            k = r * cols + c
            if count[k]:
                g = total[k] // count[k]
                d.rectangle([c * tile, r * tile, (c + 1) * tile - 1, (r + 1) * tile - 1], fill=(g, g, g))
            if rows[r][c] == "#":
                d.rectangle([c * tile, r * tile, (c + 1) * tile - 1, (r + 1) * tile - 1], outline=(0, 230, 255))
    for c in range(0, cols, 10):
        d.line([c * tile, 0, c * tile, nrows * tile], fill=(255, 60, 60))
        d.text((c * tile + 2, 2), f"c{c}", fill=(255, 255, 0))
    for r in range(0, nrows, 10):
        d.line([0, r * tile, cols * tile, r * tile], fill=(255, 60, 60))
        d.text((2, r * tile + 2), f"r{r}", fill=(255, 255, 0))
    out = CAL / "director_view.png"
    img.save(out)
    print(f"{out}  ({cols}×{nrows} tiles of {tile} px, photo {photo_path.name})")


if __name__ == "__main__":
    main()
