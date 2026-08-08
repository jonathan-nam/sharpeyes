"""Turning a user's slot into a template, and the four ways that is refused.

The refusals are the feature. Admitting a bad template does not fail at admission time, it
fails months later as a wrong count on someone else's screen, so every one of these has to
stay a hard no rather than a warning.
"""

import base64

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from fixtures import INVENTORY

from app.cv.admit import clashes, masked_score
from app.cv.build_icons import cut_template
from app.cv.classify import classify
from app.cv.grid import find_grid
from app.cv.match import load_templates
from app.cv.pipeline import normalize
from app.main import app

client = TestClient(app)

NATIVE = f"{INVENTORY}/untradeables sample.png"


def _admit(img, row, col):
    return client.post(
        "/admit", params={"row": row, "col": col}, content=cv2.imencode(".png", img)[1].tobytes()
    )


def _an_offered_slot(img) -> tuple[int, int]:
    """A slot /discover would show the user, so the admit path is exercised on the same
    slots the picker actually offers."""
    body = client.post("/discover", content=cv2.imencode(".png", img)[1].tobytes()).json()
    return body["slots"][0]["row"], body["slots"][0]["col"]


def test_an_offered_slot_becomes_a_usable_template():
    img = cv2.imread(NATIVE)
    row, col = _an_offered_slot(img)

    r = _admit(img, row, col)
    assert r.status_code == 200, r.json()
    body = r.json()

    tpl = cv2.imdecode(np.frombuffer(base64.b64decode(body["templatePng"]), np.uint8), -1)
    assert tpl is not None
    assert tpl.shape[2] == 4, "a matching template must carry its mask"
    assert 0 < body["coverage"] <= 1

    # The mask has to keep the art and drop the backing. All-or-nothing means icon_mask
    # failed and the template would correlate against grey.
    kept = float((tpl[:, :, 3] > 0).mean())
    assert 0.05 < kept < 0.95, kept


def test_a_freshly_cut_template_matches_the_slot_it_came_from():
    """The point of cutting from the client's own pixels: a perfect score against itself.
    Anything less means the cut is lossy and the item would go missing in real captures."""
    img = cv2.imread(NATIVE)
    row, col = _an_offered_slot(img)

    tpl_b64 = _admit(img, row, col).json()["templatePng"]
    tpl = cv2.imdecode(np.frombuffer(base64.b64decode(tpl_b64), np.uint8), -1)

    assert masked_score(tpl, tpl) > 0.99


def test_an_item_already_in_the_catalog_is_refused():
    """409 rather than 422: the capture is fine, re-taking it will not help, and the answer
    is a name rather than a new template."""
    img = cv2.imread(NATIVE)
    known = sorted((h.row, h.col) for h in _catalog_hits(img))
    assert known, "fixture holds no catalog items, this test would prove nothing"

    r = _admit(img, *known[0])
    assert r.status_code == 409, r.json()
    assert "already in the catalog" in r.json()["detail"]


@pytest.mark.parametrize("capture", ["untradeables sample", "symbols", "potions"])
def test_re_cutting_any_tracked_item_is_always_caught(capture):
    """Every slot the parser already recognises must come back as a clash when re-cut.

    This is the guarantee that a per-user catalog cannot silently accumulate duplicates, and
    it is checked over every known slot rather than one, because it failed on exactly one
    KIND of item: masked_score did not slide, so two cuts of sacred-carcion framed a pixel
    apart scored 0.2816 while the verifier scored the same pair 0.998. Small icons passed and
    hid it. Symbols, which fill the cell, did not.
    """
    img = cv2.imread(f"{INVENTORY}/{capture}.png")
    g = find_grid(img)
    img, g = normalize(img, g)
    templates = load_templates()

    missed = []
    for hit in classify(img, g, templates):
        tpl = cut_template(img, g, hit.row, hit.col)
        if hit.name not in [c.key for c in clashes(tpl, templates)]:
            missed.append((hit.name, hit.row, hit.col))

    assert not missed, f"re-cut and not recognised as already tracked: {missed}"


def test_a_shifted_cut_of_the_same_item_still_clashes():
    """The alignment property on its own, with no fixture standing in for it. A template
    displaced by a pixel is the same item and must be refused as one."""
    templates = load_templates()
    tpl = templates["sacred-carcion"]

    shifted = np.roll(tpl, shift=(2, 2), axis=(0, 1))
    assert masked_score(shifted, tpl) > 0.99, "a 2px shift must not change the answer"
    assert "sacred-carcion" in [c.key for c in clashes(shifted, templates)]


def _catalog_hits(img):
    g = find_grid(img)
    img, g = normalize(img, g)
    return classify(img, g, load_templates())


def test_an_empty_slot_is_refused():
    img = cv2.imread(NATIVE)
    offered = {
        (s["row"], s["col"])
        for s in client.post("/discover", content=cv2.imencode(".png", img)[1].tobytes()).json()[
            "slots"
        ]
    }
    known = {(h.row, h.col) for h in _catalog_hits(img)}

    empty = next((r, c) for r in range(8) for c in range(16) if (r, c) not in offered | known)
    r = _admit(img, *empty)
    assert r.status_code == 422
    assert "empty" in r.json()["detail"]


@pytest.mark.parametrize("factor", [1.25, 1.326])
def test_a_rescaled_capture_cannot_author(factor):
    """Same refusal /discover makes, enforced again at the point it would do the damage.
    Cut from a 1.326x capture, the Arcane and Sacred Symbols matched each other better than
    themselves, so this is a wrong count rather than a blurry picture."""
    img = cv2.imread(NATIVE)
    scaled = cv2.resize(img, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)

    r = _admit(scaled, 0, 0)
    assert r.status_code == 422
    assert "rescaled" in r.json()["detail"]


def test_a_slot_outside_the_grid_is_refused():
    img = cv2.imread(NATIVE)
    for row, col in [(-1, 0), (8, 0), (0, 16)]:
        r = _admit(img, row, col)
        assert r.status_code == 422, (row, col, r.json())


def test_admitting_the_same_slot_twice_would_clash_with_itself():
    """The guarantee that makes a per-user catalog safe: once a template exists, a second cut
    of the same item is refused by pixels, not by whether the user typed the same name."""
    img = cv2.imread(NATIVE)
    row, col = _an_offered_slot(img)

    tpl_b64 = _admit(img, row, col).json()["templatePng"]
    tpl = cv2.imdecode(np.frombuffer(base64.b64decode(tpl_b64), np.uint8), -1)

    found = clashes(tpl, {**load_templates(), "the-users-item": tpl})
    assert [c.key for c in found] == ["the-users-item"]
