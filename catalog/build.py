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
import re
import pathlib
import struct
import sys

import yaml


class _StrictLoader(yaml.SafeLoader):
    """SafeLoader that refuses a duplicate mapping key instead of letting the later one win.

    PyYAML's default is to keep the last silently, which is how a second whole `drops:` block sat
    in drops.yaml for a day: the build read one of them, and every edit to the other was a no-op
    that still reviewed fine.
    """


def _no_duplicates(loader, node, deep=False):
    seen = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in seen:
            sys.exit(f"{loader.name}: duplicate key {key!r}, which would silently override the first")
        seen.add(key)
    return yaml.SafeLoader.construct_mapping(loader, node, deep=deep)


_StrictLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _no_duplicates)


def load_yaml(path: pathlib.Path):
    """Every manifest goes through here, so none of them can define a key twice."""
    with path.open() as f:
        return yaml.load(f, _StrictLoader)


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
# The difficulty ladder, lowest first. CHAOS is the third rung under another name, used by the
# bosses that are monsters rather than people, so a boss carries HARD or CHAOS and never both.
BOSS_DIFFICULTIES = ["EASY", "NORMAL", "HARD", "CHAOS", "EXTREME"]
# Boss portraits, cut from a planner capture by vision/app/cv/build_boss_portraits.py and named
# from the boss key. Every TRACKED boss must have one: a boss drawn without art sits beside
# fifteen that have it and reads as a failed load.
BOSS_ICONS = ROOT / "backend" / "src" / "main" / "resources" / "seed-assets" / "bosses"

# The portrait paths, shipped in the frontend bundle. The art itself stays on the backend with
# every other seed asset; this is only the list of URLs, and it exists so the browser can START
# fetching the portraits at first render instead of after a token and an /api/bosses call.
# Generated, so adding a boss is still one edit to bosses.yaml.
BOSS_ART_OUT = ROOT / "frontend" / "lib" / "boss-art.ts"

# The boss drop tables. What a boss can drop, and the art the loot pool draws beside it. Unlike
# items, a drop has no vision template: nothing reads these off a screenshot, they are picked from
# a list by a human.
DROP_MANIFEST = ROOT / "catalog" / "drops.yaml"
DROP_ICONS = ROOT / "backend" / "src" / "main" / "resources" / "seed-assets" / "drops"
DROP_SQL_OUT = ROOT / "backend" / "src" / "main" / "resources" / "db" / "migration" / "R__drop_catalog.sql"
WORLD_INTERACTIVE = "INTERACTIVE"
WORLD_HEROIC = "HEROIC"
DROP_PER_MEMBER = {"ALWAYS", WORLD_HEROIC}
DROP_WORLDS = {WORLD_INTERACTIVE, WORLD_HEROIC}

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


def png_size(path: pathlib.Path) -> tuple[int, int]:
    """Width and height from the IHDR. Stdlib only: the plain build must not need Pillow."""
    head = path.read_bytes()[:24]
    if not head.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError(f"{path} is not a PNG")
    return struct.unpack(">II", head[16:24])


def canvas_problem(icon: pathlib.Path) -> str | None:
    """Art off the shared canvas, which the frontend draws 1:1 and so cannot correct.

    `vestige-of-erion.png` shipped at 37x37 for months. The CSS box is 46, so the browser stretched
    it 1.243x, and it read 1.44x larger than the icons beside it. Nothing caught it: the checks
    below only asked whether the file existed.
    """
    if not icon.exists():
        return None  # a missing file is already reported by the caller
    w, h = png_size(icon)
    if (w, h) != (ICON_CANVAS, ICON_CANVAS):
        return (
            f"{icon.relative_to(ROOT)} is {w}x{h}, not {ICON_CANVAS}x{ICON_CANVAS} "
            f"(centre it on the canvas; see catalog/build.py ICON_CANVAS)"
        )
    return None


KEY_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789-")


CATEGORIES = {"REDEMPTION_TOKEN", "CONSUMABLE"}


def load() -> list[dict]:
    items = load_yaml(MANIFEST)["items"]

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
        art = it.get("art")
        if art is not None and art != "cut":
            sys.exit(f"{key}: art may only be 'cut', for a picture the mirror does not carry, got {art!r}")
        if art == "cut" and icon_id is not None:
            sys.exit(f"{key}: art 'cut' and an icon_id are two sources for one picture, pick one")

        slots = it.get("redeem_slots")
        if cat == "REDEMPTION_TOKEN" and not slots:
            sys.exit(f"{key}: a REDEMPTION_TOKEN needs redeem_slots. What does it buy?")
        if cat != "REDEMPTION_TOKEN" and slots:
            sys.exit(f"{key}: only a REDEMPTION_TOKEN can have redeem_slots")
    return items


def load_bosses() -> list[dict]:
    bosses = load_yaml(BOSS_MANIFEST)["bosses"]
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
        if "short" in b and not str(b["short"]).strip():
            sys.exit(f"{key}: short must be a name or absent, not empty")
        # Absent is nobody having counted it. A zero or a null would be a boss admitting nobody,
        # which is not a thing, so neither is accepted as a way of saying "unknown".
        if "max_party" in b and (not isinstance(b["max_party"], int) or b["max_party"] < 1):
            sys.exit(
                f"{key}: max_party must be a positive integer or absent, got {b['max_party']!r}"
            )
        check_difficulties(b)
    return bosses


def check_difficulties(boss: dict) -> None:
    """The modes a config can pick from. Required for a tracked boss, and in ladder order.

    An untracked boss is seeded nowhere and so has no config to pick for. See catalog/bosses.yaml.
    """
    key = boss["key"]
    modes = boss.get("difficulties") or []
    if not modes:
        if boss.get("tracked", True):
            sys.exit(f"{key}: needs difficulties, a party config picks the mode it runs from them")
        return
    unknown = [m for m in modes if m not in BOSS_DIFFICULTIES]
    if unknown:
        sys.exit(f"{key}: difficulty {unknown[0]!r} is not one of {BOSS_DIFFICULTIES}")
    if len(set(modes)) != len(modes):
        sys.exit(f"{key}: lists the same difficulty twice")
    if "HARD" in modes and "CHAOS" in modes:
        sys.exit(f"{key}: HARD and CHAOS are one rung under two names, a boss has one of them")
    rungs = [BOSS_DIFFICULTIES.index(m) for m in modes]
    if rungs != sorted(rungs):
        sys.exit(f"{key}: difficulties must be listed lowest first, the UI shows them in this order")


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
    This seed does not DELETE, so untracking a boss that is already seeded needs a versioned
    migration to remove its row and its clears (see V14__drop_daily_bosses.sql).
    """

    def q(s: str) -> str:
        return "'" + s.replace("'", "''") + "'"

    def modes(b: dict) -> str:
        return "ARRAY[" + ", ".join(q(m) for m in b["difficulties"]) + "]::TEXT[]"

    tracked = [b for b in bosses if b.get("tracked", True)]
    # Manifest position IS the sort order, so reordering bosses.yaml reorders the matrix and
    # nothing else has to be touched. See V12__boss_sort_order.sql.
    rows = ",\n".join(
        f"    ({q(b['key'])}, {q(b['name'])}, {q(b['reset'])}, {i}, {q(b['key'] + '.png')},"
        f" {modes(b)})"
        for i, b in enumerate(tracked)
    )
    return f"""-- GENERATED FROM catalog/bosses.yaml. DO NOT EDIT BY HAND.
-- Regenerate with:  python catalog/build.py
--
-- Repeatable (R__): editing bosses.yaml reseeds boss_catalog on the next boot. Upserts by
-- boss_key and keeps an existing row's id, which boss_clear references, so it is never churned.

INSERT INTO boss_catalog (id, boss_key, name, reset, sort_order, icon_ref_key, difficulties)
SELECT COALESCE(existing.id, gen_random_uuid()), v.boss_key, v.name, v.reset, v.sort_order,
       v.icon_ref_key, v.difficulties
FROM (VALUES
{rows}
) AS v (boss_key, name, reset, sort_order, icon_ref_key, difficulties)
LEFT JOIN boss_catalog existing ON existing.boss_key = v.boss_key
ON CONFLICT (boss_key) DO UPDATE SET
    name         = EXCLUDED.name,
    reset        = EXCLUDED.reset,
    sort_order   = EXCLUDED.sort_order,
    icon_ref_key = EXCLUDED.icon_ref_key,
    difficulties = EXCLUDED.difficulties;
"""




def load_drops(bosses: list[dict]) -> tuple[list[dict], dict[str, list[dict]]]:
    """The drop manifest, validated against the boss catalog it keys on."""
    data = load_yaml(DROP_MANIFEST)
    drops = list(data["drops"])
    tables = data["tables"]

    seen: set[str] = set()
    for d in drops:
        key = d["key"]
        if set(key) - KEY_CHARS:
            sys.exit(f"drop key {key!r} must be lowercase kebab-case, it becomes a DB value")
        if key in seen:
            sys.exit(f"duplicate drop key {key!r}")
        seen.add(key)
        if not d.get("name"):
            sys.exit(f"{key}: needs a name, it is what the loot pool shows")
        icon_id = d.get("icon_id")
        if icon_id is not None and not isinstance(icon_id, int):
            sys.exit(f"{key}: icon_id must be an integer maplestory.io item id, got {icon_id!r}")
        per_member = d.get("per_member")
        if per_member is not None and per_member not in DROP_PER_MEMBER:
            sys.exit(f"{key}: per_member must be one of {sorted(DROP_PER_MEMBER)}, got {per_member!r}")
        worlds = d.get("worlds")
        if worlds is not None and worlds not in DROP_WORLDS:
            sys.exit(f"{key}: worlds must be one of {sorted(DROP_WORLDS)}, got {worlds!r}")
        quantity = d.get("quantity", 1)
        if not isinstance(quantity, int) or quantity < 1:
            sys.exit(f"{key}: quantity must be a positive integer, got {quantity!r}")
        fungible = d.get("fungible", False)
        if not isinstance(fungible, bool):
            sys.exit(f"{key}: fungible must be true or absent, got {fungible!r}")
        # A per-member drop is never pooled, so there is no sale to file against a queue of rows.
        # Both flags on one drop is a manifest that contradicts itself.
        if fungible and per_member is not None:
            sys.exit(f"{key}: fungible and per_member cannot both be set, a per-member drop is not pooled")
        art = d.get("art")
        if art is not None and art != "cut":
            sys.exit(f"{key}: art may only be 'cut', for a picture the mirror does not carry, got {art!r}")
        if art == "cut" and icon_id is not None:
            sys.exit(f"{key}: art 'cut' and an icon_id are two sources for one picture, pick one")

    # A table keyed on a boss that is not tracked would seed a row against no boss_catalog id, so
    # it is refused here rather than dropped silently at insert time.
    tracked = {b["key"] for b in bosses if b.get("tracked", True)}
    modes_of = {b["key"]: b.get("difficulties") or [] for b in bosses}
    normalised: dict[str, list[dict]] = {}
    for boss_key, entries in tables.items():
        if boss_key not in tracked:
            sys.exit(f"drop table for {boss_key!r}: not a tracked boss in catalog/bosses.yaml")
        # A bare key is the ordinary entry. A mapping carries what varies per (boss, difficulty),
        # which so far is only how many pieces drop.
        rows = [{"key": e} if isinstance(e, str) else dict(e) for e in entries]
        keys = [r.get("key") for r in rows]
        for key in keys:
            if key not in seen:
                sys.exit(f"drop table for {boss_key!r}: no drop named {key!r}")
        if len(set(keys)) != len(keys):
            sys.exit(f"drop table for {boss_key!r}: lists the same drop twice")
        for row in rows:
            pieces = row.get("pieces") or {}
            if not isinstance(pieces, dict):
                sys.exit(f"drop table for {boss_key!r}: pieces must map a difficulty to a count")
            counts = {}
            for difficulty, amount in pieces.items():
                # Against the BOSS'S own modes, not the whole list: a count under a difficulty it
                # does not have could never be read, and would sit here looking authoritative.
                if difficulty not in modes_of.get(boss_key, []):
                    sys.exit(
                        f"drop table for {boss_key!r}: {difficulty!r} is not one of its difficulties"
                    )
                # A bare count says only how many fell. The mapping also says how many STACKS they
                # fell in, which is what decides whether a party can divide them by looting alone.
                # Both spellings stay: a drop whose bundling nobody has counted says nothing rather
                # than guessing a number that would then be checked against the total below.
                if isinstance(amount, dict):
                    unknown = sorted(set(amount) - {"total", "bundles"})
                    if unknown:
                        sys.exit(
                            f"drop table for {boss_key!r} {difficulty}: pieces takes total and "
                            f"bundles, got {unknown}"
                        )
                    total, bundles = amount.get("total"), amount.get("bundles")
                else:
                    total, bundles = amount, None
                if not isinstance(total, int) or total < 1:
                    sys.exit(
                        f"drop table for {boss_key!r} {difficulty}: pieces must be a positive "
                        f"integer, got {total!r}"
                    )
                if bundles is not None:
                    if not isinstance(bundles, int) or bundles < 1:
                        sys.exit(
                            f"drop table for {boss_key!r} {difficulty}: bundles must be a positive "
                            f"integer, got {bundles!r}"
                        )
                    # Stacks are equal and whole, so a total that does not divide by them means one
                    # of the two numbers is wrong. Cheap, and it pins every count in the file
                    # against a second fact rather than against nothing.
                    if total % bundles:
                        sys.exit(
                            f"drop table for {boss_key!r} {difficulty}: {total} pieces do not "
                            f"divide into {bundles} bundles"
                        )
                # INTERACTIVE only. `pieces` states the size of a POOL, and Reboot has no pool to
                # state: it instances every piece it drops, one count into each inventory. Written
                # to both worlds, this number had a Heroic party dividing 180 coupons six ways and
                # settling the shortfall.
                counts[difficulty] = {WORLD_INTERACTIVE: {"total": total, "bundles": bundles}}
            if counts:
                row["pieces"] = counts
        normalised[boss_key] = rows

    return drops, normalised



def drop_sql(drops: list[dict], tables: dict[str, list[str]]) -> str:
    """The drop_catalog and boss_drop seed. Upserts by drop_key, keeps ids, and rebuilds tables.

    boss_drop IS deleted and rewritten, unlike the catalog rows: it is a pure join with nothing
    referencing it, and a boss losing a drop has to actually lose it. drop_catalog rows are kept
    because party_loot points at them, so churning an id would orphan somebody's loot history.
    """

    def q(s: str) -> str:
        return "'" + s.replace("'", "''") + "'"

    def opt(value) -> str:
        return "NULL" if value is None else q(value)

    rows = ",\n".join(
        f"    ({q(d['key'])}, {q(d['name'])}, "
        f"{q(d['key'] + '.png') if has_art(d) else 'NULL'}, "
        f"{opt(d.get('per_member'))}, {opt(d.get('worlds'))}, {d.get('quantity', 1)}, "
        f"{'TRUE' if d.get('fungible', False) else 'FALSE'}, {i})"
        for i, d in enumerate(drops)
    )
    pairs = ",\n".join(
        f"    ({q(boss_key)}, {q(row['key'])}, {i})"
        for boss_key, rows in tables.items()
        for i, row in enumerate(rows)
    )
    # NULL bundles is a drop nobody has counted the stacks for. Not one stack: the column is read to
    # decide whether a party could divide the drop at all, and a wrong one there invents a debt.
    amounts = ",\n".join(
        f"    ({q(boss_key)}, {q(row['key'])}, {q(difficulty)}, {q(world)}, {amount['total']}, "
        f"{amount['bundles'] if amount['bundles'] is not None else 'NULL'})"
        for boss_key, rows in tables.items()
        for row in rows
        for difficulty, by_world in (row.get("pieces") or {}).items()
        for world, amount in by_world.items()
    )
    amount_sql = (
        f"""
INSERT INTO boss_drop_amount (boss_catalog_id, drop_catalog_id, difficulty, world, pieces, bundles)
SELECT b.id, d.id, v.difficulty, v.world, v.pieces, v.bundles
FROM (VALUES
{amounts}
) AS v (boss_key, drop_key, difficulty, world, pieces, bundles)
JOIN boss_catalog b ON b.boss_key = v.boss_key
JOIN drop_catalog d ON d.drop_key = v.drop_key;
"""
        if amounts
        else ""
    )
    return f"""-- GENERATED FROM catalog/drops.yaml. DO NOT EDIT BY HAND.
-- Regenerate with:  python catalog/build.py
--
-- Repeatable (R__): editing drops.yaml reseeds the drop catalog on the next boot. drop_catalog
-- upserts by drop_key and keeps an existing row's id, which party_loot references. boss_drop is
-- rebuilt outright, so a drop removed from a boss's table really leaves it.

INSERT INTO drop_catalog (id, drop_key, name, icon_ref_key, per_member, worlds, quantity, fungible, sort_order)
SELECT COALESCE(existing.id, gen_random_uuid()), v.drop_key, v.name, v.icon_ref_key, v.per_member,
       v.worlds, v.quantity, v.fungible, v.sort_order
FROM (VALUES
{rows}
) AS v (drop_key, name, icon_ref_key, per_member, worlds, quantity, fungible, sort_order)
LEFT JOIN drop_catalog existing ON existing.drop_key = v.drop_key
ON CONFLICT (drop_key) DO UPDATE SET
    name         = EXCLUDED.name,
    icon_ref_key = EXCLUDED.icon_ref_key,
    per_member = EXCLUDED.per_member,
    worlds     = EXCLUDED.worlds,
    quantity   = EXCLUDED.quantity,
    fungible   = EXCLUDED.fungible,
    sort_order = EXCLUDED.sort_order;

DELETE FROM boss_drop;
DELETE FROM boss_drop_amount;

INSERT INTO boss_drop (boss_catalog_id, drop_catalog_id, sort_order)
SELECT b.id, d.id, v.sort_order
FROM (VALUES
{pairs}
) AS v (boss_key, drop_key, sort_order)
JOIN boss_catalog b ON b.boss_key = v.boss_key
JOIN drop_catalog d ON d.drop_key = v.drop_key;
{amount_sql}"""


def has_item_art(item: dict) -> bool:
    """Whether this item claims a picture: downloaded from the mirror, or cut by hand.

    The same two sources a drop has, and the same reason for saying so rather than looking: an item
    the mirror does not carry and nobody has cut art for is drawn as an empty slot, which is honest,
    where a filename pointing at nothing is a broken image.
    """
    return item.get("icon_id") is not None or item.get("art") == "cut"


def check_art(items: list[dict]) -> list[str]:
    """An item must have the art it CLAIMS. A vision template is optional.

    The template used to be required, and that requirement was the whole cost of adding an item: a
    capture, a hand cut, and a process nobody had written down. So an item the parser could not read
    was an item the app could not be told about at all, which is why four Eternal fragments and
    Jupiter's token were drops rather than items for weeks.

    An item without one is simply not readable off a capture. Its count is typed instead (see
    CharacterTokenWrites.kt), which is now a thing that can be done.
    """
    problems = []
    for it in items:
        key = it["key"]
        icon = ICONS / f"{key}.png"
        if has_item_art(it) and not icon.exists():
            hint = "cut by hand, see catalog/items.yaml" if it.get("art") == "cut" else "run --fetch-icons"
            problems.append(f"missing icon asset:     {icon.relative_to(ROOT)} ({hint})")
        if off := canvas_problem(icon):
            problems.append(f"off-canvas icon:        {off}")

    # A template the manifest does not know about still has to go. That is an item the parser can
    # detect and the app cannot name, which is the silent mismatch this file exists to prevent, and
    # it is unaffected by the template being optional in the other direction.
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
        f"    ({q(it['key'])}, {q(it['name'])}, {q(it['boss'])}, "
        f"{q(it['key'] + '.png') if has_item_art(it) else 'NULL'}, "
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
        req = urllib.request.Request(url, headers={"User-Agent": "sharpeyes-build"})
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


def boss_art_ts(bosses: list[dict]) -> str:
    """The frontend's copy of the portrait paths and display names. Never the art itself."""
    # Quoted only when the key is not a bare JS identifier, which is prettier's own
    # "quote-props: as-needed" rule. Emitting it that way keeps this file passing
    # `prettier --check` without the generator and the formatter fighting over it.
    def prop(key: str) -> str:
        return key if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", key) else f'"{key}"'

    tracked = [b for b in bosses if b.get("tracked", True)]
    rows = "\n".join(f'  {prop(b["key"])}: "/boss-icons/{b["key"]}.png",' for b in tracked)
    rows2x = "\n".join(f'  {prop(b["key"])}: "/boss-icons/{b["key"]}@2x.png",' for b in tracked)
    names = "\n".join(f'  {prop(b["key"])}: "{b["name"]}",' for b in tracked)
    short = "\n".join(
        f'  {prop(b["key"])}: "{b["short"]}",' for b in tracked if b.get("short")
    )
    return f"""// GENERATED FROM catalog/bosses.yaml. DO NOT EDIT BY HAND.
// Regenerate with:  python catalog/build.py
//
// What is known before a USER is, which is the whole reason these are shipped in the bundle
// rather than read off /api/bosses.
//
// BOSS_ART is backend-relative portrait paths, resolved with apiAssetUrl() like every other
// served asset. It exists so the browser can start fetching the portraits at first render rather
// than after getToken() and /api/bosses have both answered. That waterfall is what made the art
// appear a beat after the rest of the page.
//
// BOSS_ART_2X is the same portraits at 80px, for the one place that draws them larger than the
// game does (Run Order's 40px row). Use it wherever the box is bigger than 26px; use BOSS_ART
// wherever it is 26px or an exact fraction of it. See vision/app/cv/build_boss_portraits.py.
//
// BOSS_NAMES is the display names, in catalog order. The Run Order tool has to offer a boss list
// with no account behind it, and deriving one from the keys gets "Kalos The Guardian" wrong.
//
// Only tracked bosses in all three, matching what boss_catalog is seeded with.
//
// BOSS_SHORT_NAMES is what a party calls a boss out loud, and holds only the ones that have one.
// A missing key means the full name is the short name. Never match anything against these.

export const BOSS_ART: Record<string, string> = {{
{rows}
}};

export const BOSS_ART_2X: Record<string, string> = {{
{rows2x}
}};

export const BOSS_NAMES: Record<string, string> = {{
{names}
}};

export const BOSS_SHORT_NAMES: Record<string, string> = {{
{short}
}};
"""


def check_boss_art(bosses: list[dict]) -> list[str]:
    """Every tracked boss needs its portrait, named from its key. Untracked ones are drawn nowhere."""
    problems = []
    for b in bosses:
        if not b.get("tracked", True):
            continue
        # Both sizes, because they are drawn in different places: a boss with only the 26px asset
        # loses its art on Run Order alone, which is the half nobody would think to check.
        for icon in (BOSS_ICONS / f"{b['key']}.png", BOSS_ICONS / f"{b['key']}@2x.png"):
            if not icon.exists():
                problems.append(
                    f"{b['key']}: missing {icon.relative_to(ROOT)} "
                    "(cd vision && python -m app.cv.build_boss_portraits)"
                )
    return problems


def has_art(drop: dict) -> bool:
    """Whether this drop has a picture at all: downloaded from the mirror, or cut by hand.

    A hand cut (`art: cut`) is for an item the pinned dataset does not carry. The mirror is the
    default and stays it; this is the escape hatch for a drop the game has and it does not, and it
    names the same seed-assets file an icon_id would have.
    """
    return drop.get("icon_id") is not None or drop.get("art") == "cut"



def check_drop_art(drops: list[dict]) -> list[str]:
    """A drop that claims a picture must have it. One with none is drawn blank, on purpose."""
    problems = []
    for d in drops:
        if not has_art(d):
            continue
        icon = DROP_ICONS / f"{d['key']}.png"
        if not icon.exists():
            hint = "cut by hand, see catalog/drops.yaml" if d.get("art") == "cut" else "run --fetch-icons"
            problems.append(f"{d['key']}: missing {icon.relative_to(ROOT)} ({hint})")
        if off := canvas_problem(icon):
            problems.append(f"{d['key']}: {off}")
    return problems


def fetch_drop_icons(drops: list[dict]) -> None:
    """Download the official sprite for every drop with an icon_id. Same rules as fetch_icons."""
    import urllib.request

    DROP_ICONS.mkdir(parents=True, exist_ok=True)
    got = 0
    for d in drops:
        icon_id = d.get("icon_id")
        if icon_id is None:
            continue
        version = d.get("icon_version", ICON_VERSION)
        url = ICON_URL.format(version=version, icon_id=icon_id)
        req = urllib.request.Request(url, headers={"User-Agent": "sharpeyes-build"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
        except Exception as e:
            sys.exit(f"{d['key']}: could not fetch icon {icon_id} (v{version}): {e}")
        if not data.startswith(b"\x89PNG\r\n\x1a\n"):
            sys.exit(f"{d['key']}: icon {icon_id} (v{version}) did not return a PNG")
        (DROP_ICONS / f"{d['key']}.png").write_bytes(_normalize_icon(data))
        got += 1
        print(f"  {d['key']:36} <- {icon_id} (v{version})")
    print(f"fetched {got} drop icons into {DROP_ICONS.relative_to(ROOT)}")

    # No hand-cut pass here, unlike fetch_icons. Do not add one that calls _normalize_icon: the cap
    # measures the alpha bbox, and a hand-cut sprite may be mostly glow. Vestige of Erion is 37x37
    # of which the solid core is 33 (a>128), already inside the 26-32 the fetched icons occupy, so
    # capping its bbox at 32 would shrink the core below the pack AND resample away the crisp
    # outline. `art: cut` art is sized by a human; check_drop_art refuses it if it misses the
    # canvas, which is the honest answer rather than a silent rescale.


def _refuse_missing_art(problems: list[str]) -> None:
    if not problems:
        return
    print("catalog is inconsistent with its art:\n", file=sys.stderr)
    for p in problems:
        print(f"  - {p}", file=sys.stderr)
    sys.exit(1)


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
    drops, drop_tables = load_drops(bosses)

    if args.fetch_icons:
        fetch_icons(items)
        fetch_drop_icons(drops)

    problems = check_art(items) + check_drop_art(drops) + check_boss_art(bosses)

    outputs = [
        (SQL_OUT, sql(items)),
        (BOSS_OUT, boss_json(bosses)),
        (BOSS_SQL_OUT, boss_sql(bosses)),
        (DROP_SQL_OUT, drop_sql(drops, drop_tables)),
        (BOSS_ART_OUT, boss_art_ts(bosses)),
    ]

    if args.check:
        _refuse_missing_art(problems)
        stale = [path for path, want in outputs if (path.read_text() if path.exists() else "") != want]
        if stale:
            names = ", ".join(str(p.relative_to(ROOT)) for p in stale)
            sys.exit(f"stale, run python catalog/build.py: {names}")
        print(f"catalog is in sync ({len(items)} items, {_boss_summary(bosses)}, {len(drops)} drops)")
        return

    for path, want in outputs:
        path.write_text(want)
    print(f"wrote {len(items)} items, {_boss_summary(bosses)} and {len(drops)} drops")
    # AFTER writing, deliberately. A new boss has no portrait until build_boss_portraits cuts one,
    # and that script reads the boss catalog this run generates: checking first would deadlock the
    # two, with each waiting on the other. Writing first and failing after leaves the tree exactly
    # one command short of correct, and --check still refuses to let it be committed that way.
    _refuse_missing_art(problems)


if __name__ == "__main__":
    main()
