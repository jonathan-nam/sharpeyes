"""The drop icons shipped as seed assets.

The frontend paints these 1:1 in a 46px box, so nothing downstream can correct art that is the
wrong size or sits in the wrong place on the canvas. catalog/build.py --check already refuses a
file that is not 46x46. What it cannot see is art that is the right size and drawn to another rule,
which is the risk on a hand cut, since one never passes through `_normalize_icon`.

Do not cut an icon from a capture while the mirror has the item. Original Sin of Pride's cut keyed
its mask card away as a background panel, and the cut armour boxes borrowed a silhouette their real
sprites do not share.
"""

import pathlib
import re

import cv2
import numpy as np
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
DROP_ICONS = ROOT / "backend" / "src" / "main" / "resources" / "seed-assets" / "drops"

# One chest, five contents. Radiance and Twisted are a later chest, so they are not in this list.
MIRROR_BOXES = [
    "eternal-armor-of-desire-box",
    "divine-eternal-armor-box",
    "ferocious-beast-eternal-armor-box",
    "ancient-eternal-armor-box",
    "eternal-armor-of-oaths-box",
]

# Read rather than repeated: it is the cap _normalize_icon applies to everything off the mirror.
CONTENT_CAP = int(
    re.search(r"^ICON_CONTENT = (\d+)", (ROOT / "catalog" / "build.py").read_text(), re.M).group(1)
)


def _alpha(key: str) -> np.ndarray:
    icon = cv2.imread(str(DROP_ICONS / f"{key}.png"), cv2.IMREAD_UNCHANGED)
    assert icon is not None, key
    assert icon.shape == (46, 46, 4), f"{key} is {icon.shape}"
    return icon[:, :, 3]


@pytest.mark.parametrize("key", MIRROR_BOXES[1:])
def test_the_mirror_armor_boxes_are_one_chest(key):
    assert np.array_equal(_alpha(key) > 0, _alpha(MIRROR_BOXES[0]) > 0)


@pytest.mark.parametrize("icon", sorted(p.stem for p in DROP_ICONS.glob("*.png")))
def test_every_drop_icon_sits_inside_the_content_cap(icon):
    # The frontend paints these 1:1 side by side, so one drawn to a different rule reads as a
    # different size.
    ys, xs = np.where(_alpha(icon) > 0)
    assert max(xs.max() + 1 - xs.min(), ys.max() + 1 - ys.min()) <= CONTENT_CAP
