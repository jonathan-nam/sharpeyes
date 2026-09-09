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
 * The block for a selector that carries `needle`, not the first block that happens to share the
 * selector. `.boss-col-head, .boss-name` has two: one sets box-sizing and width, the other the
 * background, and indexOf finds the wrong one.
 */
const ruleWith = (selector: string, needle: string): string => {
  let at = css.indexOf(`\n${selector} {`);
  while (at > -1) {
    const body = css.slice(at, css.indexOf("}", at));
    if (body.includes(needle)) return body;
    at = css.indexOf(`\n${selector} {`, at + 1);
  }
  // Thrown rather than expect.fail, which is not typed as `never` and leaves this `string |
  // undefined` for every caller.
  throw new Error(`no rule for ${selector} containing "${needle}"`);
};

/**
 * The matrix scrolls sideways inside itself so that a wide roster cannot stretch the page. The
 * .visually-hidden label in every cell is absolutely positioned, and with nothing positioned
 * between it and the page its containing block WAS the page: it laid out at its static position
 * out in the part of the table that is scrolled away, and the document grew to reach it. Measured
 * at 1024px on a roster of six, the page could scroll 121px into an empty strip.
 */
describe("the matrix keeps its sideways scroll to itself", () => {
  it("gives the scrollport a containing block, so the cells' hidden labels are clipped with it", () => {
    const declared = rule(".boss-matrix");
    expect(declared).toMatch(/overflow-x:\s*auto/);
    expect(declared, ".boss-matrix clips overflow but is not a containing block").toMatch(
      /position:\s*(relative|sticky|absolute|fixed)/,
    );
  });

  it("does the same for the run plan's grid, which carries the same labels", () => {
    const declared = rule(".run-grid");
    expect(declared).toMatch(/overflow-x:\s*auto/);
    expect(declared).toMatch(/position:\s*(relative|sticky|absolute|fixed)/);
  });

  it("is fixing an out-of-flow label, not a wide one", () => {
    expect(rule(".visually-hidden")).toMatch(/position:\s*absolute/);
    expect(rule(".visually-hidden")).toMatch(/width:\s*1px/);
  });

  it("keeps the pane able to shrink, so a wide roster still cannot stretch the page", () => {
    // A flex item's min-width is auto, which is its content, and its content is a table as wide as
    // the roster. Without this the pane refuses to shrink and pushes the page sideways instead of
    // scrolling. Same trap as the character tiles.
    expect(rule(".boss-matrix-panes")).toMatch(/min-width:\s*0/);
  });
});

/**
 * The boss names sit in a gutter BESIDE the scrolling box, not pinned inside it.
 *
 * Sticky was tried three ways and lost every time: on its own, then with z-index, then with a 3px
 * background skirt. A sticky cell and the content scrolling under it are separate composited
 * layers, so which one wins is the compositor's to decide, not ours. Measured at six characters and
 * 290px of scroll, the first character's tick sits 1.95px beneath the pinned cell, and it was
 * reported showing through as pale dots down the left of the boss art, one per row.
 *
 * Out of the scrollport there is nothing behind the names at all. That is a fact about the boxes
 * rather than about paint, which is why it is the only version of this fix that could be verified
 * here: measured, the scroller's clip begins exactly where the gutter ends, at every window width.
 */
describe("the boss names are outside the scrolling box", () => {
  it("does not pin them, because there is nothing left to pin them in front of", () => {
    const declared = ruleWith(".boss-col-head,\n.boss-name", "background");
    expect(declared, "the names are sticky again, which is what kept leaking").not.toMatch(
      /position:\s*sticky/,
    );
    // The skirt was the last of the three paint-order fixes. It painted outside the cell, where
    // the scrollport clips it, so it never covered the 2px inside the cell that actually leaked.
    expect(
      declared,
      "the skirt is back, and it was aimed at the wrong side of the clip",
    ).not.toMatch(/box-shadow/);
  });

  it("still paints them opaque, since the gutter sits on the page and not on the row", () => {
    expect(ruleWith(".boss-col-head,\n.boss-name", "background")).toMatch(
      /background:\s*var\(--boss-row-bg, var\(--bg\)\)/,
    );
  });

  it("puts the gutter beside the scroller in the markup, not inside it", () => {
    // The guarantee is structural, so it has to be visible in the structure: the gutter is a
    // sibling of the panes, and the marks table carries no name cells.
    expect(matrix).toContain('<div className="boss-matrix-split"> {gutter}');
    expect(matrix).toContain('<div className="boss-matrix-panes">');
    const marks = matrix.slice(matrix.indexOf('className="boss-matrix-panes"'));
    expect(marks, "a name cell is still in the scrolling table").not.toContain(
      'className="boss-name" scope="row"',
    );
  });

  it("draws the row band from state, since two tables cannot share a :hover", () => {
    expect(
      rule(
        ".boss-table tbody tr.is-row-hover,\n.boss-table .boss-cell.is-col-hover,\n.boss-table .boss-progress-cell.is-col-hover,\n.boss-table .boss-char-head.is-col-hover",
      ),
    ).toMatch(/background:\s*color-mix/);
    expect(matrix).toContain("setHoveredRow");
    // Cleared with the column, or the band stays lit on whichever row the cursor left by.
    expect(matrix).toContain("setHoveredRow(null)");
  });
});
