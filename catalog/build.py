"""Generate everything an item needs from catalog/items.yaml.

    python catalog/build.py            regenerate
    python catalog/build.py --check    fail if anything is out of sync

An item used to be added by hand in four places: the vision template, the backend's
icon asset, the seed migration, and the vision_key mapping. Nothing checked that the
four agreed, and they didn't, the parser emitted `kalos-token` while the lookup
matched `Kalos's Residual Determination`, so every count was dropped in silence.

The fix is not "remember to update all four". It is to make disagreement impossible:
one manifest, everything else generated or verified against it.

What this emits:

  backend/src/main/resources/db/migration/R__token_catalog.sql

Flyway *repeatable* migration, deliberately: it re-applies whenever its checksum
changes, so editing the manifest reseeds the catalog on the next boot with no new
versioned migration to write. Versioned migrations are immutable once applied; a seed
that changes is exactly what R__ is for.

What this verifies (and will not generate, because these are art):

  vision/app/cv/templates/token-<key>.png     the matcher's template
  backend/.../seed-assets/tokens/<key>.png    the icon the UI shows

Both must exist for every item, and be named from the key. Cutting a template from a
screenshot is what build_icons.py is for.
"""

import argparse
import json
import pathlib
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "catalog" / "items.yaml"
TEMPLATES = ROOT / "vision" / "app" / "cv" / "templates"
ICONS = ROOT / "backend" / "src" / "main" / "resources" / "seed-assets" / "tokens"
SQL_OUT = ROOT / "backend" / "src" / "main" / "resources" / "db" / "migration" / "R__token_catalog.sql"

# The boss catalog. Unlike items, a boss has no image asset: the planner reader identifies it by
# reading its name. build emits two artifacts from the one manifest: the name catalog the reader
# loads, and the backend seed for the boss_catalog table.
BOSS_MANIFEST = ROOT / "catalog" / "bosses.yaml"
BOSS_OUT = ROOT / "vision" / "app" / "cv" / "boss_catalog.json"
BOSS_SQL_OUT = ROOT / "backend" / "src" / "main" / "resources" / "db" / "migration" / "R__boss_catalog.sql"
BOSS_RESETS = {"WEEKLY", "DAILY", "MONTHLY"}

# The display icons are the official item sprites from maplestory.io, keyed by Nexon item id.
# `icon_id` in items.yaml pins the one a human validated against the in-game art. The version is
# pinned, not "latest": "latest" is whatever got extracted last and can regress an id out from
# under us, and a brand-new item is simply absent until the mirror ingests its patch. 268 was the
# newest COMPLETE GMS dataset at adoption. Bump it deliberately and re-validate; do not float it.
# An item with no icon_id has no official source (too new, or named differently) and keeps the
# hand-cut art already in the tree.
ICON_VERSION = 268
ICON_URL = "https://maplestory.io/api/GMS/{version}/item/{icon_id}/icon"

# The inventory draws every icon in one 46x46 frame at 1:1 (globals.css `.ms-slot > img`), which
# was written when every asset WAS a 46x46 client-slot frame. The official sprites arrive trimmed
# to the art and vary from 26 to 40 px. So each is trimmed to its art, DOWNSCALED (never up) so its
# longer side is at most ICON_CONTENT, and centred on a 46x46 canvas. Down-only is the point: an
# orb sprite is 33 px and a hexagon is 38, and scaling the small ones UP is what made the potions
# and arcane orbs balloon past everything else. The cap equalises the big ones; the already-small
# ones keep their true size, which is what makes the set read as one. Scaled once with a quality
# filter; the frontend paints the result 1:1.
ICON_CANVAS = 46
ICON_CONTENT = 32

KEY_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789-")


CATEGORIES = {"REDEMPTION_TOKEN", "CONSUMABLE"}


def load() -> list[dict]:
    items = yaml.safe_load(MANIFEST.read_text())["items"]

    seen: set[str] = set()
    for it in items:
        key = it["key"]
        if set(key) - KEY_CHARS:
            sys.exit(f"key {key!r} must be lowercase kebab-case, it becomes a filename and a DB value")
        if key in seen:
            sys.exit(f"duplicate key {key!r}")
        seen.add(key)

        icon_id = it.get("icon_id")
        if icon_id is not None and not isinstance(icon_id, int):
            sys.exit(f"{key}: icon_id must be an integer maplestory.io item id, got {icon_id!r}")

        if it.get("sort") is None:
            sys.exit(f"{key}: needs a sort, it decides the order within its section")

        grp = it.get("group")
        if not grp:
            sys.exit(f"{key}: needs a group, it decides which section of the UI it appears in")

        cat = it.get("category")
        if cat not in CATEGORIES:
            sys.exit(f"{key}: category must be one of {sorted(CATEGORIES)}, got {cat!r}")

        # A redemption token is a thing you collect N of and trade in. A consumable is a
        # thing you drink. Giving a consumable a threshold would have the UI report
        # "7 / 10 toward an Eternal set" on a potion. Confident and meaningless.
        has = "redeem_threshold" in it
        if cat == "REDEMPTION_TOKEN" and not has:
            sys.exit(f"{key}: a REDEMPTION_TOKEN needs a redeem_threshold")
        if cat == "CONSUMABLE" and has:
            sys.exit(f"{key}: a CONSUMABLE must not have a redeem_threshold. You drink it")

        # What the token actually BUYS. The two sets do not overlap. Kalos/Kaling/Adversary/
        # Star pieces make a Hat, Top, Bottom or Shoulder; Limbo/Baldrix pieces make a Cape,
        # Glove or Shoe, so ten of one and ten of the other are not "twenty pieces". A
        # redeemable token without this is a token whose progress bar means nothing.
        slots = it.get("redeem_slots")
        if cat == "REDEMPTION_TOKEN" and not slots:
            sys.exit(f"{key}: a REDEMPTION_TOKEN needs redeem_slots. What does it buy?")
        if cat != "REDEMPTION_TOKEN" and slots:
            sys.exit(f"{key}: only a REDEMPTION_TOKEN can have redeem_slots")
    return items


def load_bosses() -> list[dict]:
    bosses = yaml.safe_load(BOSS_MANIFEST.read_text())["bosses"]
    seen: set[str] = set()
    for b in bosses:
        key = b["key"]
        if set(key) - KEY_CHARS:
            sys.exit(f"boss key {key!r} must be lowercase kebab-case, it becomes a DB value")
        if key in seen:
            sys.exit(f"duplicate boss key {key!r}")
        seen.add(key)
        if not b.get("name"):
            sys.exit(f"{key}: needs a name, it is what the planner OCR is matched against")
        if b.get("reset") not in BOSS_RESETS:
            sys.exit(f"{key}: reset must be one of {sorted(BOSS_RESETS)}, got {b.get('reset')!r}")
        if not isinstance(b.get("tracked", True), bool):
            sys.exit(f"{key}: tracked must be true or false, got {b.get('tracked')!r}")
    return bosses


def _boss_summary(bosses: list[dict]) -> str:
    """Tracked count first: it is the one that matches boss_catalog and the matrix."""
    tracked = sum(1 for b in bosses if b.get("tracked", True))
    untracked = len(bosses) - tracked
    return f"{tracked} bosses" + (f" (+{untracked} untracked)" if untracked else "")


def boss_json(bosses: list[dict]) -> str:
    """The name catalog the planner reader loads. Generated so it cannot drift from the manifest.

    Carries untracked bosses too: the reader needs every name that can appear on the planner,
    and `tracked` is what tells it which of those to report. See catalog/bosses.yaml.
    """
    data = [
        {"key": b["key"], "name": b["name"], "reset": b["reset"], "tracked": b.get("tracked", True)}
        for b in bosses
    ]
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def boss_sql(bosses: list[dict]) -> str:
    """The boss_catalog seed. Upserts by boss_key and keeps each id (boss_clear references it).

    Untracked bosses are omitted: boss_catalog is the set of bosses the tracker keeps clears for.
    The seed then DELETES whatever is left over, so the manifest alone decides the contents and a
    removal needs no versioned migration. That delete is why this is authoritative rather than
    merely additive: an upsert-only seed cannot undo a row an older image put there, which is how
    two deleted dailies came back a minute after the migration that dropped them.
    """

    def q(s: str) -> str:
        return "'" + s.replace("'", "''") + "'"

    tracked = [b for b in bosses if b.get("tracked", True)]
    # Manifest position IS the sort order, so reordering bosses.yaml reorders the matrix and
    # nothing else has to be touched. See V12__boss_sort_order.sql.
    rows = ",\n".join(
        f"    ({q(b['key'])}, {q(b['name'])}, {q(b['reset'])}, {i})" for i, b in enumerate(tracked)
    )
    keys = ", ".join(q(b["key"]) for b in tracked)
    return f"""-- GENERATED FROM catalog/bosses.yaml. DO NOT EDIT BY HAND.
-- Regenerate with:  python catalog/build.py
--
-- Repeatable (R__): editing bosses.yaml reseeds boss_catalog on the next boot. Upserts by
-- boss_key and keeps an existing row's id, which boss_clear references, so it is never churned.

INSERT INTO boss_catalog (id, boss_key, name, reset, sort_order)
SELECT COALESCE(existing.id, gen_random_uuid()), v.boss_key, v.name, v.reset, v.sort_order
FROM (VALUES
{rows}
) AS v (boss_key, name, reset, sort_order)
LEFT JOIN boss_catalog existing ON existing.boss_key = v.boss_key
ON CONFLICT (boss_key) DO UPDATE SET
    name       = EXCLUDED.name,
    reset      = EXCLUDED.reset,
    sort_order = EXCLUDED.sort_order;

-- Then remove what the manifest no longer lists. The manifest is the whole truth: without this
-- the seed can only ADD, so a boss deleted here survives in any database that already had it,
-- and an older image redeploying re-inserts one this seed just dropped.
--
-- DESTRUCTIVE, and deliberately so: this deletes every recorded clear for a removed boss, for
-- every user, with no migration to review first. A mistyped or renamed key is therefore silent
-- data loss, which is why bosses.yaml calls a key permanent. The NOTICE puts what went into the
-- boot log, so the deletion is at least never invisible.
DO $$
DECLARE gone text;
BEGIN
    SELECT string_agg(boss_key, ', ' ORDER BY boss_key) INTO gone
    FROM boss_catalog WHERE boss_key NOT IN ({keys});

    IF gone IS NOT NULL THEN
        RAISE NOTICE 'boss_catalog: dropping % and every clear recorded against them (not in catalog/bosses.yaml)', gone;
    END IF;
END $$;

DELETE FROM boss_clear
WHERE boss_catalog_id IN (SELECT id FROM boss_catalog WHERE boss_key NOT IN ({keys}));

DELETE FROM boss_catalog WHERE boss_key NOT IN ({keys});
"""


def check_art(items: list[dict]) -> list[str]:
    """Every item needs a template and an icon, both named from its key."""
    problems = []
    for it in items:
        key = it["key"]
        tpl = TEMPLATES / f"token-{key}.png"
        icon = ICONS / f"{key}.png"
        if not tpl.exists():
            problems.append(f"missing vision template: {tpl.relative_to(ROOT)}  (cut one with vision/app/cv/build_icons.py)")
        if not icon.exists():
            problems.append(f"missing icon asset:     {icon.relative_to(ROOT)}")

    # And nothing may exist that the manifest does not know about, an orphan template
    # is an item the parser can detect but the app cannot name, which is the same class
    # of silent mismatch this file exists to prevent.
    known = {it["key"] for it in items}
    for tpl in sorted(TEMPLATES.glob("token-*.png")):
        key = tpl.stem.removeprefix("token-")
        if key not in known:
            problems.append(f"template not in the manifest: {tpl.relative_to(ROOT)}")
    return problems


def sql(items: list[dict]) -> str:
    def q(s: str) -> str:
        return "'" + s.replace("'", "''") + "'"

    rows = ",\n".join(
        f"    ({q(it['key'])}, {q(it['name'])}, {q(it['boss'])}, {q(it['key'] + '.png')}, "
        f"{q(it['group'])}, {int(it['sort'])})"
        for it in items
    )
    redeemable = [it for it in items if it["category"] == "REDEMPTION_TOKEN"]
    def arr(slots):
        return "ARRAY[" + ", ".join(q(x) for x in slots) + "]::TEXT[]"

    rules = ",\n".join(
        f"    ({q(it['key'])}, {int(it['redeem_threshold'])}, {arr(it['redeem_slots'])})"
        for it in redeemable
    )
    return f"""-- GENERATED FROM catalog/items.yaml. DO NOT EDIT BY HAND.
-- Regenerate with:  python catalog/build.py
--
-- Repeatable (R__) on purpose: Flyway re-applies it whenever its checksum changes, so
-- adding an item to the manifest reseeds the catalog on the next boot. A versioned
-- migration is immutable once applied and is the wrong tool for a seed that evolves.
--
-- Upserts rather than replaces: token_catalog.id is referenced by character_token_count,
-- so deleting and reinserting would take every user's counts with it.

INSERT INTO token_catalog (id, vision_key, name, source_boss_name, icon_ref_key, item_group, sort_order)
SELECT
    COALESCE(existing.id, gen_random_uuid()),
    v.vision_key, v.name, v.boss, v.icon, v.item_group, v.sort_order
FROM (VALUES
{rows}
) AS v (vision_key, name, boss, icon, item_group, sort_order)
LEFT JOIN token_catalog existing ON existing.vision_key = v.vision_key
ON CONFLICT (vision_key) DO UPDATE SET
    name             = EXCLUDED.name,
    source_boss_name = EXCLUDED.source_boss_name,
    icon_ref_key     = EXCLUDED.icon_ref_key,
    item_group       = EXCLUDED.item_group,
    sort_order       = EXCLUDED.sort_order;

-- An item is redeemable if a rule exists for it. There is no flag to keep in step with
-- the fields it governs. So a manifest entry that stops being a REDEMPTION_TOKEN must have
-- its rule removed, not merely have its threshold nulled.
DELETE FROM redemption_rule
WHERE item_id IN (
    SELECT id FROM token_catalog
    WHERE vision_key NOT IN ({", ".join(q(it["key"]) for it in redeemable) or "NULL"})
);

INSERT INTO redemption_rule (item_id, redeem_threshold, slot_group)
SELECT c.id, v.redeem_threshold, v.slot_group
FROM (VALUES
{rules}
) AS v (vision_key, redeem_threshold, slot_group)
JOIN token_catalog c ON c.vision_key = v.vision_key
ON CONFLICT (item_id) DO UPDATE SET
    redeem_threshold = EXCLUDED.redeem_threshold,
    slot_group       = EXCLUDED.slot_group;
"""


def _normalize_icon(data: bytes) -> bytes:
    """Trim to the art, cap the longer side at ICON_CONTENT (never enlarge), centre on 46x46."""
    import io

    from PIL import Image

    im = Image.open(io.BytesIO(data)).convert("RGBA")
    bbox = im.getbbox()  # the real art, without the transparent margin maplestory.io leaves
    if bbox:
        im = im.crop(bbox)
    longest = max(im.width, im.height)
    if longest > ICON_CONTENT:
        scale = ICON_CONTENT / longest
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (ICON_CANVAS, ICON_CANVAS), (0, 0, 0, 0))
    canvas.paste(im, ((ICON_CANVAS - im.width) // 2, (ICON_CANVAS - im.height) // 2))
    out = io.BytesIO()
    canvas.save(out, "PNG")
    return out.getvalue()


def fetch_icons(items: list[dict]) -> None:
    """Download the official sprite for every item with an icon_id, overwriting its seed asset.

    Items without an icon_id are left alone: their hand-cut art is the only source there is. A
    fetch that returns anything but a PNG is a hard error, a wrong or half-written icon is exactly
    the confident-wrong-picture this catalog exists to prevent, so refuse rather than ship it.
    """
    import urllib.request

    got = 0
    for it in items:
        icon_id = it.get("icon_id")
        if icon_id is None:
            continue
        version = it.get("icon_version", ICON_VERSION)
        url = ICON_URL.format(version=version, icon_id=icon_id)
        req = urllib.request.Request(url, headers={"User-Agent": "maplestorage-build"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
        except Exception as e:
            sys.exit(f"{it['key']}: could not fetch icon {icon_id} (v{version}): {e}")
        if not data.startswith(b"\x89PNG\r\n\x1a\n"):
            sys.exit(f"{it['key']}: icon {icon_id} (v{version}) did not return a PNG")
        (ICONS / f"{it['key']}.png").write_bytes(_normalize_icon(data))
        got += 1
        print(f"  {it['key']:26} <- {icon_id} (v{version})")
    print(f"fetched {got} official icons into {ICONS.relative_to(ROOT)}")

    # The hand-cut placeholders (no icon_id) go through the same footprint, or they would stay at
    # their original size and tower over the fetched ones. Idempotent: down-only, so a second run
    # finds them already within the cap and leaves them be.
    normed = 0
    for it in items:
        if it.get("icon_id") is not None:
            continue
        p = ICONS / f"{it['key']}.png"
        if p.exists():
            p.write_bytes(_normalize_icon(p.read_bytes()))
            normed += 1
    print(f"normalized {normed} hand-cut icons to the same footprint")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="fail if generated output is stale")
    ap.add_argument(
        "--fetch-icons",
        action="store_true",
        help="download official icons from maplestory.io for items with an icon_id",
    )
    args = ap.parse_args()

    items = load()
    bosses = load_bosses()

    if args.fetch_icons:
        fetch_icons(items)

    problems = check_art(items)
    if problems:
        print("catalog is inconsistent with its art:\n", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        sys.exit(1)

    outputs = [
        (SQL_OUT, sql(items)),
        (BOSS_OUT, boss_json(bosses)),
        (BOSS_SQL_OUT, boss_sql(bosses)),
    ]

    if args.check:
        stale = [path for path, want in outputs if (path.read_text() if path.exists() else "") != want]
        if stale:
            names = ", ".join(str(p.relative_to(ROOT)) for p in stale)
            sys.exit(f"stale, run python catalog/build.py: {names}")
        print(f"catalog is in sync ({len(items)} items, {_boss_summary(bosses)})")
        return

    for path, want in outputs:
        path.write_text(want)
    print(f"wrote {len(items)} items and {_boss_summary(bosses)}")


if __name__ == "__main__":
    main()
