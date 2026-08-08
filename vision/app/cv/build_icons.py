"""Build the two kinds of picture we keep of an item, from the client's own pixels.

They are different jobs and they want opposite things from the same slot:

  * The MATCHING template (`--cut`, `templates/token-<key>.png`) is the item's IDENTITY. The
    stack-count digits and the cyan slot-lock bar belong to one screenshot rather than to the
    item, so both are masked out. Otherwise an item would stop matching itself the moment its
    count changed or the player locked its slot.

  * The DISPLAY icon (`--display`, the backend's seed-assets) is the item's PICTURE. It needs
    the digits and the bar gone too, but everything else kept. Including the art *underneath*
    them, which a single screenshot never captured. That art is recovered by compositing across
    captures rather than invented; see composite_display_icon().

Both must be cut from a NATIVE-scale capture. Parsing tolerates a rescaled screenshot, but
authoring from one bakes a blurred guess into the catalog forever. See cut().

    python -m app.cv.build_icons <shot.png> --cut kalos-token=r7c12 ...
    python -m app.cv.build_icons --display <shot.png> <shot2.png> ...
"""

import re
import sys
from pathlib import Path

import cv2
import numpy as np

from .admit import NotNativeScale, require_native_scale
from .grid import COLS, NATIVE_PITCH, ROWS, Grid, find_grid
from .match import load_templates
from .ocr import count_spans, load_font

TEMPLATE_DIR = Path(__file__).parent / "templates"

# Slot-relative regions to keep out of the mask (native 46px slot).
DIGIT_ZONE = (26, 41, 0, 41)  # y0, y1, x0, x1, where counts are drawn
BOTTOM_BAR = 40  # rows below this carry the slot-lock bar

BG_LO, BG_HI = 214, 238  # the slot's flat grey backing

# The slot's raised border ridge lives in the outermost ring of pixels. The display mask drops
# it by position, not by brightness. See _cut_out(). The icon art does not reach the very
# edge, so this costs nothing.
BORDER = 2

# An icon is one connected shape (plus, sometimes, a detached sparkle or a ring segment worth
# keeping). Anything smaller than this is slot noise rather than art, and it reads as dirt
# floating next to the item in the inventory grid.
MIN_ISLAND = 12

# The count reader takes its band a few pixels LEFT of the cell, because the count is drawn hard
# against that edge and the grid is only ever good to a pixel. A bare 46x46 cell has nothing there
# to widen into, so _occluded() hands it that margin explicitly.
BAND_PAD = 6
BG_FLAT = (226, 226, 226)  # the backing colour, for painting over the slot-lock bar


def _background(cell: np.ndarray) -> np.ndarray:
    """The slot's flat grey backing. Everything else is icon art."""
    grey = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(cell, cv2.COLOR_BGR2HSV)
    return (grey >= BG_LO) & (grey <= BG_HI) & (hsv[:, :, 1] < 40)


def icon_mask(cell: np.ndarray) -> np.ndarray:
    """The mask used for MATCHING: the icon, minus anything that is not its identity.

    The count digits differ per screenshot, and the cyan bar along the bottom is the SLOT's
    state, not the item's: it marks a slot the player has locked against the in-game auto-sort.
    The same item is barred in one slot and bare in another, so both regions are cut out.
    Otherwise we would bake one screenshot's incidentals into the catalog and an item would
    stop matching itself the moment the player locked its slot.
    """
    mask = (~_background(cell)).astype(np.uint8) * 255

    y0, y1, x0, x1 = DIGIT_ZONE
    mask[y0:y1, x0:x1] = 0
    mask[BOTTOM_BAR:, :] = 0

    # Drop speckle so the mask is the icon body, not stray antialiased pixels.
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return mask


def _occluded(cell: np.ndarray, font: dict) -> np.ndarray:
    """Which pixels of this slot are hidden by something that is not the item.

    Two things cover the art: the stack-count digits, and the slot-lock bar. Both belong to
    this screenshot rather than to the item, and neither can be seen through.
    """
    # ASK THE READER where the count is. Do not re-derive it.
    #
    # This used to run its own glyph matcher over the count band at a slack threshold, and every
    # attempt to make that work failed in a new way. Masking the matched shapes left the ghost of
    # a digit behind (a near-miss glyph counts as "visible", and its dark outline goes into the
    # icon). Masking everything left of the rightmost match was worse: the matcher fires happily
    # on the ARTWORK, so one spurious hit out in the icon swallowed everything to its left.
    # Walking out from the left edge instead was defeated by the Extreme Blue Potion, whose dark
    # bottle outline produces digit-like hits contiguously across the entire band, so the walk
    # never found a gap, declared all 46 columns hidden, and the bottle came back as a smear.
    #
    # The thing that actually knows where the digits are is the count reader, which has the
    # outline-agreement gate that rejects artwork, and it is the same code, so the answer here
    # cannot drift away from the number we report. It reads this potion as '8'. Take its decode
    # and occlude exactly the span it consumed.
    # The reader takes its band with a few pixels of margin to the LEFT of the cell, because the
    # count is drawn hard against that edge and the grid is only good to a pixel. A bare cell has
    # no left margin to take, so the band comes back clipped and the decode finds nothing. Give it
    # the margin it expects, filled with the slot's own backing.
    pad = np.full((cell.shape[0], BAND_PAD, 3), BG_FLAT, np.uint8)
    padded = np.hstack([pad, cell[:, :, :3]])
    grid = Grid(x=float(BAND_PAD), y=0.0, pitch=NATIVE_PITCH, n_cells=1)
    spans = count_spans(padded, grid, 0, 0, font)

    y0, y1, x0, x1 = DIGIT_ZONE
    occ = np.zeros(cell.shape[:2], np.uint8)
    if spans:
        right = max(x + w for x, w in spans) + 2
        occ[y0:y1, x0 : x0 + min(right, x1 - x0)] = 1
    else:
        # A count we could not locate is NOT a slot with no count. Erring towards "visible" here
        # bakes the digits into the artwork permanently; erring towards "hidden" costs this
        # instance a strip that some other capture of the same item will almost certainly supply.
        # The asymmetry is the whole point, one is a permanent defect in the catalog, the other
        # is a pixel we go and fetch from elsewhere.
        occ[y0:y1, x0:x1] = 1

    occ[BOTTOM_BAR:, :] = 1
    return occ.astype(bool)


MAX_SHIFT = 3  # px; the fitted grid origin is never further out than this
EMPTY_SLOT_SCORE = 0.90  # how well a slot must match the empty-slot template to vote on the fit

# There used to be a per-instance alignment search here: register each capture of an item against a
# reference capture before combining them. It is gone, and it should stay gone. The icons are
# glowing, near-symmetric blobs, so "best overlap" has spurious minima a few pixels off true and
# the search happily found them, it shifted half the catalog by 2-5px and BLURRED the artwork it
# was meant to be sharpening. Registering the LATTICE once per capture, against a landmark that is
# identical in every screenshot (see slot_offsets), is the reliable thing. Asking the artwork to
# align itself is not.

# How closely a donor capture must agree with the base one, over the pixels both can see, before
# it is allowed to fill in the pixels the base cannot.
#
# The tolerance is not zero, and cannot be: the SAME sprite is not the same pixels in different
# slots. The slot's grey backing carries a faint per-row gradient (the same fact that defeated
# exact pixel-hashing in classify.py), and the icons' glow is antialiased OVER that backing, so
# an identical icon a few rows down genuinely differs by a few levels. What we are ruling out is
# a donor that is MISALIGNED, which shows up as wholesale disagreement, not as a few levels.
DONOR_TOLERANCE = 24
DONOR_AGREEMENT = 0.90


def composite_display_icon(cells: list[np.ndarray], font: dict) -> np.ndarray:
    """One item's true artwork, assembled from every slot we have ever seen it in.

    The stack count is drawn ON TOP of the icon, so the pixels beneath it were never captured
    and cannot be recovered from a single screenshot. The previous version inpainted them.
    Reconstructing plausible art from the surrounding colours, and it looked like exactly
    what it was: a guess, soft and smeared across the bottom-left of every tall icon.

    But the same item turns up in several captures with DIFFERENT counts, and a different count
    hides different pixels. A '1' covers five columns; a '2655' covers forty. Cernium appears as
    1, 340, 786 and 2655. So instead of inventing the hidden pixels, take them from a capture
    where they are not hidden. Every pixel of the result is a verbatim client pixel, CHOSEN from
    one capture. Never blended between several, which is just blur by another name.

    Measured over the corpus, the number of pixels still hidden in EVERY instance falls to 45
    (Cernium) - 317 (Vanishing Journey, whose counts are all four digits and so always cover the
    same place) out of the 1840 above the bar. Only those get inpainted.

    Returns the FULL 46x46 slot, not a crop: the icon's position within the slot is part of how
    the client draws it, and the UI now renders these 1:1 at the client's own slot size.
    """
    # The cells arriving here are already pinned to the client's true slot boundaries, because
    # build_display_icons corrects each capture's grid origin against the empty-slot template
    # before cutting anything. So every instance of an item is registered to every other by
    # construction, and the median below combines like with like.
    #
    # There WAS a per-instance alignment search here, and removing it was the fix rather than a
    # simplification. Registering each instance against a reference instance sounds harmless and
    # is not: the icons are glowing, near-symmetric blobs, so "best overlap" has spurious minima
    # a few pixels off true, and the search happily found them. It shifted half the catalog by 2
    # to 5 pixels and blurred the artwork it was supposed to be sharpening, the symbols ended
    # up matching their own raw slot at 0.45. Correcting the ORIGIN, once per capture, against a
    # landmark that is identical in every screenshot, is the reliable thing; asking the artwork
    # to align itself is not.
    occs = [_occluded(c, font) for c in cells]
    stack = np.stack([c[:, :, :3].astype(np.float32) for c in cells])
    visible = np.stack([~o for o in occs])

    # CHOOSE a pixel; do not average pixels.
    #
    # This took the per-pixel MEDIAN across every instance in which the pixel was visible, on the
    # reasoning that a median would also wash out JPEG noise. It washes out the artwork. With two
    # instances a median IS the mean. The Extreme Blue Potion, which we only ever see in two
    # captures, was literally an average of two pictures, and it looked exactly as soft as that
    # sounds. Even with five, any residual disagreement between captures gets blended rather than
    # resolved.
    #
    # There is nothing to average. Every instance is the client drawing the same sprite, so any
    # pixel visible in any instance is already the exact pixel we want. Prefer the instance with
    # the least occlusion (its unhidden region is the largest and the most trustworthy) and fall
    # through to the next only where that one is covered. Every pixel in the result is then a
    # verbatim client pixel, not a blend of several.
    order = np.argsort([o.sum() for o in occs])
    base = int(order[0])

    bgr = np.full((46, 46, 3), BG_FLAT, np.uint8)
    filled = visible[base].copy()
    bgr[filled] = stack[base][filled].astype(np.uint8)

    for i in order[1:]:
        # TRUST, BUT VERIFY. A donor is only allowed to contribute pixels the base could not see
        # if it demonstrably lines up with the base where they BOTH can see.
        #
        # Pasting every donor in on the strength of the per-capture origin correction alone is
        # what wrecked the Extreme Blue Potion. It has only two captures,
        # both showing a single-digit count, so the same strip is hidden in both and the second
        # was doing all the filling; the correction was a pixel out for that capture, and the
        # bottle's whole lower body came back as a misaligned smear. One bad donor is worse than
        # no donor: the hole would merely have been inpainted.
        overlap = visible[base] & visible[i]
        if overlap.sum() < 200:
            continue
        agree = (
            np.abs(stack[base][overlap] - stack[i][overlap]).max(axis=-1) <= DONOR_TOLERANCE
        ).mean()
        if agree < DONOR_AGREEMENT:
            continue

        take = visible[i] & ~filled
        bgr[take] = stack[i][take].astype(np.uint8)
        filled |= take

    # Whatever no capture ever showed us. Reconstruct, but now it is a handful of pixels
    # rather than the whole count band.
    hole = (~filled).astype(np.uint8)
    hole[BOTTOM_BAR:, :] = 0  # the bar is not a hole in the art; there is simply nothing there
    if hole.any():
        bgr = cv2.inpaint(bgr, hole, 3, cv2.INPAINT_TELEA)

    return _cut_out(bgr, hole)


def _cut_out(bgr: np.ndarray, hole: np.ndarray | None = None) -> np.ndarray:
    """Alpha the slot backing away, leaving the item on transparency. Full 46x46, uncropped.

    `hole` marks pixels no capture ever showed, because the stack count covered them in every
    one. Their COLOUR has been inpainted, but their alpha must not be decided by thresholding
    that inpainted colour: where the reconstruction leans towards the backing grey, the pixel
    drops out of the silhouette and the icon loses a piece of itself.

    That is not a cosmetic loss. The digits sit at the slot's bottom-LEFT, so the missing pixels
    all sit on one side, and every icon's bounding box, and with it its apparent centre.
    Slid to the RIGHT. The Arcane symbols, whose counts are four digits wide in every capture we
    have and so hide the same 300 pixels every time, ended up 5px off centre and visibly clipped.
    Everything looked subtly, inexplicably misaligned.

    So the SHAPE across a hole is reconstructed as a shape: inpaint the alpha channel too, and
    let the silhouette flow across the gap instead of being re-derived from a guessed colour.
    """
    grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    sat = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[:, :, 1]
    chrome = (grey >= BG_LO) & (grey <= BG_HI) & (sat < 40)

    mask = (~chrome).astype(np.uint8) * 255
    if hole is not None and hole.any():
        known = mask.copy()
        known[hole > 0] = 0
        mask = cv2.inpaint(known, hole, 3, cv2.INPAINT_TELEA)
        mask = np.where(mask >= 128, 255, 0).astype(np.uint8)
    mask[BOTTOM_BAR:, :] = 0
    mask[:BORDER, :] = 0
    mask[-BORDER:, :] = 0
    mask[:, :BORDER] = 0
    mask[:, -BORDER:] = 0
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

    n, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), 8)
    if n > 1:
        keep = np.zeros_like(mask)
        biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        for i in range(1, n):
            if i == biggest or stats[i, cv2.CC_STAT_AREA] >= MIN_ISLAND:
                keep[labels == i] = 255
        mask = keep

    return cv2.merge([*cv2.split(bgr), mask])


def slot_offsets(img: np.ndarray, g: Grid) -> dict[tuple[int, int], tuple[int, int]]:
    """Per-slot (dy, dx) to add to g.cell(), bringing each cell onto the client's real boundary.

    find_grid's lattice is good to a pixel or two, which is ample for matching, the matcher
    slides, and not nearly enough for authoring a picture. But the error is NOT a constant
    offset, which is what makes this subtle: measured against the empty-slot template, some slots
    in a single capture land at x=0 and others at x=+2. The pitch is fractionally off 46.0 and the
    error ACCUMULATES across the sixteen columns, so no single correction can straighten it, a
    per-capture nudge just moves which columns are wrong.

    So fit, rather than nudge. The empty slot is the same pixels in every capture, so every empty
    slot in the frame is a measurement of where the lattice really is. Least-squares a line through
    them (x = x0 + pitch*col, and the same down the rows) and the whole grid comes into register,
    including the busy cells that could not be measured directly.
    """
    tpl = cv2.imread(str(TEMPLATE_DIR / "slot_empty.png"), cv2.IMREAD_COLOR)
    if tpl is None:
        return {}

    n = int(NATIVE_PITCH)
    pad = MAX_SHIFT
    xs: list[tuple[int, float]] = []
    ys: list[tuple[int, float]] = []
    for row in range(ROWS):
        for col in range(COLS):
            x, y, w, _ = g.cell(row, col)
            win = img[y - pad : y + w + pad, x - pad : x + w + pad]
            if win.shape[:2] != (n + 2 * pad, n + 2 * pad):
                continue
            res = cv2.matchTemplate(win, tpl, cv2.TM_CCOEFF_NORMED)
            _, score, _, loc = cv2.minMaxLoc(res)
            # Only a genuinely empty slot gets a vote. A slot full of icon art has nothing useful
            # to say about where its own boundary is.
            if score >= EMPTY_SLOT_SCORE:
                xs.append((col, x + loc[0] - pad))
                ys.append((row, y + loc[1] - pad))

    if len(xs) < 6:
        return {}

    # Per COLUMN and per ROW, not one line through everything.
    #
    # Fitting a single lattice (origin + pitch) was the obvious move and it made things worse. Grid
    # carries ONE pitch for both axes, so the x-fit and the y-fit had to be averaged into it, and
    # since only x drifts (y measured dead-on in every capture), averaging in a y-pitch it did not
    # need dragged x off by 1-3px in every column at once. A global fit also assumes the drift is
    # linear, which is an assumption we do not need to make and cannot check.
    #
    # The drift is per-column, so measure it per-column. Every empty slot in a column is a direct
    # reading of where that column really starts; take the median. Columns with no empty slot in
    # them inherit the frame's overall median, which is the best we can say about them.
    def offsets(points: list[tuple[int, float]], predicted) -> dict[int, int]:
        by: dict[int, list[float]] = {}
        for i, measured in points:
            by.setdefault(i, []).append(measured - predicted(i))
        overall = int(round(np.median([d for ds in by.values() for d in ds])))
        return {i: int(round(np.median(ds))) for i, ds in by.items()}, overall

    dx_by_col, dx_all = offsets(xs, lambda c: g.cell(0, c)[0])
    dy_by_row, dy_all = offsets(ys, lambda r: g.cell(r, 0)[1])

    return {
        (r, c): (
            dy_by_row.get(r, dy_all),
            dx_by_col.get(c, dx_all),
        )
        for r in range(ROWS)
        for c in range(COLS)
    }


def build_display_icons(capture_paths: list[str], out_dir: Path) -> dict[str, int]:
    """Regenerate every seed icon the UI shows, from every capture we have.

    Kept separate from cut(), which builds the MATCHING template, because the two want opposite
    things from the same slot. The matcher wants the item's identity, so it throws away the count
    digits and the slot-lock bar. The UI wants the item's picture, so it needs them gone but
    everything else kept. Including the art underneath them.

    Returns {key: number of slot instances it was built from}.
    """
    # Imported here rather than at module scope: match.py imports this module, and classify is
    # only needed for the offline regeneration path.
    from .classify import classify

    templates = load_templates()
    font = load_font()

    instances: dict[str, list[np.ndarray]] = {}
    for path in capture_paths:
        img = cv2.imread(path)
        if img is None:
            raise FileNotFoundError(path)
        g = find_grid(img)
        require_native_scale(g.pitch)

        # Cut from a lattice re-fitted to the client's real slot boundaries. find_grid's is good
        # to a pixel or two (fine for matching, not for authoring a picture) and the error is
        # not even constant across one capture, because the pitch is fractionally off and drifts
        # across the columns. See slot_offsets().
        offs = slot_offsets(img, g)
        for hit in classify(img, g, templates):
            x, y, w, _ = g.cell(hit.row, hit.col)
            dy, dx = offs.get((hit.row, hit.col), (0, 0))
            x, y = x + dx, y + dy
            cell = img[y : y + w, x : x + w]
            if cell.shape[:2] == (int(NATIVE_PITCH), int(NATIVE_PITCH)):
                instances.setdefault(hit.name, []).append(cell)

    out_dir.mkdir(parents=True, exist_ok=True)
    for key, cells in instances.items():
        cv2.imwrite(str(out_dir / f"{key}.png"), composite_display_icon(cells, font))
    return {k: len(v) for k, v in instances.items()}


def cut_template(img: np.ndarray, g, row: int, col: int) -> np.ndarray:
    """One slot's pixels as an RGBA matching template. Nothing is written.

    This is what runs when a user clicks "track this" on their own upload: they name a slot,
    and its pixels become the template every future screenshot is matched against. The mask
    is what makes that safe, it excludes the stack-count digits and the slot-lock bar, which
    belong to *this* screenshot rather than to the item.

    The source must be at the client's native scale. See admit.require_native_scale for why
    that is a correctness requirement rather than a nicety.
    """
    require_native_scale(g.pitch)
    x, y, w, _ = g.cell(row, col)
    cell = img[y : y + w, x : x + w]
    return cv2.merge([*cv2.split(cell), icon_mask(cell)])


def cut(img: np.ndarray, g, row: int, col: int, key: str) -> float:
    """cut_template, onto disk under the catalog's naming. Returns the fraction of the slot
    the mask covers. The CLI's half: the service authors templates it never writes."""
    rgba = cut_template(img, g, row, col)
    cv2.imwrite(str(TEMPLATE_DIR / f"token-{key}.png"), rgba)
    return float((rgba[:, :, 3] > 0).mean())


SEED_ASSETS = Path(__file__).resolve().parents[3] / (
    "backend/src/main/resources/seed-assets/tokens"
)


def main():
    # `--display <capture>...` regenerates the seed icons the UI shows, from every capture
    # given. Every item in the catalog must appear in at least one of them.
    if "--display" in sys.argv:
        i = sys.argv.index("--display")
        caps = [a for a in sys.argv[i + 1 :] if not a.startswith("-")]
        if not caps:
            print("--display needs at least one screenshot")
            return 1
        built = build_display_icons(caps, SEED_ASSETS)
        missing = set(load_templates()) - set(built)
        for k in sorted(built):
            print(f"  {k:<26} composited from {built[k]} slot(s)")
        if missing:
            print(f"\n  no capture contains: {sorted(missing)}. Their icons are unchanged")
            return 1
        print(f"\nwrote {len(built)} icons to {SEED_ASSETS}")
        return 0

    # `--cut key=rXcY ...` cuts named slots; with no --cut, re-cuts the 6 known tokens by
    # finding them, which is what this script originally did.
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    cuts = []
    if "--cut" in sys.argv:
        i = sys.argv.index("--cut")
        for spec in sys.argv[i + 1 :]:
            if spec.startswith("-"):
                break
            key, _, ref = spec.partition("=")
            m = re.fullmatch(r"r(\d+)c(\d+)", ref)
            if not key or not m:
                print(f"bad --cut spec {spec!r}; want key=rXcY")
                return 1
            cuts.append((key, int(m.group(1)), int(m.group(2))))
            args = [a for a in args if a != spec]

    path = args[0] if args else "../../test-fixtures/inventory/inventory sample.png"
    img = cv2.imread(path)
    if img is None:
        print(f"cannot read {path}")
        return 1

    g = find_grid(img)

    if cuts:
        print(f"{path}: cutting {len(cuts)} template(s)\n")
        try:
            for key, r, c in cuts:
                cover = cut(img, g, r, c, key)
                print(f"  {key:24s} r{r}c{c}  mask covers {cover * 100:4.1f}% of slot")
        except NotNativeScale as e:
            # The check lives in cut() rather than here, so that it also guards the
            # "track this item" flow, which will call cut() without coming through this CLI.
            print(f"refusing to cut: {e}")
            return 1
        return 0

    print("nothing to do: pass --cut or --display (see the module docstring)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
