"""Labelling aid for edge ground truth: crop a scan's photo, enlarge it, draw a camera-pixel grid,
and overlay the segments already in tools/edge_truth/<scan>.json (if any) in red.

Run: uv run --no-project --python 3.13 --with pillow python -I tools/label_view.py <scan-dir> x0 y0 x1 y1 [scale]
Writes <scan-dir>/label_view.png
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

scan = Path(sys.argv[1])
x0, y0, x1, y1 = map(int, sys.argv[2:6])
k = float(sys.argv[6]) if len(sys.argv) > 6 else 2.0
img = ImageOps.autocontrast(Image.open(scan / "edges.png").convert("L").crop((x0, y0, x1, y1)), cutoff=1)
img = img.resize((int((x1 - x0) * k), int((y1 - y0) * k)), Image.NEAREST).convert("RGB")
d = ImageDraw.Draw(img)
for x in range((x0 // 20 + 1) * 20, x1, 20):
    d.line([((x - x0) * k, 0), ((x - x0) * k, img.height)], fill=(0, 90, 160) if x % 100 else (0, 200, 255))
    if x % 100 == 0:
        d.text(((x - x0) * k + 2, 2), str(x), fill=(255, 255, 0))
for y in range((y0 // 20 + 1) * 20, y1, 20):
    d.line([(0, (y - y0) * k), (img.width, (y - y0) * k)], fill=(0, 90, 160) if y % 100 else (0, 200, 255))
    if y % 100 == 0:
        d.text((2, (y - y0) * k + 2), str(y), fill=(255, 255, 0))
truth = Path(__file__).parent / "edge_truth" / f"{scan.name}.json"
if truth.exists():
    for sx, sy, ex, ey in json.loads(truth.read_text())["segments"]:
        d.line([((sx - x0) * k, (sy - y0) * k), ((ex - x0) * k, (ey - y0) * k)], fill=(255, 40, 40), width=2)
img.save(scan / "label_view.png")
print(scan / "label_view.png", img.size)
