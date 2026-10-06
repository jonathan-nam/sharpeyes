"""The drop icons shipped as seed assets.

The frontend paints these 1:1 in a 46px box, so nothing downstream can correct art that is the
wrong size or sits in the wrong place on the canvas. catalog/build.py --check already refuses a
file that is not 46x46. What it cannot see is art that is the right size and misregistered, which
is the risk on a hand cut: `eternal-armor-of-radiance-box` was cut from a capture taken on black,
and the black had swallowed the chest outline. The outline came back from the silhouette its five
siblings share, so that sharing is load-bearing and is pinned here.

Three more cuts followed: a seventh box, which needed the whole silhouette rather than the outline
alone; Blissful Nightmare, a glow whose alpha had to be divided back out of the black it was
captured against; and Lingering Twisted Desire, where dividing the whole sprite would have holed
its shading, so only the halo was. Size is pinned here as well, because a hand cut never passes
through `_normalize_icon` and so is capped by nothing.
"""

import pathlib
import re

import cv2
import numpy as np
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
DROP_ICONS = ROOT / "backend" / "src" / "main" / "resources" / "seed-assets" / "drops"

# One chest, six contents. Five come from the mirror; the sixth is the hand cut.
MIRROR_BOXES = [
    "eternal-armor-of-desire-box",
    "divine-eternal-armor-box",
    "ferocious-beast-eternal-armor-box",
    "ancient-eternal-armor-box",
    "eternal-armor-of-oaths-box",
]
CUT_BOX = "eternal-armor-of-radiance-box"
# The seventh box, and the second cut of one. Where the radiance box glows past the chest, this
# one does not, so it borrows the whole silhouette and not just the opaque part.
CUT_BOX_2 = "eternal-twisted-armor-box"
# The one the cuts borrowed their silhouette from, so they are comparable pixel for pixel.
DONOR = "eternal-armor-of-oaths-box"

GLOW_CUT = "blissful-nightmare"
# A third cut, and the one the glow rule alone is wrong for: it is a token icon, drawn in the
# inventory's light slot. Its shading is solid sprite, not halo, so only outside the silhouette was
# the black divided back out.
CORE_CUT = DROP_ICONS.parent / "tokens" / "lingering-twisted-desire.png"
# Cut off a capture with a framed panel behind it. The panel's tan header and its two bevel
# shades, which the sprite uses nowhere. Its fringe browns are deliberately absent: the sprite has
# an enclosed #776644 pixel of its own, so those are shared and would prove nothing.
FRAMED_CUT = "original-sin-of-pride"
FRAME_COLOURS = [0xCCBB99, 0xEEDDBB, 0xAAAA88]

# Read rather than repeated: it is the cap _normalize_icon applies to everything off the mirror,
# and a hand cut never passes through that function.
CONTENT_CAP = int(
    re.search(r"^ICON_CONTENT = (\d+)", (ROOT / "catalog" / "build.py").read_text(), re.M).group(1)
)

# The one icon the cap is wrong for. Its chest is pixel-identical to the five mirror boxes and is
# pinned to them below, so scaling its bbox to fit would shrink that chest under the set. What
# spills past the cap is the glow the mirror boxes do not have.
OVERSIZE = {"eternal-armor-of-radiance-box"}


def _icon(key: str | pathlib.Path) -> np.ndarray:
    path = key if isinstance(key, pathlib.Path) else DROP_ICONS / f"{key}.png"
    icon = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    assert icon is not None, key
    assert icon.shape == (46, 46, 4), f"{key} is {icon.shape}"
    return icon


def _alpha(key: str | pathlib.Path) -> np.ndarray:
    return _icon(key)[:, :, 3]


def _rgb(key: str | pathlib.Path) -> np.ndarray:
    return _icon(key)[:, :, :3]


@pytest.mark.parametrize("key", MIRROR_BOXES[1:])
def test_the_mirror_armor_boxes_are_one_chest(key):
    assert np.array_equal(_alpha(key) > 0, _alpha(MIRROR_BOXES[0]) > 0)


def test_the_hand_cut_box_registers_with_that_chest():
    # Its opaque core, not its footprint: the radiance box glows past the chest and the mirror ones
    # do not, so a shared footprint would be the wrong thing to ask for. A cut re-made at another
    # offset moves the core and fails here.
    assert np.array_equal(_alpha(CUT_BOX) == 255, _alpha(DONOR) == 255)


def test_the_hand_cut_box_kept_its_glow():
    # The guard on the test above being satisfied by pasting the donor's alpha over the cut. The
    # glow is the part of the capture no sibling could have supplied.
    alpha = _alpha(CUT_BOX)
    assert ((alpha > 0) & (alpha < 255)).sum() > 200
    assert (alpha > 0).sum() > (_alpha(DONOR) > 0).sum()


def test_the_second_hand_cut_box_takes_the_whole_silhouette():
    assert np.array_equal(_alpha(CUT_BOX_2), _alpha(DONOR))


def test_the_second_hand_cut_box_is_not_the_donor_recoloured():
    # The guard the test above needs, and the mirror image of the radiance box's glow test: only
    # the alpha is borrowed, and the chest inside it is this box's own art.
    inside = _alpha(DONOR) == 255
    difference = np.abs(_rgb(CUT_BOX_2)[inside].astype(int) - _rgb(DONOR)[inside].astype(int))
    assert difference.mean() > 40


@pytest.mark.parametrize("key", [GLOW_CUT, CORE_CUT])
def test_the_hand_cut_glow_carries_real_alpha(key):
    # Cut from a capture on black, where a halo arrives premultiplied. Keying that instead of
    # dividing it back out leaves the fringe opaque and near-black; the mirror's own glows carry
    # 123 to 244 here, so a dark fringe fails.
    alpha = _alpha(key)
    semi = (alpha > 0) & (alpha < 255)
    assert semi.sum() > 200
    assert _rgb(key)[semi].max(axis=1).mean() > 120


def test_the_core_cut_kept_its_shading_opaque():
    # The other half of the rule, and what the glow treatment alone would have cost: divide the
    # black out of the whole sprite and every shaded pixel goes translucent in proportion to how
    # dark it is, so the light slot shows through the item. Inside the silhouette nothing was
    # divided, so dark and opaque is a state a brightness key cannot produce.
    icon = _icon(CORE_CUT)
    dark = (icon[:, :, :3].max(axis=2) < 96) & (icon[:, :, 3] > 0)
    assert (dark & (icon[:, :, 3] == 255)).sum() > 40


@pytest.mark.parametrize(
    "icon", sorted(p.stem for p in DROP_ICONS.glob("*.png") if p.stem not in OVERSIZE)
)
def test_every_drop_icon_sits_inside_the_content_cap(icon):
    # The frontend paints these 1:1 side by side, so one drawn to a different rule reads as a
    # different size. The mirror's icons are capped in _normalize_icon; these are the same check
    # for the ones that never went through it.
    ys, xs = np.where(_alpha(icon) > 0)
    assert max(xs.max() + 1 - xs.min(), ys.max() + 1 - ys.min()) <= CONTENT_CAP


@pytest.mark.parametrize("colour", FRAME_COLOURS)
def test_the_framed_cut_left_none_of_its_frame_behind(colour):
    # The separation is by palette, since the sprite has no outline against the panel to key on.
    # A re-cut that keeps any of the frame shows up as one of its flat colours reappearing.
    icon = _icon(FRAMED_CUT)
    bgr = np.array([colour & 255, (colour >> 8) & 255, (colour >> 16) & 255])
    assert not (np.all(icon[:, :, :3] == bgr, axis=2) & (icon[:, :, 3] > 0)).any()
