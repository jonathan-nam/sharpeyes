import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

function rule(selector: string): string {
  const m = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1] ?? "";
}

function num(selector: string, prop: RegExp): number {
  const found = rule(selector).match(prop)?.[1];
  if (found === undefined) throw new Error(`no ${prop} in ${selector}`);
  return Number(found);
}

const basis = (selector: string) => num(selector, /flex:\s*\d\s+1\s+(\d+)px/);

/**
 * What one of these cards actually has to lay out in, measured rather than derived: --measure, less
 * .page's 2rem either side, less .add-card's 14px either side, less a scrollbar. The scrollbar is
 * the part arithmetic misses and both these pages have one, which is the difference between the
 * 702px this test first assumed and the 685px Chrome reports.
 */
const SCROLLBAR = 17;
const INNER = Number(css.match(/--measure:\s*(\d+)px/)?.[1]) - SCROLLBAR - 2 * 32 - 2 * 14;

/** Every gap between boxes, plus the + itself, which never shrinks. */
function overhead(fields: number): number {
  return num(".add-plus", /width:\s*(\d+)px/) + fields * num(".add-fields", /gap:\s*(\d+)px/);
}

// Add Party's row shipped wrapping its + onto a line of its own, where a + names nothing. The cause
// is not obvious from the markup: a wrapping flex row breaks lines at each item's BASE size and
// only shrinks what already sits on a line, so flex-shrink cannot rescue a row that does not fit,
// and a basis of auto makes a <select> as wide as its longest option. Ours was 26 characters
// ("every boss is on this week"), which overflowed the card at the page's own width.
//
// Nothing either component can assert about itself, and the failure is invisible until somebody
// adds a longer boss to catalog/bosses.yaml. So the numbers are pinned here.
describe("the add row", () => {
  it("gives every field an explicit flex-basis, so the catalog cannot set the layout", () => {
    // A bare `flex: 1 1 auto` or no flex at all is the bug coming back.
    expect(rule(".add-field")).toMatch(/flex:\s*1\s+1\s+\d+px/);
    expect(rule(".add-field.is-wide")).toMatch(/flex:\s*2\s+1\s+\d+px/);
    expect(rule(".add-field.is-narrow")).toMatch(/flex:\s*0\s+1\s+\d+px/);
    expect(rule(".add-field.is-drop")).toMatch(/flex:\s*0\s+1\s+\d+px/);
    // The Sale Ledger's three: a fate phrase, a box whose answers are a closed vocabulary, and a
    // price. A growing price box was the only field left on a card that asks nothing else, and it
    // ran the width of the card, so the 0 here is the fix rather than a preference.
    expect(rule(".add-field.is-fate")).toMatch(/flex:\s*0\s+1\s+\d+px/);
    expect(rule(".add-field.is-pick")).toMatch(/flex:\s*0\s+1\s+\d+px/);
    expect(rule(".add-field.is-price")).toMatch(/flex:\s*0\s+1\s+\d+px/);
  });

  it("lets a field shrink, which min-width:auto otherwise forbids", () => {
    expect(rule(".add-field")).toMatch(/min-width:\s*0/);
    expect(rule(".add-field .split-input")).toMatch(/min-width:\s*0/);
  });

  it("keeps the + out of the wrap, so it is never the thing left alone on a line", () => {
    expect(rule(".add-fields .add-plus")).toMatch(/flex:\s*none/);
  });

  it("holds every box in the row to one height, which a select and an input do not agree on", () => {
    const box = num(".add-field .split-input", /height:\s*(\d+)px/);
    expect(box).toBe(num(".add-plus", /height:\s*(\d+)px/));
    expect(box).toBe(num(".add-plus", /width:\s*(\d+)px/));
    // The drop picker carries a min-height of its own, measured to stop it growing when an icon
    // appears. Left standing it would win over the line above and the picker would sit 1px short.
    expect(rule(".add-field .drop-select")).toMatch(/min-height:\s*0/);
  });

  // Character, Boss, Difficulty, Member.
  it("fits Add Party's four boxes and the + across the page", () => {
    const total = 2 * basis(".add-field") + 2 * basis(".add-field.is-wide") + overhead(4);
    expect(total).toBeLessThanOrEqual(INNER);
  });

  // Character, Boss, Drop, How many. The drop picker is the wide one here, and it is sized by the
  // floor that keeps its popup list readable rather than by a basis we chose.
  it("fits the Drop Log's four boxes and the + across the page", () => {
    const total =
      2 * basis(".add-field") +
      basis(".add-field.is-drop") +
      basis(".add-field.is-narrow") +
      overhead(4);
    expect(total).toBeLessThanOrEqual(INNER);
  });
  // The Sale Ledger's widest: Pieces, What happened, Sale Amount. Its submit is a word rather than
  // the +, so the button is not counted from .add-plus; 90px is more than "Add" has ever measured.
  it("fits the coupon pile's boxes across the page", () => {
    const total =
      basis(".add-field.is-narrow") +
      basis(".add-field.is-fate") +
      basis(".add-field.is-price") +
      90 +
      3 * num(".add-fields", /gap:\s*(\d+)px/);
    expect(total).toBeLessThanOrEqual(INNER);
  });
});
