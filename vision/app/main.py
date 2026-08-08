"""Screenshot parsing service.

Runs as a second container in the same ECS task as the Ktor backend, which calls it over
loopback, one deployable, two processes. It replaced a Claude-vision call: the parse is a
deterministic OpenCV pipeline (see app/cv/), so it costs no tokens, makes no network call, and
returns the same answer every time. Nothing about the vision LLM survives; the backend now
speaks to this service directly.

The HUD ("Lv.287 acornacorn") is read too. Located by matching the fixed-pixel "Lv." prefix,
then OCR'd with Tesseract. It is null when no HUD is in frame, which the backend treats as
needing review.

Two panels are read, not one: the inventory grid (app/cv/grid.py) and the Maple Planner's boss
list (app/cv/planner.py). They are read independently because a single capture routinely holds
both, so the response carries whichever payloads were found rather than one chosen type.

Two things this service will NOT do, both learned the hard way:

  * It will not report a count it cannot stand behind. An item whose stack count is unreadable
    is dropped rather than reported with a guessed number, a wrong count is worse than a
    missing one, and it is the failure this whole project exists to prevent.
  * It will not refuse a capture it can actually read. A rescaled screenshot (remote play,
    display scaling) used to be rejected on the strength of an accuracy figure that had been
    measured through our OWN lossy resampling step. Read at its native scale, those captures
    parse fine. See app/cv/classify.scale_templates.
"""

import base64
import logging
import time
from contextlib import contextmanager
from typing import Literal

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel

from app.cv.admit import NotNativeScale, clashes, require_native_scale
from app.cv.build_icons import cut_template
from app.cv.classify import OCCUPIED, _busy, classify
from app.cv.discover import unknown_slots
from app.cv.grid import COLS, ROWS, coverage, find_grid
from app.cv.hud import find_hud
from app.cv.match import load_templates
from app.cv.ocr import load_font, read_count
from app.cv.pipeline import MIN_PITCH, looks_like_inventory_window, normalize
from app.cv.planner import TRACKED_BOSS_KEY_BY_NAME, PlannerResult, load_state_glyphs, parse_planner

log = logging.getLogger("vision")

MAX_UPLOAD_BYTES = 20 * 1024 * 1024

# Loaded once at import: the catalog is fixed and the templates are small.
TOKENS = load_templates()
FONT = load_font()
STATE_GLYPHS = load_state_glyphs()

app = FastAPI(title="maplestorage-vision")


class DetectedToken(BaseModel):
    tokenName: str
    quantity: int
    # Diagnostic only; the backend ignores it. Every count we return is one we
    # stand behind. See the 422 below for the ones we don't.
    iconScore: float


class CharacterHud(BaseModel):
    name: str
    level: int


class BossClear(BaseModel):
    # The catalog KEY, not the name: the name is what was on screen, the key is what the
    # backend keys a clear on. Resolved once, against the same generated catalog the reader
    # matched the name from. See planner.TRACKED_BOSS_KEY_BY_NAME.
    bossKey: str
    cleared: bool


class ScreenshotParseResult(BaseModel):
    # What the frame IS, unchanged in meaning for the inventory: a grid was read, or nothing
    # was. PLANNER means no grid but boss rows. It is NOT a statement about which payloads are
    # populated: a screenshot can hold both panels at once (Jonathan plays with both open, and
    # two of the three reference captures are like that), so the two reads are independent and
    # a dual capture is INVENTORY with bossClears also filled in. Ingest whatever is non-null.
    screenshotType: Literal["INVENTORY", "PLANNER", "UNRECOGNIZED"]
    # Null when no HUD is in frame, a tightly-cropped inventory upload has
    # none, and the backend already treats that as NEEDS_REVIEW.
    characterHud: CharacterHud | None = None
    tokenCounts: list[DetectedToken] | None = None
    # Was every one of the 128 slots in frame, unobscured, and its count readable? Only then
    # does an item's ABSENCE from tokenCounts mean the player holds none, which is what lets
    # the backend clear a stale count. False whenever we cannot tell "gone" from "not seen",
    # and the backend must then leave counts it did not hear about alone. See cv/grid.coverage.
    inventoryComplete: bool | None = None
    bossClears: list[BossClear] | None = None
    # Did the capture reach the bottom of the boss list? The list needs 1-3 scrolled captures,
    # and without this a capture of the top of an all-cleared list reads as "all clear" while
    # un-captured bosses below are still pending. Best-effort (see planner.parse_planner); the
    # backend's reconciliation against a character's known routine is the real guard.
    reachedListEnd: bool | None = None
    # Boss rows found whose NAME did not resolve to the catalog. Reported rather than dropped:
    # a dropped row reads as "not cleared", which is a plausible wrong answer, so the count has
    # to reach the user as "re-capture". Expected to be 0 on a clean capture.
    unreadableBossRows: int | None = None


def _downscaled_message() -> str:
    """The one rescale we genuinely cannot undo.

    An upscale interpolates: it adds no information, but it destroys none either, and the
    parser now reads the capture at whatever scale it arrives in rather than squeezing it
    back to native first. A DOWNSCALE actually discards pixels, and the 11px count font is
    the first thing to go. There is nothing to recover and no kernel that invents it back.

    So this is the only rescale left that we refuse, and unlike the old blanket refusal it
    asks the user for something they can always do: send the file they already have, whole.
    """
    return (
        "This screenshot was shrunk before upload, and the stack-count digits did not "
        "survive it. Upload the original file at its full resolution."
    )


def _decode_upload(body: bytes) -> np.ndarray:
    if not body:
        raise HTTPException(400, "empty body")
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"image exceeds {MAX_UPLOAD_BYTES} bytes")
    img = cv2.imdecode(np.frombuffer(body, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "not a decodable image")
    return img


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "tokens": len(TOKENS),
        "digits": len(FONT),
        "bosses": len(TRACKED_BOSS_KEY_BY_NAME),
    }


def _boss_clears(res: PlannerResult) -> tuple[list[BossClear], int]:
    """Planner rows as (clears, unreadable count). A row whose name did not resolve has no key
    to report, so it is counted rather than emitted, and never simply forgotten.

    A row that resolved to an UNTRACKED boss (the dailies) is neither: it was read fine and the
    tracker just does not keep it, so it must not inflate the unreadable count, which is what
    warns the user the parse may have missed something.
    """
    clears, unreadable = [], 0
    for row in res.rows:
        if row.boss is None:
            unreadable += 1
            continue
        key = TRACKED_BOSS_KEY_BY_NAME.get(row.boss)
        if key is not None:
            clears.append(BossClear(bossKey=key, cleared=row.cleared))
    return clears, unreadable


def _planner_only(img, planner, stage, response) -> ScreenshotParseResult:
    """A capture whose planner we trust and whose inventory we do not.

    Reached two ways, and they must answer alike: there was no grid at all, or there was one
    sitting under another window. Either way the boss rows are still good, and a planner has to
    be OPEN to be read, so it lands on the inventory more often than not. Refusing the whole
    upload would make the boss workflow unusable.
    """
    clears, unreadable = _boss_clears(planner)
    with stage("hud"):
        hud = find_hud(img)
    response.headers["Server-Timing"] = stage.header()
    log.info("parsed planner %d rows: %s", len(planner.rows), stage.log())
    return ScreenshotParseResult(
        screenshotType="PLANNER",
        characterHud=CharacterHud(name=hud.name, level=hud.level) if hud else None,
        bossClears=clears,
        reachedListEnd=planner.reached_list_end,
        unreadableBossRows=unreadable,
    )


class Stages:
    """Per-stage timings for one parse, emitted as a Server-Timing header.

    The parse is the slowest thing in an upload by two orders of magnitude, the
    backend answers in ~1ms and this takes hundreds. So when an upload feels slow,
    the only useful question is WHICH stage, and that was previously unanswerable
    without attaching a profiler.
    """

    def __init__(self) -> None:
        self.spans: list[tuple[str, float]] = []

    @contextmanager
    def __call__(self, name: str):
        start = time.perf_counter()
        try:
            yield
        finally:
            self.spans.append((name, (time.perf_counter() - start) * 1000))

    def header(self) -> str:
        total = sum(ms for _, ms in self.spans)
        parts = [f"{n};dur={ms:.1f}" for n, ms in self.spans]
        parts.append(f"total;dur={total:.1f}")
        return ", ".join(parts)

    def log(self) -> str:
        return " ".join(f"{n}={ms:.0f}ms" for n, ms in self.spans)


@app.post("/parse", response_model=ScreenshotParseResult)
async def parse(request: Request, response: Response) -> ScreenshotParseResult:
    stage = Stages()
    body = await request.body()
    with stage("decode"):
        img = _decode_upload(body)

    # Read the planner BEFORE the grid, and independently of it, because one capture can hold
    # both panels. Choosing a single type by precedence would silently drop the other panel's
    # real data. Cheap when there is no planner: find_panel is a colour mask, milliseconds
    # against a multi-second parse, and the per-row Tesseract (which is the actual cost, one
    # subprocess per row) only runs once rows have been found.
    #
    # Read at the capture's own scale, like everything else here. The state glyphs were cut at
    # native scale and matchTemplate is not scale-invariant, so a rescaled planner finds no rows
    # and reads as "no planner" rather than as a wrong one.
    #
    # Never fatal. Boss clears are ADDITIVE to a parse that already worked without them, so a
    # planner that blows up must cost its own rows and nothing else. The read shells out to
    # Tesseract once per row (find_hud does it once for the whole frame), so it multiplies the
    # chances of a TimeoutExpired, and a missing binary would take the inventory path down with
    # it despite the grid never needing the planner at all.
    try:
        with stage("planner"):
            planner = parse_planner(img, STATE_GLYPHS)
    except Exception:
        log.exception("planner read failed, continuing without boss clears")
        planner = None
    boss_rows = planner.rows if planner else []

    try:
        with stage("grid"):
            g = find_grid(img)
    except ValueError as e:
        # No slot lattice, by either segmentation or correlation. Two very different reasons,
        # and telling the user the wrong one sends them to fix the wrong thing:
        #
        #   * It really is not an inventory (a login screen, the character select).
        #   * It IS an inventory we still could not read. This is now rare, the smeared
        #     boundaries of a rescaled capture are handled by find_grid's correlation path,
        #     so if we land here the cause is something we have not seen, and the honest thing
        #     is to say so rather than to guess at a cause and send the user off to fix it.
        log.info("no grid: %s", e)
        # No grid but real boss rows: a planner capture. Checked before the inventory-window
        # guess below, which is only there to explain a MISSING grid, and has nothing to say
        # about a frame we have already read something from.
        if boss_rows:
            return _planner_only(img, planner, stage, response)
        if looks_like_inventory_window(img):
            raise HTTPException(
                422,
                "This looks like an inventory window, but the slot grid could not be located "
                "in it. Upload the original screenshot file, unedited and uncropped.",
            ) from e
        return ScreenshotParseResult(screenshotType="UNRECOGNIZED")

    # A capture with LESS detail than the client drew is still refused: the 11px count font
    # is the first casualty of a downscale and no amount of cleverness invents it back.
    #
    # An UPSCALED capture is a different matter, and used to be refused here too. That was
    # wrong, and the reason it was wrong is worth keeping: the reliability figures that
    # justified the refusal were all measured through a pipeline that resampled the frame
    # down to native before reading it, so what they actually measured was the damage the
    # parser was doing to itself, not the damage in the capture. Read at its own scale, a
    # real Parsec frame at 1.33x gives up all five of its items and all five stack counts.
    if g.pitch < MIN_PITCH:
        raise HTTPException(422, _downscaled_message())

    # Only an integer upscale is undone, because only that one reverses without loss.
    # Everything else is read at the scale it arrived in: the templates and digit glyphs are
    # scaled up to meet the frame rather than the frame being squeezed down to meet them.
    with stage("normalize"):
        img, g = normalize(img, g)

    with stage("hud"):
        hud = find_hud(img, scale=g.scale)

    # Two-stage: shortlist every slot with a cheap descriptor, verify the top candidates
    # exactly. The verify cost is O(TOP_K) rather than O(catalog), so this holds up as the
    # catalog grows. What does NOT come for free is the shortlist's recall, which is pinned by
    # a test rather than a hope. See app/cv/classify.py.
    with stage("classify"):
        hits = classify(img, g, TOKENS)

    # One item can occupy SEVERAL slots, so results are summed per item rather than emitted
    # per slot.
    #
    # This is not a hypothetical. Every symbol coupon exists in a tradeable and an untradeable
    # version. They are different items to the client, they sit in different slots, and they are
    # drawn with THE SAME ICON. There is no pixel anywhere in the slot that tells them apart.
    # (The cyan bar along the bottom is not it: that marks a slot the player has locked against
    # the in-game auto-sort, and is a property of the slot, not of what is in it.)
    #
    # So summing is not a convenience, it is the only honest answer available. We cannot say how
    # many of a player's 1427 Tallahart coupons are tradeable, and any split we reported would be
    # invented. The total is true regardless of which slot is which.
    #
    # Emitting one result per slot and letting the backend upsert them would have quietly kept
    # whichever arrived last and discarded the other: 630 reported against 1427 held. A silent
    # undercount (precisely the failure the rest of this pipeline exists to prevent) and it
    # would have looked entirely plausible on screen.
    totals: dict[str, list] = {}
    unreadable_counts = 0
    with stage("counts"):
        for hit in hits:
            digits, conf = read_count(img, g, hit.row, hit.col, FONT)
            if not digits:
                # Icon found but the count is unreadable. Reporting the item with
                # a fabricated quantity would be worse than reporting nothing.
                unreadable_counts += 1
                log.info("unreadable count for %s at r%dc%d", hit.name, hit.row, hit.col)
                continue
            slot = totals.setdefault(hit.name, [0, 0.0])
            slot[0] += int(digits)
            slot[1] = max(slot[1], hit.score)

    counts = [
        DetectedToken(tokenName=name, quantity=qty, iconScore=round(score, 3))
        for name, (qty, score) in totals.items()
    ]

    # An item dropped for an unreadable count is absent from `counts` while the player plainly
    # still holds it, so a single unreadable count is enough to make absence meaningless.
    with stage("coverage"):
        cov = coverage(img, g)

    # Hidden slots poison every count, not just the ones under the window.
    #
    # Counts are SUMMED per item across slots (see the note above), so a covered region can hold
    # another stack of an item we did read, and its total then comes back short with nothing to
    # say so. That is not a partial answer, it is a wrong one: a Maple Planner over this player's
    # inventory read sacred-cernium as 340 when they held 341, because the second stack of 1 was
    # behind it, and the backend upserts that 340 straight over the true figure.
    #
    # So an obscured or out-of-frame slot means NO count is reportable. An unreadable COUNT is
    # different and is not refused here: that drops the one item it belongs to and leaves every
    # other item's total intact, which is why `complete` below still folds it in for the backend's
    # narrower "may absence be read as zero" question.
    if not cov.complete:
        log.info("inventory obscured: %d off-frame, %d occluded", cov.off_frame, cov.occluded)
        if boss_rows:
            return _planner_only(img, planner, stage, response)
        raise HTTPException(
            422,
            "Part of the inventory was covered or out of frame, so the counts could not be "
            "trusted. Bring the whole inventory into view, clear of other windows, and take "
            "the screenshot again.",
        )

    complete = cov.complete and unreadable_counts == 0
    if not complete:
        log.info(
            "incomplete view: %d off-frame, %d occluded, %d unreadable counts",
            cov.off_frame,
            cov.occluded,
            unreadable_counts,
        )

    # The backend forwards this straight through to the browser, so a slow upload can
    # be attributed to a stage from the Network panel, without a profiler or a log dive.
    response.headers["Server-Timing"] = stage.header()
    log.info("parsed %dx%d: %s", img.shape[1], img.shape[0], stage.log())

    clears, unreadable = _boss_clears(planner) if boss_rows else (None, None)
    return ScreenshotParseResult(
        screenshotType="INVENTORY",
        characterHud=CharacterHud(name=hud.name, level=hud.level) if hud else None,
        tokenCounts=counts,
        inventoryComplete=complete,
        bossClears=clears,
        reachedListEnd=planner.reached_list_end if boss_rows else None,
        unreadableBossRows=unreadable,
    )


class DiscoverableSlot(BaseModel):
    row: int
    col: int
    # The slot's own pixels, PNG, base64. Pixels carry no names and only a human can supply
    # one, so the picker has to show them the item rather than describe it.
    imagePng: str


class DiscoverResult(BaseModel):
    # Everything in frame that the catalog has no opinion about, which is MOST of an
    # inventory: 65-87 of 128 slots across the reference captures. This is a picker feed,
    # not an anomaly report, and a UI that presents it as "items we failed to read" would be
    # calling a normal inventory broken.
    slots: list[DiscoverableSlot]
    # How many slots the catalog did claim. Context for the picker, nothing depends on it.
    knownCount: int


@app.post("/discover", response_model=DiscoverResult)
async def discover_items(request: Request) -> DiscoverResult:
    """Every slot a user could choose to start tracking.

    Separate from /parse on purpose. Parse runs on every upload and its answer is counts;
    this runs only when someone is adding an item, and its answer is ~80 base64 crops. Put
    on the parse response, that payload would be paid for by every upload that never asks
    for it.
    """
    img = _decode_upload(await request.body())

    try:
        g = find_grid(img)
    except ValueError as e:
        raise HTTPException(422, "No inventory grid could be located in this image.") from e

    # After normalize, not before: an integer upscale is undone losslessly, so a 2x capture
    # is native pixels once it has been through it and there is no reason to refuse it.
    img, g = normalize(img, g)
    try:
        require_native_scale(g.pitch)
    except NotNativeScale as e:
        raise HTTPException(422, str(e)) from e

    hits = classify(img, g, TOKENS)
    slots = unknown_slots(img, g, [(h.row, h.col) for h in hits])
    log.info("discover: %d known, %d offerable", len(hits), len(slots))

    out = []
    for r, c in slots:
        x, y, w, h = g.cell(r, c)
        ok, buf = cv2.imencode(".png", img[y : y + h, x : x + w])
        if not ok:
            # Dropping a slot silently would hide an item the user might be looking for.
            raise HTTPException(500, f"could not encode slot r{r}c{c}")
        out.append(DiscoverableSlot(row=r, col=c, imagePng=base64.b64encode(buf).decode("ascii")))
    return DiscoverResult(slots=out, knownCount=len(hits))


class AdmittedTemplate(BaseModel):
    # The slot as an RGBA matching template: the item's pixels, with the stack-count digits
    # and the slot-lock bar masked out. This is what every future parse correlates against,
    # and it doubles as the display icon, since it is already art on transparency.
    templatePng: str
    # Fraction of the slot the mask kept. Diagnostic: a very low number means the cut found
    # little art, which is worth seeing in a log when someone reports a bad match.
    coverage: float


@app.post("/admit", response_model=AdmittedTemplate)
async def admit_item(request: Request, row: int, col: int) -> AdmittedTemplate:
    """Turn one slot into a template the catalog could accept, or refuse to.

    Naming is not our business. Pixels carry no names, the user supplies one, and the backend
    keeps it. What cannot be delegated is whether these pixels can safely be told apart from
    the ones already in the catalog, because getting that wrong does not error, it reports
    the wrong item, confidently, for everyone.

    Checked against the CORE catalog only. A user's own items are not in this process, and
    the transport that would carry them arrives with per-user parsing; until then the backend
    is the only thing that can stop a user adding the same item twice, and it can only do it
    by name.
    """
    img = _decode_upload(await request.body())
    if not (0 <= row < ROWS and 0 <= col < COLS):
        raise HTTPException(422, f"r{row}c{col} is outside the {ROWS}x{COLS} grid")

    try:
        g = find_grid(img)
    except ValueError as e:
        raise HTTPException(422, "No inventory grid could be located in this image.") from e

    img, g = normalize(img, g)
    try:
        require_native_scale(g.pitch)
    except NotNativeScale as e:
        raise HTTPException(422, str(e)) from e

    x, y, w, h = g.cell(row, col)
    if _busy(img[y : y + h, x : x + w]) < OCCUPIED:
        raise HTTPException(422, f"r{row}c{col} is empty. Pick a slot with an item in it.")

    tpl = cut_template(img, g, row, col)

    found = clashes(tpl, TOKENS)
    if found:
        # 409, not 422: the capture is fine and re-taking it will not help. The item is
        # already tracked, or it is a recolour of one that is, and either way the answer is
        # a name rather than a new template.
        log.info("admit refused r%dc%d: %s", row, col, "; ".join(str(c) for c in found))
        raise HTTPException(
            409,
            "This looks like an item already in the catalog: " + ", ".join(c.key for c in found),
        )

    ok, buf = cv2.imencode(".png", tpl)
    if not ok:
        raise HTTPException(500, "could not encode the template")
    log.info("admitted r%dc%d, mask covers %.2f", row, col, float((tpl[:, :, 3] > 0).mean()))
    return AdmittedTemplate(
        templatePng=base64.b64encode(buf).decode("ascii"),
        coverage=round(float((tpl[:, :, 3] > 0).mean()), 3),
    )
