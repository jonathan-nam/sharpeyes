import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// The rule globals.css states next to `.ms-slot > img`, enforced instead of only written down:
// nearest-neighbour at a non-integer ratio drops or duplicates rows unevenly, so a straight edge
// grows a step in it and a 1px highlight disappears. It has now been broken five times, each
// time by a box sized by eye against art whose natural size lives somewhere else entirely.
//
// Twice of those it was broken WITH THIS FILE ALREADY HERE, by a rule that only narrows an icon
// somebody else declared the filter on: a 46px drop icon at 22px two folds into a ledger card, and
// a 96px avatar at 72px in the Boss Clears picker (that one is gone, every strip now draws the
// avatar at its own size). So the guard follows the cascade rather than reading one rule's body
// (see filterFor), and it is CLOSED rather than opt-in: a rule that sizes an image and is in
// neither table below fails, instead of being invisible the way those two were.
//
// The natural sizes are facts about assets, not about this file, and each is pinned where the asset
// is made:
//   - vision/tests/test_boss_portraits.py pins the two boss sizes.
//   - catalog/build.py pins the 46px icon canvas (ICON_CANVAS) and refuses art that misses it.
//     It only started reading the assets' real dimensions once a 37x37 drop icon had been sitting
//     in a 46px box; before that it checked the file existed and nothing more.
//   - 96 is what the Nexon avatar endpoint returns; see .tile-sprite's comment.
const NATURAL: Record<string, number> = {
  ".ms-slot > img": 46, // item icon canvas
  ".loot-icon": 46,
  ".ledger-drop-head .loot-icon": 46, // half, in a settlement card's list of shares
  ".ledger-drop-head.is-oneline .loot-icon": 46, // 0.7x, smoothed
  ".loot-shares .loot-icon": 46, // half, in an offset's own list of nights
  ".counts-icon": 46,
  ".tab-art": 34, // the Drop Log stage tabs, drawn 1:1 (see build-tab-marks.mjs MARK_CANVAS)
  ".world-emblem": 20, // world select emblem, 1:1 (see build-world-emblems.mjs EMBLEM_CANVAS)
  ".finder-suggest-row img": 46,
  ".drop-select-icon": 46,
  ".drop-select > .drop-select-icon": 46, // half size in the closed field
  ".finder-row li img": 46,
  ".boss-portrait": 26, // planner portrait, the game's own size
  ".boss-portrait.is-small": 26,
  ".run-art": 80, // the @2x portrait, BOSS_ART_2X
  ".tile-sprite": 96, // Nexon avatar render, and the one size a strip's sprite is drawn at
  ".character-row-sprite": 96,
  ".boss-char-sprite": 96,
  ".roster-sprite": 96,
  ".member-sprite": 96, // the whole render, 1:1, above a roster box
  ".party-banner-sprite": 96,
  ".seat-sprite": 96,
};

// Boxes that hold an image without being pixel art themselves, so there is no natural size for a
// ratio to be measured against. Each says why, because "it is exempt" is the sentence a real
// violation would also like to hide behind.
const NOT_PIXEL_ART: Record<string, string> = {
  ".capture-thumb": "a screenshot the user just uploaded, at whatever size their client runs",
};

/** Every rule in the sheet, one entry per selector in a comma-separated list, in document order. */
type Rule = { selector: string; body: string };
// Comments first. This sheet explains itself at length above almost every rule, and a comment is
// newlines and prose sitting exactly where a selector is looked for.
const sheet = css.replace(/\/\*[\s\S]*?\*\//g, "");
const RULES: Rule[] = [...sheet.matchAll(/(?:^|\n)([^\n@{}][^{}]*)\{([^{}]*)\}/g)].flatMap((m) =>
  m[1]!
    .split(",")
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0)
    .map((selector) => ({ selector, body: m[2]! })),
);

/**
 * The element a rule actually sizes, which is the LAST compound in its selector.
 *
 * `.ledger-drop-head.is-oneline .loot-icon` sizes a `.loot-icon`, and that is the element
 * `.loot-icon` declared the filter on. Reading the whole selector instead let the two live cases
 * hide.
 */
function subject(selector: string): { classes: Set<string>; tag: string | null } {
  const last =
    selector
      .split(/[\s>+~]+/)
      .filter(Boolean)
      .pop() ?? "";
  return {
    classes: new Set([...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]!)),
    tag: /^[a-z]+/.exec(last)?.[0] ?? null,
  };
}

/** Whether `base` styles every element `target` does, which makes it target's base rule. */
function alsoStyles(base: ReturnType<typeof subject>, target: ReturnType<typeof subject>): boolean {
  if (base.tag !== null && base.tag !== target.tag) return false;
  return [...base.classes].every((c) => target.classes.has(c));
}

/**
 * The filter that actually reaches a rule's element, base classes included.
 *
 * `image-rendering` is declared once on the base class and stays in force through every rule that
 * only changes the size. Reading it from the sizing rule's own body reported "smooth", which is safe
 * at any ratio, so the two cases above were waved through by the test written to catch them.
 */
function filterFor(target: Rule): string | null {
  let reaching: string | null = null;
  for (const other of RULES) {
    const declared = /image-rendering:\s*([\w-]+)/.exec(other.body)?.[1];
    if (declared === undefined) continue;
    if (other === target) return declared; // its own is the most specific
    if (alsoStyles(subject(other.selector), subject(target.selector))) reaching = declared;
  }
  return reaching;
}

const widthOf = (body: string) => /(?<![-\w])width:\s*(\d+)px/.exec(body)?.[1];

/** Rules that mark their element an image: a filter, a fit, or an `img` tag in the selector. */
const IMAGES = RULES.filter(
  (r) => /image-rendering:|object-fit:/.test(r.body) || subject(r.selector).tag === "img",
).map((r) => subject(r.selector));

/** Every rule that puts a px width on one of those. This is the list that must be accounted for. */
const SIZED = RULES.filter(
  (r) =>
    widthOf(r.body) !== undefined && IMAGES.some((image) => alsoStyles(image, subject(r.selector))),
);

describe("every rule that sizes an image is accounted for", () => {
  // The half that matters. A table you have to remember to extend is a table that gets forgotten,
  // and it was: neither of the two live cases was in it, so neither was ever checked.
  it("leaves no image-sizing rule out of both tables", () => {
    const loose = SIZED.map((r) => r.selector).filter(
      (selector) => !(selector in NATURAL) && !(selector in NOT_PIXEL_ART),
    );
    expect(
      loose,
      `sizes an image but names no natural size: ${loose.join(", ")}. Add it to NATURAL with the ` +
        `asset's own pixel size, or to NOT_PIXEL_ART with the reason it has none.`,
    ).toEqual([]);
  });

  it("finds a rule for everything the tables name, so a renamed class cannot silently pass", () => {
    const named = [...Object.keys(NATURAL), ...Object.keys(NOT_PIXEL_ART)];
    const missing = named.filter((selector) => !RULES.some((r) => r.selector === selector));
    expect(missing, `named here but not in globals.css: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("pixel art is only ever drawn at a whole-number ratio", () => {
  for (const [selector, natural] of Object.entries(NATURAL)) {
    it(`${selector} scales its ${natural}px source by a whole number`, () => {
      const target = RULES.find((r) => r.selector === selector);
      expect(target, `no rule for ${selector}`).toBeDefined();
      const width = widthOf(target!.body);
      expect(width, `${selector} declares no px width`).toBeDefined();
      if (filterFor(target!) !== "pixelated") return; // a smooth filter is safe at any ratio
      const box = Number(width);
      const ratio = box >= natural ? box / natural : natural / box;
      expect(
        Number.isInteger(ratio),
        `${selector} draws ${natural}px art in a ${box}px box (${ratio.toFixed(3)}x) with ` +
          `image-rendering: pixelated. Either land on a whole ratio or declare a smooth filter.`,
      ).toBe(true);
    });
  }
});

describe("the boss portrait sizes stay matched to the assets that exist", () => {
  const box = (selector: string) =>
    Number(widthOf(RULES.find((r) => r.selector === selector)!.body));

  it("draws Run Order's portrait smaller than the asset it is given", () => {
    // If the box ever grows past 80 this goes back to enlarging pixel art, and the fix is a
    // bigger asset from build_boss_portraits.py rather than a bigger number here.
    expect(box(".run-art")).toBeLessThanOrEqual(NATURAL[".run-art"]!);
  });

  it("draws the 26px portrait at its own size, and half it for the small one", () => {
    expect(box(".boss-portrait")).toBe(26);
    expect(box(".boss-portrait.is-small")).toBe(13);
  });
});
