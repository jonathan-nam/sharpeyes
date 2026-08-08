"""Which items in this screenshot do we NOT know about?

Adding an item to the catalog needs a template, and a template has to be cut from the
client's own rendering. Wiki artwork sits right on the accept threshold and drops out
the moment a screenshot is JPEG-compressed (see build_icons.py). So every new item starts
with a screenshot that contains it.

But a screenshot is 128 slots of pixels, and pixels carry no names. Something has to bridge
"slot r3c5 holds an icon we've never seen" and "that is Sayram's Elixir", and only a human
can do that.

So: find every occupied slot that no catalog template matches, and lay the crops out as a
contact sheet with its grid reference written on it. A person reads the sheet, says "r3c5 is
Sayram's", and cut_template() does the rest.

    python -m app.cv.discover <screenshot.png> [-o sheet.png]

The CLI is the maintainer's half. The same unknown_slots() feeds POST /discover, which is
the user's: same question, answered with crops instead of a sheet.
"""

import argparse
import sys
from collections.abc import Iterable

import cv2
import numpy as np

from .classify import OCCUPIED, _busy, classify
from .grid import COLS, NATIVE_PITCH, ROWS, find_grid
from .match import load_templates
from .pipeline import normalize

# Enough to read an icon comfortably on a contact sheet; the icons are 46px.
ZOOM = 3
LABEL_H = 16
PAD = 6


def unknown_slots(img: np.ndarray, g, known: Iterable[tuple[int, int]]) -> list[tuple[int, int]]:
    """Occupied slots that no catalog template claims.

    `known` comes from the caller's own classify() pass. It is not recomputed here because
    classify is the expensive half of a parse, and both callers have already run it.

    This is most of the inventory, not a shortlist. Measured on the reference captures, 65
    to 87 of the 128 slots: a player's tab is mostly scrolls, cubes and coupons the catalog
    has no opinion about. So this answers "what could be tracked", never "what went wrong".
    """
    known = set(known)
    out = []
    for r in range(ROWS):
        for c in range(COLS):
            if (r, c) in known:
                continue
            x, y, w, h = g.cell(r, c)
            cell = img[y : y + h, x : x + w]
            if cell.size and _busy(cell) >= OCCUPIED:
                out.append((r, c))
    return out


def contact_sheet(img: np.ndarray, g, slots: list[tuple[int, int]], cols: int = 8) -> np.ndarray:
    """Every unknown slot, magnified, with its grid reference under it."""
    if not slots:
        return np.zeros((1, 1, 3), np.uint8)

    tile_w = int(NATIVE_PITCH * ZOOM)
    tile_h = tile_w + LABEL_H
    rows = (len(slots) + cols - 1) // cols

    sheet = np.full(((tile_h + PAD) * rows + PAD, (tile_w + PAD) * cols + PAD, 3), 32, np.uint8)

    for i, (r, c) in enumerate(slots):
        x, y, w, h = g.cell(r, c)
        cell = img[y : y + h, x : x + w]
        big = cv2.resize(cell, (tile_w, tile_w), interpolation=cv2.INTER_NEAREST)

        ty = PAD + (tile_h + PAD) * (i // cols)
        tx = PAD + (tile_w + PAD) * (i % cols)
        sheet[ty : ty + tile_w, tx : tx + tile_w] = big

        cv2.putText(
            sheet,
            f"r{r}c{c}",
            (tx + 2, ty + tile_w + 12),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.4,
            (0, 255, 255),
            1,
            cv2.LINE_AA,
        )
    return sheet


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("screenshot")
    ap.add_argument("-o", "--out", default="unknown-items.png")
    args = ap.parse_args()

    img = cv2.imread(args.screenshot)
    if img is None:
        sys.exit(f"cannot read {args.screenshot}")

    g = find_grid(img)
    img, g = normalize(img, g)

    hits = classify(img, g, load_templates())
    slots = unknown_slots(img, g, [(h.row, h.col) for h in hits])

    print(f"  {len(hits)} slots hold items we already know")
    print(f"  {len(slots)} slots hold items we do NOT know")
    for r, c in slots:
        print(f"    r{r}c{c}")

    cv2.imwrite(args.out, contact_sheet(img, g, slots))
    print(f"\n  contact sheet -> {args.out}")


if __name__ == "__main__":
    main()
