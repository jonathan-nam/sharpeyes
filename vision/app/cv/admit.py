"""Whether a new template may join the catalog.

Adding an item is the one catalog operation that can break parses that already worked. A
template too close to one already present does not fail loudly: it gives the verifier two
icons it cannot tell apart, and it will sometimes pick the wrong one, confidently. That is
the failure this project exists to prevent, arriving through the front door.

So a candidate is admitted only if the verifier could tell it apart from everything it will
be classified alongside. The question is asked with the verifier's own two gates
(classify._verify), of two templates rather than of a template and a slot.

This lived in tests/test_catalog.py, which was the only caller while the catalog was
hand-edited. It moves here because a user-submitted item has to be asked the same question
at upload time, and a runtime check that merely resembled the CI one would eventually
disagree with it.
"""

from dataclasses import dataclass

import cv2
import numpy as np

from .classify import MAX_LAB_DISTANCE, VERIFY_THRESHOLD, _colour_distance
from .grid import NATIVE_PITCH


class NotNativeScale(ValueError):
    """The source screenshot was rescaled, so its pixels are not the client's."""


def require_native_scale(pitch: float) -> None:
    """Refuse to author anything from a rescaled capture.

    Parsing tolerates a rescaled capture (the catalog is scaled up to meet the frame), but
    AUTHORING from one poisons the catalog permanently: a template is supposed to BE the
    client's pixels, and a resampled one is a blurred guess at them.

    Measured on the Grandis tokens, cutting from a real 1.326x Parsec capture and scoring
    against a native screenshot: 0.84-0.91, where a client-cut template scores 1.000. Barely
    over the 0.80 verify bar, and fatal for items that come in families. Cut from that
    capture, the Arcane and Sacred Symbols matched the WRONG symbol (0.87) better than
    themselves (0.85). Not a failure to identify, a confident misidentification.

    So this refuses early and by pitch alone. The alternative is one user being told to send
    a better screenshot, against every user silently getting wrong counts.
    """
    if abs(pitch - NATIVE_PITCH) > 0.5:
        raise NotNativeScale(
            f"slot pitch is {pitch:.1f}px, not the client's native {NATIVE_PITCH:.0f}px. "
            "this screenshot has been rescaled, so its pixels are not the client's and a "
            "template cut from it would be a blur. Templates must come from a native-scale "
            "capture (MapleStory's own in-game screenshot always is, even over remote play)."
        )


@dataclass(frozen=True)
class Clash:
    """A catalog item the verifier could not tell the candidate apart from."""

    key: str
    shape: float
    colour: float | None

    def __str__(self) -> str:
        c = "n/a" if self.colour is None else f"{self.colour:.1f}"
        return (
            f"{self.key}: shape={self.shape:.3f} (bar {VERIFY_THRESHOLD}), "
            f"colour={c} (bar {MAX_LAB_DISTANCE})"
        )


def _art(tpl: np.ndarray) -> np.ndarray:
    """The template cropped to its mask, dropping the transparent margin."""
    ys, xs = np.nonzero(tpl[:, :, 3])
    if not len(ys):
        return tpl
    return tpl[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def masked_score(slot: np.ndarray, tpl: np.ndarray) -> float:
    """How well `tpl` matches `slot`, under tpl's own mask, at the best alignment.

    The argument order mirrors the verifier: a template is correlated against the pixels a
    slot holds, masked by the template. Passing two templates asks "if a slot held `slot`,
    how well would `tpl` match it".

    **It must SLIDE, because the verifier slides.** This compared two 46x46 images at offset
    zero, which is not a question the verifier ever asks: _verify correlates the template
    across a window wider than the cell and takes the maximum. Two cuts of the SAME item,
    framed a pixel or two apart because find_grid's lattice differs between captures, scored
    0.247 that way while the verifier scored the same pair 0.998. It failed open, which is
    the direction that admits a duplicate.

    So the template is cropped to its art and slid over the whole slot. Alignment stops being
    something the caller has to have got right, which it cannot, since the two templates come
    from different screenshots.
    """
    return _align(slot, tpl)[0]


# How far the two cuts may be out of step before we stop looking. find_grid's lattice is good
# to a pixel or two between captures (build_icons.slot_offsets exists to correct exactly that),
# so this only has to absorb jitter, not search.
ALIGN_SLACK = 4


def _align(slot: np.ndarray, tpl: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
    """(best score, the art that scored it, the slot patch under it at that position).

    BOTH sides are cropped to their own art first. Sliding the template over the slot is not
    enough on its own: a symbol's mask fills nearly the whole 46x46 cell, so there is nowhere
    to slide and the comparison collapses back to offset zero, which is how a second cut of
    sacred-carcion scored 0.2816 against its own catalog template. Cropping both removes the
    framing difference instead of trying to search past it.
    """
    art = _art(tpl)
    body = _art(slot)

    # A little room either way for whatever the crop did not cancel: the two masks differ
    # where the stack-count digits fell, so the bboxes need not agree to the pixel.
    body = cv2.copyMakeBorder(
        body, ALIGN_SLACK, ALIGN_SLACK, ALIGN_SLACK, ALIGN_SLACK, cv2.BORDER_REPLICATE
    )
    art = art[: body.shape[0], : body.shape[1]]
    th, tw = art.shape[:2]

    mask = cv2.cvtColor(art[:, :, 3], cv2.COLOR_GRAY2BGR)
    res = cv2.matchTemplate(
        body[:, :, :3].astype(np.uint8),
        art[:, :, :3].astype(np.uint8),
        cv2.TM_CCOEFF_NORMED,
        mask=mask,
    )
    res[~np.isfinite(res)] = -1.0
    _, score, _, loc = cv2.minMaxLoc(res)
    patch = body[loc[1] : loc[1] + th, loc[0] : loc[0] + tw, :3]
    return float(score), art, patch


def _confusable(slot: np.ndarray, tpl: np.ndarray) -> tuple[float, float | None] | None:
    """(shape, colour) when `tpl` would pass BOTH gates against a slot holding `slot`.

    Both must fail to separate them, because either alone has a blind spot the catalog
    already exercises: shape correlates Extreme Blue and Green at 0.925, and colour cannot
    separate the blue potion from kalos-token at 0.4 degrees of hue. See
    classify.MAX_LAB_DISTANCE for the measurements.
    """
    shape, art, patch = _align(slot, tpl)
    if shape < VERIFY_THRESHOLD:
        return None
    # Colour is read at the position the shape match chose, exactly as _verify does. Reading
    # it at offset zero would stencil the template's mask over pixels the match never claimed.
    colour = _colour_distance(art, patch)
    if colour is not None and colour > MAX_LAB_DISTANCE:
        return None
    return shape, colour


def clashes(candidate: np.ndarray, catalog: dict[str, np.ndarray]) -> list[Clash]:
    """Every catalog item the candidate cannot be safely admitted alongside. Empty means admit.

    Checked in BOTH directions, because a masked correlation is not symmetric (each side
    supplies its own mask) and the two directions are different bugs:

        candidate in the slot, catalog template matching it -> the new item is reported as
        the old one, and the user who added it never sees their own item.

        catalog item in the slot, candidate matching it -> the new item steals slots from an
        established one, changing counts for people who never added anything.

    The second is the worse of the two and is the one a single-direction check misses.
    """
    out = []
    for key, tpl in sorted(catalog.items()):
        hit = _confusable(candidate, tpl) or _confusable(tpl, candidate)
        if hit:
            out.append(Clash(key=key, shape=hit[0], colour=hit[1]))
    return out
