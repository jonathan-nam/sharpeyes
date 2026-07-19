"""Boss-planner parse, checked against hand-verified truth.

As in test_parse.py, truth is read off the screenshots by eye (verified by Jonathan for
sample 2), never taken from the parser's own output. sample 2 pins the (boss, cleared) read
on one character; the full-screen sample pins that the name read identifies a full roster,
including bosses that a fixed image library would not have covered.
"""

from pathlib import Path

import cv2
import pytest

from app.cv import planner as P

REF = Path(__file__).resolve().parents[2] / "test-fixtures"

# (boss name, cleared) top-to-bottom. First nine verified by Jonathan; last two parser-proposed.
#
# Row 8 is None, not "Akechi Mitsuhide". The row IS on this capture and reads fine; Akechi was
# deleted from catalog/bosses.yaml, so there is no longer a name to match it to and the reader
# reports it as UNRESOLVED. That is the cost of removing a boss that is still on the planner:
# every capture containing its row now carries one unreadable row. See test_parse's
# test_a_removed_boss_leaves_an_unresolved_row.
SAMPLE2_TRUTH = [
    ("Darknell", True),
    ("Chosen Seren", True),
    ("Kalos the Guardian", True),
    ("First Adversary", False),
    ("Kaling", False),
    ("Malefic Star", False),
    ("Limbo", True),
    (None, False),
    ("Black Mage", False),
    ("Zakum", False),
    ("Gollux", False),
]

# Every boss visible on the full-screen shot, top to bottom. Guardian Angel Slime and Gloom are
# CHAOS bosses whose dark badge the saturation pass misses; they must still be read (rows are
# found by the state glyph, not the badge) or they are a silent drop. The list is also scrolled
# to the top, so more bosses sit below the capture: reached_list_end must be False.
SAMPLE_EXPECTED = [
    "Lotus",
    "Damien",
    "Guardian Angel Slime",
    "Lucid",
    "Will",
    "Gloom",
    "Verus Hilla",
    "Darknell",
    "Chosen Seren",
    "Kalos the Guardian",
    "First Adversary",
    "Kaling",
]


@pytest.fixture(scope="module")
def glyphs():
    return P.load_state_glyphs()


def _parse(name, glyphs):
    img = cv2.imread(str(REF / name))
    assert img is not None, f"missing fixture {name}"
    res = P.parse_planner(img, glyphs)
    assert res is not None, "Boss Content panel not found"
    return res


def test_sample2_exact(glyphs):
    res = _parse("boss clear menu sample 2.png", glyphs)
    got = [(r.boss, r.cleared) for r in res.rows]
    assert got == SAMPLE2_TRUTH


def test_sample2_reached_end(glyphs):
    # The panel is isolated on white, so there is empty space below the last row.
    assert _parse("boss clear menu sample 2.png", glyphs).reached_list_end


def test_cross_capture_reads_roster(glyphs):
    res = _parse("boss clear menu sample.png", glyphs)
    # No row silently dropped and none left UNKNOWN, exact roster in order.
    assert [r.boss for r in res.rows] == SAMPLE_EXPECTED


def test_cross_capture_not_ended(glyphs):
    # Scrolled to the top with more bosses below, so the list end is not reached.
    assert not _parse("boss clear menu sample.png", glyphs).reached_list_end
