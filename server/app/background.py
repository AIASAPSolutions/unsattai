"""POST /logos/remove-background: make a plain, uniform background transparent.

Only the background connected to the image border is removed (a flood fill from
the edges), so same-coloured areas inside the logo survive. When the border is
not a single plain colour nothing is changed and the reason is returned; the app
always keeps the original so the customer can compare and choose.
"""
from __future__ import annotations

import base64
import io
from collections import deque

from PIL import Image

from .schemas import DATA_URL_RE, MAX_LOGO_BYTES

MAX_PIXELS = 4096 * 4096


def _close(a, b, tol: int) -> bool:
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol and abs(a[2] - b[2]) <= tol


def remove_background(data_url: str, tolerance: int = 24) -> dict:
    m = DATA_URL_RE.match(data_url)
    if not m or m.group(1) == "image/svg+xml":
        raise ValueError("background removal needs a PNG or JPEG data URL")
    raw = base64.b64decode(m.group(2))
    if len(raw) > MAX_LOGO_BYTES:
        raise ValueError("logo is larger than 1.5 MB")
    img = Image.open(io.BytesIO(raw))
    if img.width * img.height > MAX_PIXELS:
        raise ValueError("image is too large to process")
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()

    border = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)] + \
             [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)]
    opaque = [p for p in border if p[3] > 200]
    if len(opaque) < 0.9 * len(border):
        return {"applied": False, "data_url": data_url, "background": None, "removed_ratio": 0.0,
                "reason": "The image already has a transparent background."}
    ref = max(set(p[:3] for p in opaque), key=lambda c: sum(1 for p in opaque if _close(p, c, 6)))
    if sum(1 for p in opaque if _close(p, ref, tolerance)) < 0.85 * len(opaque):
        return {"applied": False, "data_url": data_url, "background": None, "removed_ratio": 0.0,
                "reason": "The background is not a single plain colour, so it was left as is."}

    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.extend(((x, 0), (x, h - 1)))
    for y in range(h):
        q.extend(((0, y), (w - 1, y)))
    removed = 0
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        p = px[x, y]
        if p[3] <= 200 or not _close(p, ref, tolerance):
            continue
        px[x, y] = (p[0], p[1], p[2], 0)
        removed += 1
        if x > 0:
            q.append((x - 1, y))
        if x < w - 1:
            q.append((x + 1, y))
        if y > 0:
            q.append((x, y - 1))
        if y < h - 1:
            q.append((x, y + 1))

    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    return {"applied": True, "data_url": "data:image/png;base64," + base64.b64encode(out.getvalue()).decode(),
            "background": "#%02x%02x%02x" % ref, "removed_ratio": round(removed / (w * h), 3), "reason": None}
