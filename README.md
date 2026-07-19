# MapleStorage

Track what your characters are holding, across every character at once.

Farming the same Grandis boss on several mules is normal, but the game gives you no way to see how
close you actually are to a redemption set without logging into each character and counting by
hand. MapleStorage does the counting.

## What it does

**Add your characters.** Give it a name and it looks up the level, job and sprite for you.

**Drop a screenshot on the character it belongs to.** Take one with your inventory open. It reads
which items are there and how many of each, and records them against that character. It also reads
the character's name out of the game's HUD, not to guess whose screenshot it is, but to *check*:
if the picture disagrees with the character you dropped it on, it says so rather than filing it
anyway.

**It tracks 26 items** in three groups: the six Eternal boss pieces, the thirteen Arcane and Sacred
symbol coupons, and the elixirs and potions. The list is `catalog/items.yaml`, which is the single
source of truth for the parser, the database and the UI alike.

**Search across every character.** Type what you would actually say. `kaling`, `eternal hat`,
`robe`, `symbol`, and it shows who is holding a match, how many, and **what each of them can
redeem right now**.

That last number is the point, and it is the one the arithmetic gets wrong. Eternal pieces cannot be
pooled: six on one character and four on another is not a set, it is two characters who are both
short. Nor can they be mixed. Nine Kalos and one Kaling is nine and one. And the two piece-sets do
not buy the same thing: Kalos / Kaling / First Adversary / Malefic Star pieces make a Hat, Top,
Bottom or Shoulder, while Limbo and Baldrix pieces make a Cape, Glove or Shoe. Ten of each is one
armour and one accessory, never two of anything.

## What it will not do

**Report a count it cannot stand behind.** An item whose stack count is unreadable is dropped
rather than reported with a guessed number. A plausible wrong number is the only failure this
project really has.

**Refuse a screenshot it can actually read.** A rescaled capture (remote play, display scaling) is
read at its own scale rather than rejected. Only a *downscaled* one is refused, because that
genuinely throws pixels away.

There is no vision LLM and no API key. Parsing is a deterministic OpenCV pipeline in `vision/`: it
costs nothing, makes no network call, and returns the same answer every time.

## Working on it

```bash
./scripts/smoke.sh    # runs the whole thing locally and checks it works
```

`docker compose down -v` wipes the dev database, and the characters and parsed screenshots in it
are hand-made: no migration or seed rebuilds them. Take a snapshot before you do anything that
resets it.

```bash
./scripts/dev-db-snapshot.sh    # -> dev-snapshots/ (gitignored: the repo is public)
./scripts/dev-db-restore.sh     # restores dev-snapshots/latest.sql.gz
```

| | |
| --- | --- |
| `.devcontainer/README.md` | **Start here on a new machine.** Setup, credentials, and what to do when it hangs |
| `CLAUDE.md` | House rules. Chiefly, what a comment is for |
| `catalog/items.yaml` | Every item. Change it here and nowhere else |
| `WEB-UI-SPEC.md` | What the frontend is, and why |
| `PLAN.md` | Why the project is built the way it is (historical) |
| `backend/`, `vision/`, `infra/` | Each has its own README |
