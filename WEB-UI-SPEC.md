# Web UI

What the frontend is, and why. This describes what ships. Where an earlier design was abandoned,
the reason is recorded, because that is the part worth keeping.

Kept separate from `PLAN.md` because UI iteration moves faster than the data model.

## Design language

The app shell is restrained: information density, no decoration for its own sake. Plain rows over
cards, borders over shadows, text links over buttons, inline expansion over modals.

Two rules from the original design did not survive, and the reasons matter.

**Monochrome, dark-only.** There is a real theme system now (system, dark, light), cycled from the
header and applied before first paint. A hardcoded palette made a light theme impossible and made
every new component a coin toss, because there was nothing to reach for that would be right in
both. The shell is 13 tokens, defined in both themes, and every ink token is held to a 4.5 contrast
bar against every surface. That bar is checked, not eyeballed. Three legibility bugs shipped before
it existed, including text coloured with a *surface* token, which is invisible by construction.

**Text-only.** The inventory is drawn as the game draws it, which is the opposite of text-only, and
it is what makes the app readable at a glance.

## The inventory window

The centrepiece is a recreation of MapleStory's own inventory window. The fidelity is not
nostalgia: an icon you already recognise is one you do not have to read.

- **Icons are the client's own pixels**, cut from real screenshots by `vision/app/cv/build_icons.py`
  and drawn **1:1** at the client's 46px slot size. Nothing is scaled. Scaling pixel art by a
  non-integer factor with nearest-neighbour drops rows and columns unevenly, which is exactly what
  made the icons look mangled.
- **Stack counts are the client's own digit sprites**, the same glyphs the parser reads counts
  with, served from `/digit-icons`. No web font is an 11px bitmap face with a hard black outline,
  and every approximation of one sat beneath a pixel-exact icon and gave itself away.
- **The window stays light in both themes.** The game draws it light. A dark MapleStory inventory
  is a MapleStory inventory that does not exist. It carries its own ink tokens, so anything inside
  it is legible against *its* background rather than the app's.

**It does not draw the 128-slot bag.** That was faithful and useless. A grid nine-tenths empty
makes you hunt for the twenty things you track, and gives the six boss pieces the same weight as a
stack of potions. The game must draw empty slots because you can put things in them. We never can.

So it renders sections, sized to their contents, in a fixed order: Eternal Pieces, Symbols,
Consumables. The grouping and the order are real columns on the catalog (`item_group`,
`sort_order`), seeded from `catalog/items.yaml`. They are not inferred from the key in the
frontend, because inference mis-sorts the first item that does not fit the pattern, and does it
silently.

## Pages

### Characters

Everything happens here. There used to be a separate Upload page, and removing it removed a class
of failure rather than relocating it.

**The carousel.** One character selected, always. There is no "All characters" tile. It was doing
two unrelated jobs at once, and choosing it for one silently opted you into the other: in the
inventory it meant "the sum across everyone", which is a number nobody can act on since these items
cannot be moved between characters, and in the upload it meant "work out from the HUD whose this
is".

**The capture dock.** You drop a screenshot on the character it belongs to. The old flow could not
know whose it was. It parsed the image, OCR'd the name out of the HUD, and **guessed**, and the
whole review step existed to correct the guess. Dropping it on a character removes the ambiguity at
source. The HUD stops being the answer and becomes a **check** on it: if the picture disagrees with
the character you dropped it on, that is a contradiction worth shouting about, not a shrug.

Uploading generically (read the name from the HUD) is still possible, as an explicit eye toggle on
the dropzone. It **is** the same state as having no character selected, not a second flag that can
disagree with the carousel. A screenshot cannot be both "definitely Bob's" and "work out whose it
is".

Both upload docks (this one, and the Maple Planner dock on Boss Matrix) sit at the **top** of
the page they feed, and **fold** to their title bar. Uploading is something you do once after a
run, while reading the numbers is what the rest of the week is for, so the fold is remembered
between visits. What came back from a capture never folds: the read is the answer to the upload
you just made.

**The preview grid.** The parse is shown before it is committed, in the same 16-wide lattice as the
inventory below, with what *changed* called out (`+n`, or `new`). An upload used to be a leap of
faith: it parsed, it wrote, and you found out afterwards. This project has shipped silent
undercounts (a prefilter binning one real item in eight, a symbol reporting 630 of the 1427 held),
so a UI where a bad parse is visible **before** it lands is worth more than one you have to trust.

**Search.** Cross-character, and it answers the question the old aggregate could not. "40 Kalos
pieces" is arithmetic that means nothing when the pieces cannot be moved: ten characters with four
each is a very different situation from four characters with ten.

It matches on anything you might actually say. The item name, the **boss** (nobody thinks
"Ferocious Beast Entanglement Ring", they think "the thing Kaling drops"), the section, and the
**pieces it buys**, including the names the game really uses (a hat is a Bandana or a Helm, a top
is a Hood, Shirt, Coat, Robe or Armor). Terms match independently, so "eternal hat" is two facts
rather than a phrase that appears nowhere.

It costs no network. Every character's inventory is fetched up front in one request, which also
removes the first-visit flicker.

Each result says what that character can **redeem right now**, which is the only actionable number.

The search bar sits at page level, not inside the inventory window. That is a scope decision rather
than a layout one: the window's chrome is a promise about what is inside it, and putting a
cross-character search into one character's window would say the opposite of what it does.

### Landing (pre-login)

Deliberately more spacious than the rest of the app. Repeated attempts to explain the core loop
*inside* the working page kept feeling insufficient, and the diagnosis was that the density which
makes the tool good is the wrong mode for teaching the idea to someone who has never seen it. A
separate page carries that job, so the authenticated app can stay dense.

Its before/after example uses **real, manually verified counts** from the earliest vision
feasibility check, not fabricated numbers. Consistent with this project's habit of validating
claims rather than asserting them.

## Redemption, and why the UI is careful about it

Three ways to produce a confident, wrong number, all of which look like arithmetic. All three have
been shipped at some point.

1. **Pieces cannot be pooled across characters.** Six on one and four on another is not a set.
2. **Pieces cannot be mixed between tokens.** Nine Kalos and one Kaling is nine and one.
3. **The two piece-sets do not buy the same thing.** Kalos, Kaling, First Adversary and Malefic
   Star pieces make a Hat, Top, Bottom or Shoulder. Limbo and Baldrix pieces make a Cape, Glove or
   Shoe. Ten of each is one armour and one accessory, never two of anything.

The counting lives in `frontend/lib/redemption.ts` as pure functions, guarded by tests, and the UI
calls those rather than re-deriving them. Inline in a component it could not be tested. Every figure
on screen comes from the same function, so two numbers on one page cannot contradict each other.

## Open

- **The chest mark.** MapleStory's Storage Room is a chest openable from any town, which is exactly
  what the app is. The name is SharpEyes now, so whether a chest is still the mark is itself open.
  The current 16x16
  pixel-art chest reads as generic pixel art rather than Maple: the client's UI is soft, rounded and
  anti-aliased. Undecided between redrawing it soft, commissioning one, or using the game's own icon
  and accepting the IP question knowingly. No Nexon art currently ships.
- **Favourites.** A user-chosen section pinned above the defaults. Needs per-user state, which is
  the same machinery as per-user item tracking.
