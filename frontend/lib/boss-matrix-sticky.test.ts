import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
const matrix = readFileSync(join(__dirname, "..", "components", "boss-matrix.tsx"), "utf8").replace(
  /\s+/g,
  " ",
);

const rule = (selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

/**
 * The matrix scrolls sideways inside itself so that a wide roster cannot stretch the page. Two
 * things defeated that, and both looked like the same bug from the outside.
 *
 * The .visually-hidden label in every cell is absolutely positioned, and with nothing positioned
 * between it and the page its containing block was the page: it laid out at its static position
 * OUT in the part of the table that is scrolled away, and the document grew to fit it. Measured at
 * 1024px on a roster of six, the page could scroll 125px into an empty strip. Scrolling it moved
 * the whole page, and the name column is pinned to the matrix rather than to the window, so the
 * names left the screen and the marks they had been painted over appeared beside them. It was
 * reported as the names not being pinned and as residual text under the bands.
 */
describe("the matrix keeps its sideways scroll to itself", () => {
  it("gives the scrollport a containing block, so the cells' hidden labels are clipped with it", () => {
    const declared = rule(".boss-matrix");
    expect(declared).toMatch(/overflow-x:\s*auto/);
    // Any `position` but static will do it. The point is that SOMETHING between the labels and the
    // page establishes a containing block inside the clip.
    expect(declared, ".boss-matrix clips overflow but is not a containing block").toMatch(
      /position:\s*(relative|sticky|absolute|fixed)/,
    );
  });

  it("does the same for the run plan's grid, which carries the same labels", () => {
    const declared = rule(".run-grid");
    expect(declared).toMatch(/overflow-x:\s*auto/);
    expect(declared).toMatch(/position:\s*(relative|sticky|absolute|fixed)/);
  });

  // The premise of both. If the utility ever stops being out-of-flow the rules above are merely
  // harmless, but this is the line that says why they exist.
  it("is fixing an out-of-flow label, not a wide one", () => {
    expect(rule(".visually-hidden")).toMatch(/position:\s*absolute/);
    expect(rule(".visually-hidden")).toMatch(/width:\s*1px/);
  });
});

/**
 * The cadence heading labels the rows under it, so it has to still be on screen while they are.
 * Its cell spans every column, which means the cell is already at the left edge and has nothing to
 * stick to: the label inside it is what sticks. Without this, scrolling to the fifth character left
 * seventeen rows under a heading that was off the left of the scrollport.
 */
describe("the cadence heading stays with its rows", () => {
  it("pins the label rather than the cell", () => {
    expect(rule(".boss-cadence-label")).toMatch(/position:\s*sticky/);
  });

  it("pins it at the cell's own left padding, so it does not jump when it sticks", () => {
    // At left:0 the word sits at 8px until it sticks and then snaps to the table's edge. Matching
    // the padding means the sticky position IS the resting one, so it never moves at all.
    const padding = rule(".boss-cadence").match(/padding:\s*\d+px\s+(\d+)px/);
    expect(padding, ".boss-cadence has no horizontal padding to match").not.toBeNull();
    const left = rule(".boss-cadence-label").match(/left:\s*(\d+)px/);
    expect(left, ".boss-cadence-label is sticky with no left offset to stick at").not.toBeNull();
    expect(Number((left as RegExpMatchArray)[1])).toBe(Number((padding as RegExpMatchArray)[1]));
  });

  it("keeps the span the pin hangs on", () => {
    // Sticky on the <th> would do nothing: it spans the table, so it is never scrolled past.
    expect(matrix).toContain('<span className="boss-cadence-label">{cadenceLabel(cadence)}</span>');
  });
});
