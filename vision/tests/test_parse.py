"""End-to-end tests against the real screenshots.

This is the regression suite the vision service exists to preserve: the same corpus
that validated the spike (16/16 token counts across three screenshots) now
guards the service. If a change to the CV breaks a count, it breaks here.
"""

import glob
import subprocess
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import main as main_mod
from app.cv import planner as planner_mod
from app.cv.grid import NATIVE_PITCH, Coverage, coverage, find_grid
from app.cv.hud import HUD_RE, find_hud
from app.cv.match import load_templates
from app.cv.ocr import load_font, read_count
from app.main import app

client = TestClient(app)

REF = "../test-fixtures"

# Hand-verified by reading the digits off each screenshot.
#
# The elixirs and potions were added on 2026-07-12. Their counts were read the same way.
# Off magnified crops of the slots the classifier claims, checking that the icon IS the item
# and the digits ARE the number. Pasting the parser's own output in here would make the test
# assert that the parser agrees with itself.
TRUTH = {
    f"{REF}/untradeables sample.png": {
        "blissful-fantasy-shard": 6,
        "distorted-ambition": 10,
        "echo-ancient-resolve": 6,
        "ferocious-beast-ring": 9,
        "kalos-token": 21,
        "collector-elixir": 1,
        "honorable-elixir": 1,
        "sayram-elixir": 1,
        "extreme-blue-potion": 8,
        "extreme-green-potion": 8,
        # Missed for a while by the TOP_K=3 descriptor shortlist, which never handed this
        # template to the verifier. It scores 1.000, a pixel-perfect match, confirmed by
        # eye against the template. The shortlist was hiding a real item, and the truth table
        # inherited the blind spot because it was built from the parser's own output.
        "aurelia-elixir": 1,
        # Symbol coupons. Verified by eye against the magnified slots.
        "arcane-vanishing-journey": 1629,
        "arcane-chu-chu-island": 1482,
        "arcane-lachelein": 187,
        "arcane-arcana": 187,
        "arcane-morass": 212,
        "arcane-esfera": 353,
        # 341 = two slots, 340 + 1. Both verified by eye: the same Cernium hexagon, one stack
        # of 340 and one of 1. The second was invisible until the prefilter stopped discarding
        # real matches. See PREFILTER_THRESHOLD.
        "sacred-cernium": 341,
        "sacred-hotel-arcus": 76,
        "sacred-carcion": 65,  # two slots: 16 + 49
        "sacred-shangri-la": 62,
        "sacred-arteria": 38,
        "sacred-odium": 19,
    },
    f"{REF}/inventory sample.png": {
        "distorted-ambition": 9,
        "echo-ancient-resolve": 14,
        "ferocious-beast-ring": 4,
        "kalos-token": 19,
        "trace-eternal-loyalty": 16,
        "sayram-elixir": 18,
        "arcane-vanishing-journey": 2340,
        "arcane-chu-chu-island": 2350,
        "arcane-lachelein": 2342,
        "arcane-arcana": 2347,
        "arcane-morass": 2347,
        "sacred-cernium": 2655,
        "sacred-hotel-arcus": 1846,
        "sacred-odium": 1306,
        "sacred-carcion": 923,
        "sacred-tallahart": 417,
        "sacred-arteria": 1956,
        "sacred-shangri-la": 1352,
        "arcane-esfera": 2347,
    },
    # The only screenshot carrying all SIX tokens, and a cropped panel rather than
    # a full desktop, so it also proves the grid detector does not depend on the
    # surrounding game window being in frame.
    f"{REF}/inventory804x550.png": {
        "blissful-fantasy-shard": 48,
        "distorted-ambition": 17,
        "echo-ancient-resolve": 51,
        "ferocious-beast-ring": 50,
        "kalos-token": 21,
        "trace-eternal-loyalty": 20,
        "aurelia-elixir": 3,
        "collector-elixir": 3,
        "honorable-elixir": 3,
        "sayram-elixir": 3,
        "extreme-green-potion": 9,
        "extreme-red-potion": 9,
        "arcane-vanishing-journey": 830,
        "arcane-chu-chu-island": 915,
        "arcane-lachelein": 936,
        "arcane-arcana": 896,
        "arcane-morass": 1076,
        "arcane-esfera": 1096,
        "sacred-cernium": 786,
        "sacred-hotel-arcus": 188,
        "sacred-odium": 869,
        "sacred-shangri-la": 232,
        "sacred-arteria": 317,
        "sacred-carcion": 351,
        # SUMMED across two slots: 797 (r1c14) + 626 (r6c0). Every symbol coupon exists in a
        # tradeable and an untradeable version, drawn with the same icon and indistinguishable
        # in the pixels, so the player's two stacks are two slots holding "the same" item. The
        # total is the only figure we can honestly report. See the note in main.py.
        "sacred-tallahart": 1423,
    },
    # The screenshot the elixir and potion templates were cut from.
    f"{REF}/potions.png": {
        "blissful-fantasy-shard": 18,
        "distorted-ambition": 10,
        "echo-ancient-resolve": 6,
        "ferocious-beast-ring": 9,
        "kalos-token": 21,
        "aurelia-elixir": 1,
        "collector-elixir": 1,
        "honorable-elixir": 1,
        "sayram-elixir": 1,
        "extreme-blue-potion": 9,
        "extreme-green-potion": 9,
        "extreme-red-potion": 1,
        "arcane-vanishing-journey": 1629,
        "arcane-chu-chu-island": 1482,
        "arcane-lachelein": 187,
        "arcane-arcana": 187,
        "arcane-morass": 212,
        "arcane-esfera": 353,
        "sacred-cernium": 341,  # two slots: 340 + 1
        "sacred-hotel-arcus": 76,
        "sacred-carcion": 77,  # two slots: 61 + 16
        "sacred-shangri-la": 62,
        "sacred-arteria": 38,
        "sacred-odium": 19,
    },
}


def _parse(path: str, quality: int | None = None):
    img = cv2.imread(path)
    assert img is not None, path
    if quality is None:
        blob = cv2.imencode(".png", img)[1].tobytes()
    else:
        blob = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])[1].tobytes()
    r = client.post("/parse", content=blob)
    return r


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["digits"] == 10
    # Not a hardcoded 6. The catalog grows; what must hold is that health reports what is
    # actually loaded.
    assert body["tokens"] == len(load_templates())


@pytest.mark.parametrize("path,truth", TRUTH.items())
def test_counts_match_truth(path, truth):
    r = _parse(path)
    assert r.status_code == 200
    body = r.json()
    assert body["screenshotType"] == "INVENTORY"
    got = {t["tokenName"]: t["quantity"] for t in body["tokenCounts"]}
    assert got == truth


@pytest.mark.parametrize("path,truth", TRUTH.items())
def test_counts_survive_jpeg(path, truth):
    """The frontend sends JPEG q92; the safe band is 75-95."""
    r = _parse(path, quality=92)
    assert r.status_code == 200
    got = {t["tokenName"]: t["quantity"] for t in r.json()["tokenCounts"]}
    assert got == truth


def test_downscaled_upload_is_rejected_loudly():
    """A shrunk screenshot must 422, not return silently-wrong counts."""
    img = cv2.imread(f"{REF}/untradeables sample.png")
    small = cv2.resize(img, None, fx=0.9, fy=0.9, interpolation=cv2.INTER_AREA)
    r = client.post("/parse", content=cv2.imencode(".png", small)[1].tobytes())
    assert r.status_code == 422
    assert "full resolution" in r.json()["detail"]


@pytest.mark.parametrize("factor", [1.1, 1.25, 1.326, 1.5, 1.75])
def test_fractionally_rescaled_capture_is_read_not_refused(factor):
    """A fractionally upscaled capture must be READ, at its own scale.

    This test used to assert the exact opposite, that we refuse these with advice about
    display scaling. On the strength of a measured 70-77% count accuracy. That number was
    real but it was measuring the wrong thing: the parser resampled the frame back down to
    native before reading it, so the accuracy it recorded was the accuracy of a capture the
    parser had itself just degraded. 1.326x is not chosen at random; it is what a real Parsec
    session delivered, and it was refused outright while every item and every count sat
    legible in the file.
    """
    img = cv2.imread(f"{REF}/untradeables sample.png")
    scaled = cv2.resize(img, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
    r = client.post("/parse", content=cv2.imencode(".png", scaled)[1].tobytes())
    assert r.status_code == 200, r.json()
    got = {t["tokenName"]: t["quantity"] for t in r.json()["tokenCounts"]}
    assert got == TRUTH[f"{REF}/untradeables sample.png"]


def test_parsec_capture_is_read():
    """The real Parsec frame: an H.264 remote-play capture, delivered at 1.326x because the
    client window did not match the host's resolution.

    Every stage of the old pipeline failed on it. Segmentation found 6 slots instead of 128,
    because the boundary ridge arrives as a gentle bump that never leaves the interior grey
    band.

    Kept as its OWN fixture (symbols-parsec.png) rather than reusing whatever symbols.png
    happens to be, and that is deliberate: symbols.png was later replaced with a native-scale
    capture of the same inventory, which would have silently turned this into a test that the
    native path works (something eleven other tests already cover) while the one real
    rescaled capture we own, and the only evidence that is not our own synthetic resize,
    quietly stopped being exercised. Synthetic damage has a way of being kinder than the real
    thing, so this file is worth keeping even though it is redundant-looking.

    Establishing truth for a BLURRED capture takes more care than for a clean one, and it is
    worth being honest about how each number below is known:

      * The five Grandis tokens were read off the magnified slots by eye (19, 4, 14, 18, 9).
      * The four-digit symbol counts CANNOT be read by eye here, the 11px font at 1.326x is
        mush, and I could not tell 417 from 437 by looking. They are corroborated instead: this
        frame and `inventory sample.png` are two captures of the same character minutes apart,
        and TEN of the four-digit counts (2347, 2350, 2342, 2340, 2655, 1956, 1352, 1846, 1306,
        923) come out IDENTICAL across the two. A reader that gets ten four-digit numbers exactly
        right on the blurred frame is not flipping a middle digit on the eleventh.
      * Where the two captures genuinely disagree, the inventory had moved on between them, and
        each difference is separately accounted for: trace-eternal-loyalty went 16 -> 18,
        sacred-tallahart 417 -> 437, hotel-arcus gained a second stack of 2 (1846 + 2 = 1848),
        and the slot holding sayram-elixir natively holds a completely different item here.
        None of these is a misclassification; the player had simply been playing.
    """
    img = cv2.imread(f"{REF}/symbols-parsec.png")
    r = client.post("/parse", content=cv2.imencode(".png", img)[1].tobytes())
    assert r.status_code == 200, r.json()
    got = {t["tokenName"]: t["quantity"] for t in r.json()["tokenCounts"]}
    assert got == {
        "kalos-token": 19,
        "ferocious-beast-ring": 4,
        "echo-ancient-resolve": 14,
        "trace-eternal-loyalty": 18,
        "distorted-ambition": 9,
        "arcane-vanishing-journey": 2340,
        "arcane-chu-chu-island": 2350,
        "arcane-lachelein": 2342,
        "arcane-arcana": 2347,
        "arcane-morass": 2347,
        "arcane-esfera": 2347,
        "sacred-cernium": 2655,
        "sacred-hotel-arcus": 1848,
        "sacred-odium": 1306,
        "sacred-carcion": 923,
        "sacred-arteria": 1956,
        "sacred-shangri-la": 1352,
        "sacred-tallahart": 437,
    }


def test_a_windowed_parsec_capture_finds_the_right_lattice():
    """A 1600x851 Parsec capture that was refused outright, and misread before that.

    Three separate faults, worth keeping apart because each has its own regression here:

      * PITCH. The period was taken as the MEAN of the two axes' autocorrelation. On a
        WINDOWED capture the column profile also carries the tab bar, search box and button
        row, which are periodic too: the rows read 61 and the columns 48, and the mean, 54.5,
        matched neither. The lattice drifted a slot every two columns and had walked off the
        panel by row 6, so 29 cells failed the grey check and the whole inventory came back
        "covered or out of frame" with nothing covering it. Phase coherence picks between the
        candidates instead, and the true 62 scores 0.947 against 54.5's 0.239.
      * ANCHOR. _largest_lattice_block maximises EMPTY-slot peaks, so at 95/128 full with a
        fully-occupied left column the window slid one column right, dropping that column out
        of the grid entirely and taking in dead space beyond the panel. Both edge columns are
        asserted below because that is the fault's signature.
      * The '0' of "20" read as an '8'. See NEAR_TIE in ocr.py.

    Only eye-verified numbers are asserted. The four-digit counts on this capture are the same
    mush described in test_parsec_capture_is_read and are deliberately NOT pinned here.
    """
    img = cv2.imread(f"{REF}/parsec-ss.png")
    assert img is not None

    g = find_grid(img)
    assert round(g.pitch) == 62, f"pitch {g.pitch}, the axis-averaging bug gives 54.5"
    assert coverage(img, g) == Coverage(off_frame=0, occluded=0)

    # The anchor bug is pinned by GEOMETRY, not by the counts in the columns it dropped.
    # Those are four-digit and genuinely unreadable by eye at this blur (I could not settle
    # 2985 against 2935), and a truth table is the last place to put a number I guessed at.
    # Where the lattice sits, on the other hand, was checked against all 128 slots by eye.
    assert 20 <= g.x <= 30, f"left edge {g.x}, one pitch right (86) is the anchor bug"
    # Column 0 is fully occupied on this capture, so every row of it must carry a count.
    # If the window slides a column, this is what stops being true.
    font = load_font()
    assert all(read_count(img, g, r, 0, font)[0] for r in range(8))
    # The stack that read 28. The '0' is filled by the stream's blur, not by an 8.
    assert read_count(img, g, 7, 14, font)[0] == "20"

    r = client.post("/parse", content=cv2.imencode(".png", img)[1].tobytes())
    assert r.status_code == 200, r.json()
    assert r.json()["inventoryComplete"] is True
    got = {t["tokenName"]: t["quantity"] for t in r.json()["tokenCounts"]}
    assert got["trace-eternal-loyalty"] == 20


def test_a_full_screen_capture_still_finds_its_lattice():
    """A clean, unobstructed inventory that was refused: "the slot grid could not be located".

    Nothing was wrong with the capture. The pitch was picked by phase coherence over ALL slot
    peaks, and on a FULL-SCREEN frame the game world, quickslot bars and skill icons answer
    the empty-slot template too: 92 peaks here against 34 on a windowed capture, their
    scattered phases dragging the score to 0.32 against a 0.60 bar. No threshold fixed it,
    the true pitch scored 0.32 while a known-WRONG pitch on another capture scored 0.24.

    Kept at FULL SIZE deliberately, unlike the other large fixtures. Cropping to the panel is
    what the other two do to fit the file-size limit, and it would defeat this test entirely:
    the strays live outside the inventory, so a crop removes the very thing that caused the
    bug. It is recompressed losslessly instead, same pixels, 1.8MB.

    The counts are not asserted here, but they are corroborated: this is the same inventory
    as parsec-ss.png captured separately, and at pitch 61 all eighteen items agree exactly
    with that fixture's numbers. A wrong pitch cannot produce that.
    """
    img = cv2.imread(f"{REF}/morebuff12.png")
    assert img is not None

    g = find_grid(img)
    assert round(g.pitch) == 61, f"pitch {g.pitch}"
    assert coverage(img, g) == Coverage(off_frame=0, occluded=0)

    r = client.post(
        "/parse", content=cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])[1].tobytes()
    )
    assert r.status_code == 200, r.json()
    assert r.json()["inventoryComplete"] is True


def test_a_selected_slot_is_not_mistaken_for_an_occluded_one():
    """A full-screen capture with one slot SELECTED, which used to refuse the whole inventory.

    The client paints the selected slot pale cyan, so it holds no interior grey at all and
    coverage() called it covered. One covered slot refuses everything (counts are summed
    across slots, so a partial read cannot be trusted), and the user got "part of the
    inventory was covered" with 127 clean slots and nothing covering any of them.

    The fixture is CROPPED from the 1918x1105 original, which was 4.2MB and over the repo's
    large-file limit even recompressed. Cropping resamples nothing, so the slots are the
    original's own pixels, and the fault reproduces exactly: one cell fails the grey test,
    scores 0.417 on the selection mask, and is forgiven.

    No token count is asserted, and that is not laziness. The owner confirmed this inventory
    holds Tallahart TWICE, 811 untradeable and 656 tradeable, summing to 1467. The full frame
    at JPEG q92 does report 1467, but the same frame as PNG reports 811, and this crop reports
    811 at either encoding. So the second stack's recall moves with framing and encoding, which
    is a real open bug, and pinning any single number here would pin whichever way it happens
    to land rather than what is true. See the note in the PR.
    """
    img = cv2.imread(f"{REF}/test.png")
    assert img is not None

    g = find_grid(img)
    assert coverage(img, g) == Coverage(off_frame=0, occluded=0)

    r = client.post(
        "/parse", content=cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])[1].tobytes()
    )
    assert r.status_code == 200, r.json()
    assert r.json()["inventoryComplete"] is True


def test_ui_optimization_2x_is_accepted():
    """MapleStory's UI Optimization is exact 2x pixel doubling, which downsamples
    back losslessly. It must NOT be caught by the rescale check."""
    img = cv2.imread(f"{REF}/untradeables sample.png")
    doubled = cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
    r = client.post("/parse", content=cv2.imencode(".png", doubled)[1].tobytes())
    assert r.status_code == 200
    got = {t["tokenName"]: t["quantity"] for t in r.json()["tokenCounts"]}
    assert got == TRUTH[f"{REF}/untradeables sample.png"]


def test_a_real_downscaled_upload_is_rejected():
    """inventory377x275.png is a real shrunk capture (from the M3 vision-LLM era,
    when downscaling was the plan). It is now exactly the input we must refuse."""
    img = cv2.imread(f"{REF}/inventory377x275.png")
    assert img is not None
    r = client.post("/parse", content=cv2.imencode(".png", img)[1].tobytes())
    # No inventory lattice survives at that size, so it cannot even be recognised
    # as an inventory, which is the honest answer, not a fabricated count.
    assert r.status_code in (200, 422)
    if r.status_code == 200:
        assert r.json()["screenshotType"] == "UNRECOGNIZED"


def test_non_inventory_image_is_unrecognized():
    """Not an error, the same answer the vision model gave."""
    noise = np.random.randint(0, 255, (600, 800, 3), dtype=np.uint8)
    r = client.post("/parse", content=cv2.imencode(".png", noise)[1].tobytes())
    assert r.status_code == 200
    assert r.json()["screenshotType"] == "UNRECOGNIZED"
    assert r.json()["tokenCounts"] is None


def test_garbage_body_is_a_400():
    r = client.post("/parse", content=b"this is not an image")
    assert r.status_code == 400


# --- planner ---------------------------------------------------------------
#
# The read itself is pinned in test_planner.py, against truth Jonathan verified. These pin the
# ROUTE: the type, that the contract carries keys rather than names, and that a capture holding
# both panels gives up both. Truth here is the same hand-verified list, not the parser's output.

# sample 2 is a planner alone, no inventory behind it.
#
# Shorter than the rows the reader finds: the capture ends with a Zakum and a Gollux row, both
# read fine, and both dropped here because the dailies are untracked. test_planner.SAMPLE2_TRUTH
# is the full row list. See test_untracked_daily_rows_are_ignored_not_unreadable.
SAMPLE2_CLEARS = [
    ("darknell", True),
    ("chosen-seren", True),
    ("kalos-the-guardian", True),
    ("first-adversary", False),
    ("kaling", False),
    ("malefic-star", False),
    ("limbo", True),
    ("black-mage", False),
]


def test_planner_alone_is_read_as_planner():
    r = _parse(f"{REF}/boss clear menu sample 2.png")
    assert r.status_code == 200
    body = r.json()
    assert body["screenshotType"] == "PLANNER"
    assert [(c["bossKey"], c["cleared"]) for c in body["bossClears"]] == SAMPLE2_CLEARS
    # No grid in frame, so nothing to report, and nothing invented either.
    assert body["tokenCounts"] is None


def test_a_removed_boss_leaves_an_unresolved_row():
    """Akechi was deleted from the manifest while its row is still on the planner.

    So this capture now carries exactly one row the reader cannot name. Pinned at 1 rather than
    0 because that is the honest state, and pinned rather than ignored because the count is still
    the drift guard: a SECOND unresolved row means the catalog and the reader have come apart,
    which is what this test existed to catch.

    The cost is real and belongs in the open. Every capture containing the Akechi row raises the
    "unreadable-rows" caveat in the UI (lib/planner-capture.ts), so the warning is now expected
    noise on a clean shot. Removing the row from the in-game planner is what actually clears it;
    the alternative is `tracked: false`, which is how the dailies are handled below.
    """
    body = _parse(f"{REF}/boss clear menu sample 2.png").json()
    assert body["unreadableBossRows"] == 1
    assert "akechi-mitsuhide" not in [c["bossKey"] for c in body["bossClears"]]
    assert "Akechi Mitsuhide" not in planner_mod.BOSS_NAMES


def test_untracked_daily_rows_are_ignored_not_unreadable():
    """Dropping the dailies must not look like a failed read.

    The two daily rows are still on this capture. An ignored row and an unreadable one are
    opposite claims: unreadable tells the user to re-capture. So the daily rows must vanish from
    bossClears WITHOUT adding to unreadableBossRows, which is the whole difference between this
    and the removed-boss case above. The 1 here is Akechi's row, never a daily's.
    """
    body = _parse(f"{REF}/boss clear menu sample 2.png").json()
    keys = [c["bossKey"] for c in body["bossClears"]]
    assert "zakum" not in keys and "gollux" not in keys
    assert body["unreadableBossRows"] == 1
    # The reader still FOUND them; they are dropped downstream, not missed.
    assert planner_mod.BOSS_NAMES.count("Zakum") == 1


def test_planner_isolated_panel_reaches_the_list_end():
    assert _parse(f"{REF}/boss clear menu sample 2.png").json()["reachedListEnd"] is True


def test_one_capture_gives_up_both_panels():
    """Both windows open at once is the normal case, not a corner one.

    Picking a single type by precedence would silently drop whichever panel lost, so the
    inventory truth and the boss clears must BOTH survive the same upload.
    """
    body = _parse(f"{REF}/untradeables sample.png").json()
    assert body["screenshotType"] == "INVENTORY"
    counts = {t["tokenName"]: t["quantity"] for t in body["tokenCounts"]}
    assert counts == TRUTH[f"{REF}/untradeables sample.png"]
    assert [c["bossKey"] for c in body["bossClears"]] == [
        "lotus",
        "damien",
        "guardian-angel-slime",
        "lucid",
        "will",
        "gloom",
        "verus-hilla",
        "darknell",
        "chosen-seren",
        "kalos-the-guardian",
        "first-adversary",
        "kaling",
    ]
    # Scrolled to the top, so bosses sit below the capture: not the end of the list.
    assert body["reachedListEnd"] is False


def test_inventory_without_a_planner_reports_no_clears():
    body = _parse(f"{REF}/inventory sample.png").json()
    assert body["screenshotType"] == "INVENTORY"
    assert body["bossClears"] is None
    assert body["reachedListEnd"] is None


def test_non_inventory_image_reports_no_clears():
    noise = np.random.randint(0, 255, (600, 800, 3), dtype=np.uint8)
    body = client.post("/parse", content=cv2.imencode(".png", noise)[1].tobytes()).json()
    assert body["screenshotType"] == "UNRECOGNIZED"
    assert body["bossClears"] is None


def test_a_planner_blowup_does_not_take_the_inventory_with_it(monkeypatch):
    """Boss clears are additive, so a planner that raises costs its own rows and nothing else.

    Driven on the capture that holds BOTH panels, because that is where the planner has real
    data to lose: the inventory counts must survive intact anyway. The read shells out to
    Tesseract once per row against find_hud's once per frame, so it carries most of the timeout
    risk in a parse, and it runs ahead of the grid.
    """

    def boom(*_args, **_kwargs):
        raise subprocess.TimeoutExpired("tesseract", 15)

    monkeypatch.setattr(main_mod, "parse_planner", boom)
    r = _parse(f"{REF}/untradeables sample.png")
    assert r.status_code == 200
    body = r.json()
    assert body["screenshotType"] == "INVENTORY"
    assert {t["tokenName"]: t["quantity"] for t in body["tokenCounts"]} == TRUTH[
        f"{REF}/untradeables sample.png"
    ]
    assert body["bossClears"] is None


def test_an_unresolved_row_is_counted_not_dropped(monkeypatch):
    """The counting is the point, and it must track the number of bad rows rather than latch.

    A row whose name will not resolve is the one case where the reader has found a boss and
    cannot say which, and reporting it is what stops it reading as "not cleared". Forced by
    denying the matcher one name that the clean capture definitely contains, so the response
    has to come back exactly one clear shorter and say so.

    Two, not one: this capture already carries Akechi's unresolvable row (see
    test_a_removed_boss_leaves_an_unresolved_row), and the denied name adds the second.
    """
    keep = [n for n in planner_mod.BOSS_NAMES if n != "Chosen Seren"]
    real = planner_mod.parse_planner
    monkeypatch.setattr(main_mod, "parse_planner", lambda img, glyphs: real(img, glyphs, keep))

    body = _parse(f"{REF}/boss clear menu sample 2.png").json()
    assert body["unreadableBossRows"] == 2
    keys = [c["bossKey"] for c in body["bossClears"]]
    assert "chosen-seren" not in keys
    # Short by exactly the denied row: the others must not be disturbed by its absence, and in
    # particular must not fuzzy-match onto the name that is now missing from the catalog.
    assert keys == [k for k, _ in SAMPLE2_CLEARS if k != "chosen-seren"]


# --- HUD -------------------------------------------------------------------
# Only one of our screenshots has a HUD in frame, so this is a thin corpus.
# See README: it is enough to prove the mechanism, not the alphabet.


def test_hud_is_read_when_in_frame():
    r = _parse(f"{REF}/untradeables sample.png")
    assert r.json()["characterHud"] == {"name": "acornacorn", "level": 287}


def test_hud_survives_the_jpeg_the_frontend_sends():
    r = _parse(f"{REF}/untradeables sample.png", quality=92)
    assert r.json()["characterHud"] == {"name": "acornacorn", "level": 287}


def test_hud_is_null_when_not_in_frame():
    """A cropped inventory upload has no HUD. Null, not an error, the backend
    already routes this to NEEDS_REVIEW."""
    r = _parse(f"{REF}/inventory sample.png")
    assert r.json()["characterHud"] is None
    # ...and the token counts are still read fine without it.
    assert len(r.json()["tokenCounts"]) == len(TRUTH[f"{REF}/inventory sample.png"])


# --- digit glyph masks -----------------------------------------------------
# Every digit glyph carries an alpha mask covering only its own pixels: ocr.py correlates through
# it, so background/icon art behind the count is ignored. '5' and '7' once shipped fully opaque,
# because glyph_mask flood-filled from (0,0) where
# those two have an outline pixel, so the fill leaked to the whole patch: it drew a white box behind
# any count with a 5 or 7, and widened their matchTemplate mask. A fully opaque glyph can never be
# right, so pin the invariant rather than the pixels.

_CV = Path(__file__).resolve().parents[1] / "app" / "cv"
_DIGITS = Path(__file__).resolve().parents[2] / "backend/src/main/resources/seed-assets/digits"


@pytest.mark.parametrize("f", sorted(glob.glob(str(_CV / "templates" / "digit_*.png"))))
def test_digit_template_has_a_real_alpha_mask(f):
    alpha = cv2.imread(f, cv2.IMREAD_UNCHANGED)[:, :, 3]
    assert (alpha < 80).any(), (
        f"{Path(f).name}: opaque everywhere, the mask leaked to the whole patch"
    )


@pytest.mark.parametrize("f", sorted(glob.glob(str(_DIGITS / "*.png"))))
def test_display_digit_draws_no_ground(f):
    alpha = cv2.imread(f, cv2.IMREAD_UNCHANGED)[:, :, 3]
    assert (alpha < 80).any(), f"{Path(f).name}: fully opaque, a white box would draw behind it"


@pytest.mark.parametrize("f", sorted(glob.glob(str(_DIGITS / "*.png"))))
def test_display_digit_is_filled_to_its_baseline(f):
    """The bright fill must reach the bottom of the glyph, not just the top.

    Nine of the ten shipped with rows 7-9 stripped back to bare outline, so the lower third of
    every count drew as navy with the icon showing through the gaps where the fill belonged. The
    client's fill fades 255 at the cap to 195 at the baseline, which is close enough to the 226
    slot background that removing background bleed by value takes the real fill with it."""
    px = cv2.imread(f, cv2.IMREAD_UNCHANGED)
    lower = px[7:10]
    white = (lower[:, :, :3] == 255).all(axis=2) & (lower[:, :, 3] == 255)
    assert white.any(), f"{Path(f).name}: no fill below row 7, the digit tails off into outline"


def _outline(px):
    return (px[:, :, 3] > 0) & (px[:, :, :3].sum(axis=2) < 300)


# 0 is excluded: its cut template carries background bleed down both edges (51 of 88 pixels differ,
# and no integer shift fixes it), so it cannot referee anything. See the test below for how 0 is
# pinned instead.
@pytest.mark.parametrize("d", "123456789")
def test_display_digit_outline_matches_the_parser_template(d):
    """Both are cut from the same client glyph, so their outlines must agree pixel for pixel."""
    sprite = _outline(cv2.imread(str(_DIGITS / f"{d}.png"), cv2.IMREAD_UNCHANGED))
    template = cv2.imread(str(_CV / "templates" / f"digit_{d}.png"), cv2.IMREAD_UNCHANGED)
    template = template[:, :, :3].sum(axis=2) < 300
    assert np.array_equal(sprite, template), f"{d}.png: outline has drifted from digit_{d}.png"


def test_display_zero_shares_its_bowl_with_eight():
    """0 and 8 are the same round bowl in this face, capped top and bottom identically.

    0 is the one glyph drawn by hand rather than cut by the generator, and the hand-drawn version
    left (2,2), (5,2), (2,8) and (5,8) white. That reopened the counter at both shoulders, so 0 read
    a size larger than the digits beside it. All four are outline in the client's own pixels, in
    every occurrence of 0 in test-fixtures/untradeables sample.png."""
    zero = cv2.imread(str(_DIGITS / "0.png"), cv2.IMREAD_UNCHANGED)
    eight = cv2.imread(str(_DIGITS / "8.png"), cv2.IMREAD_UNCHANGED)
    for rows in (slice(0, 3), slice(8, 11)):
        assert np.array_equal(zero[rows], eight[rows]), (
            f"0.png rows {rows.start}-{rows.stop - 1} differ from 8.png"
        )


# --- catalog scaling -------------------------------------------------------


def test_classify_is_flat_in_catalog_size():
    """The whole point of the two-stage classifier: adding items must not add
    time. Sliding one matchTemplate per item was O(N). ~38s at 500 items."""
    import time

    import cv2

    from app.cv.classify import classify
    from app.cv.grid import find_grid
    from app.cv.match import load_templates

    img = cv2.imread(f"{REF}/inventory sample.png")
    g = find_grid(img)
    base = load_templates()

    def timed(n):
        cat = dict(base)
        vals = list(base.values())
        for i in range(n - len(base)):
            cat[f"filler{i}"] = vals[i % len(vals)]
        t = time.perf_counter()
        classify(img, g, cat)
        return time.perf_counter() - t

    small, large = timed(6), timed(500)
    # An O(N) matcher would be ~80x slower here. Allow generous headroom for a
    # loaded CI box while still failing loudly if the scaling regresses.
    assert large < small * 3, f"catalog scaling regressed: {small:.2f}s -> {large:.2f}s"


# The HUD name is bounded by MapleStory's IGN charset, not by the end of the crop.
#
# Regression: LINE_RIGHT is a fixed 175px window, sized for the longest possible IGN.
# On a SHORT name it overruns into the HUD icons beside it, and Tesseract reads those
# as trailing glyphs. A real upload produced "acornacorn?. ©", which the backend then
# saved as a character by that name. Parse correct, identity wrong.
#
# Widening the crop would still overrun a 4-character name; narrowing it would
# truncate a 12-character one. The charset is the only boundary that holds for both.
@pytest.mark.parametrize(
    "text,level,name",
    [
        ("Lv.287 acornacorn", 287, "acornacorn"),
        ("Lv.287 acornacorn?. ©", 287, "acornacorn"),  # the bug, verbatim
        ("Lv.287 acornacorn ©@ x", 287, "acornacorn"),
        ("tv.287 acornacorn", 287, "acornacorn"),  # garbled prefix, already confirmed by the match
        ("Lv.200 Ab12", 200, "Ab12"),  # digits are legal in an IGN
        ("Lv.5 Bubbling", 5, "Bubbling"),
    ],
)
def test_hud_name_stops_at_the_ign_charset(text, level, name):
    m = HUD_RE.match(text)
    assert m is not None, text
    assert int(m.group(1)) == level
    assert m.group(2) == name


# The HUD must survive being read at a range of scales, not just at native.
#
# Regression: the HUD line is ~24px tall at native scale. Far below what Tesseract
# expects, and at that size "rn" has too few pixels to stay distinct from "m". A real
# upload read `acornacorm`, and the app created a character by that name, with no level,
# job or sprite, because Nexon has never heard of them.
#
# Tested against find_hud directly rather than through /parse, simply because this is a unit
# test of the HUD reader. It once carried a note explaining that /parse "rightly rejects
# fractional-scale captures outright", which is no longer true, and was never as sound as it
# sounded: those captures are now read at their own scale, HUD included.
@pytest.mark.parametrize("quality", [None, 92])
def test_a_one_in_a_name_is_not_read_as_a_letter(quality):
    """`morebuff12` came back as `morebuffl2`, and as `morebuffi2` at a different scale.

    '1', 'l' and 'i' are one vertical stroke each at this size and Tesseract cannot separate
    them. Retuning the crop does not help: that fixed `mechyfechy` and broke on the very
    next name uploaded. The client's glyphs are not ambiguous though, only Tesseract's
    reading of them is, so these three are decided from the pixels instead ('1' carries a
    flag, measured 4px across the top against 2px in the middle).

    Both encodings, because the two wrong answers came from the same image read two ways.
    """
    img = cv2.imread(f"{REF}/morebuff12.png")
    assert img is not None
    if quality is not None:
        img = cv2.imdecode(
            cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])[1], cv2.IMREAD_COLOR
        )

    g = find_grid(img)
    hud = find_hud(img, scale=g.pitch / NATIVE_PITCH)
    assert hud is not None
    assert hud.name == "morebuff12"
    assert hud.level == 295


@pytest.mark.parametrize("quality", [None, 92])
def test_a_descender_is_not_cropped_off_the_name(quality):
    """`mechyfechy` read as `mechufechy`, and the app would have made a character by it.

    A 'y' whose tail is cut is a 'u', and LINE_DOWN was one pixel inside the descenders.
    The name is asserted at both encodings because the frontend sends JPEG q92, and the
    parameter sweep behind LINE_DOWN/TARGET_LINE_HEIGHT found pairs that pass on PNG and
    fail on JPEG. Testing the lossless one alone would not have caught those.

    Two 'y's in one name is why this capture is worth keeping: `acornacorn`, the only other
    HUD fixture, has no descender in it at all and cannot fail this way.
    """
    img = cv2.imread(f"{REF}/hud-mechyfechy.png")
    assert img is not None
    if quality is not None:
        img = cv2.imdecode(
            cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])[1], cv2.IMREAD_COLOR
        )

    hud = find_hud(img, scale=1.0)
    assert hud is not None
    assert hud.name == "mechyfechy"
    assert hud.level == 296


@pytest.mark.parametrize("capture_scale", [1.0, 1.1, 1.25, 1.5, 2.0])
def test_hud_reads_at_every_capture_scale(capture_scale):
    img = cv2.imread(f"{REF}/untradeables sample.png")
    if capture_scale != 1.0:
        img = cv2.resize(
            img, None, fx=capture_scale, fy=capture_scale, interpolation=cv2.INTER_CUBIC
        )

    g = find_grid(img)
    hud = find_hud(img, scale=g.pitch / NATIVE_PITCH)

    assert hud is not None, f"no HUD found at {capture_scale}x"
    assert hud.name == "acornacorn", f"misread at {capture_scale}x: {hud.name!r}"
    assert hud.level == 287


# --- an obscured inventory -------------------------------------------------
#
# Coverage detection itself is pinned in test_coverage.py. These pin what the ROUTE does with it,
# which is a separate decision: knowing the view is partial is no use if the counts go out anyway.
#
# `boss clear menu sample.png` and `untradeables sample.png` are the same character's inventory
# minutes apart, one with the Maple Planner over it and one clear, so the damage is measurable
# rather than assumed.


def test_an_obscured_inventory_reports_no_counts():
    """Not a short list, no list.

    Counts are summed per item across slots, so a covered region can hold another stack of an
    item that WAS read. sacred-cernium is exactly that: 340 + 1 across two slots, the 1 behind
    the planner, and the visible 340 was reported as the total and upserted over the true 341.
    A partial view therefore makes no item's total trustworthy, not merely the covered ones.
    """
    covered = _parse(f"{REF}/boss clear menu sample.png").json()
    assert covered["tokenCounts"] is None

    clear = _parse(f"{REF}/untradeables sample.png").json()
    assert {t["tokenName"]: t["quantity"] for t in clear["tokenCounts"]}["sacred-cernium"] == 341


def test_an_obscured_inventory_still_gives_up_its_boss_clears():
    """A planner has to be OPEN to be read, so it lands on the inventory more often than not.
    Refusing the whole upload would make the boss workflow unusable."""
    body = _parse(f"{REF}/boss clear menu sample.png").json()
    assert body["screenshotType"] == "PLANNER"
    assert len(body["bossClears"]) == 12
    assert body["unreadableBossRows"] == 0


def test_an_obscured_inventory_with_no_planner_says_what_to_do():
    """With no boss rows to fall back on there is nothing to return, so it must refuse, and the
    message has to name the real problem. The generic no-grid text sends the user off to
    re-export a file that was never at fault."""
    img = cv2.imread(f"{REF}/boss clear menu sample.png")
    # Keep the whole inventory and the planner EDGE over its left columns, cutting away the boss
    # list itself (left of x=1000) so no planner payload remains.
    cropped = img[150:780, 1000:1900]
    r = client.post("/parse", content=cv2.imencode(".png", cropped)[1].tobytes())
    assert r.status_code == 422
    assert "covered or out of frame" in r.json()["detail"]


def test_a_blurred_capture_is_not_mistaken_for_an_obscured_one():
    """symbols-parsec.png is the one real rescaled capture in the corpus and it reads perfectly,
    but its mushy boundaries correlate only 22 of 128 cells against a clean capture's 127. Any
    refusal counting how MANY cells resolve would reject the blurriest file we own. What matters
    is whether each cell still looks like a slot, which blur leaves intact and a window does not.
    """
    body = _parse(f"{REF}/symbols-parsec.png").json()
    assert body["screenshotType"] == "INVENTORY"
    assert body["tokenCounts"], "a blurred but unobstructed capture must still be read"
    assert body["inventoryComplete"] is True
