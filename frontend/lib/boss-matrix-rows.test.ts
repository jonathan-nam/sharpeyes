import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

const rule = (selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

/**
 * What the split cost, and the only thing holding it together.
 *
 * The boss names are in a gutter beside the scrolling box now (see boss-matrix-sticky.test.ts for
 * why), so a row's height no longer follows from the names and the marks sharing a <tr>. It is
 * declared instead, on both sides, and if the two ever disagree the names slide out of step with
 * the marks they label. That is a silent wrong answer of the kind this repo exists to prevent: the
 * table would still read as a table, with every tick against the wrong boss.
 *
 * Measured in Chromium against the real stylesheet at five window widths and three scroll offsets
 * each, matched row by row: 17 rows, 0 misaligned, tolerance 0.02px, and topDelta 0 on all three
 * pinned pairs. Nothing in a browser checks it, so the four numbers and their reach are pinned
 * here.
 *
 * The 0.5px this replaced is worth recording, because it came back the moment the shapes differed:
 * as one table with a <thead> the gutter collapsed the border between head and body that the marks
 * pay twice, and every row sat half a pixel high. Hence the gutter's head is its own box.
 */
describe("the gutter and the marks keep step", () => {
  const HEIGHTS = [
    ["--boss-head-h", 148],
    ["--boss-band-h", 26],
    ["--boss-row-h", 37],
    ["--boss-progress-h", 30],
  ] as const;

  it("declares all four row heights in one place, above both tables", () => {
    const declared = rule(".boss-matrix-wrap");
    for (const [name, px] of HEIGHTS) {
      const found = declared.match(new RegExp(`${name}:\\s*(\\d+)px`));
      expect(found, `${name} is not declared on .boss-matrix-wrap`).not.toBeNull();
      expect(Number((found as RegExpMatchArray)[1]), `${name} moved`).toBe(px);
    }
  });

  it("applies each of them to a row, so neither side's content decides a height", () => {
    // On `.boss-table`, which both the gutter and the marks carry: one rule, both sides.
    expect(rule(".boss-table thead tr")).toMatch(/height:\s*var\(--boss-head-h\)/);
    expect(rule(".boss-table .boss-cadence-row")).toMatch(/height:\s*var\(--boss-band-h\)/);
    expect(rule(".boss-table tbody tr:not(.boss-cadence-row):not(.boss-progress-row)")).toMatch(
      /height:\s*var\(--boss-row-h\)/,
    );
    expect(rule(".boss-table .boss-progress-row")).toMatch(/height:\s*var\(--boss-progress-h\)/);
  });

  /**
   * A declared height on a table row is a MINIMUM, so it is only shared if it is the taller of the
   * two sides. The band row is the one that proved it: the label's line box comes to 25.5, so at
   * --boss-band-h: 25px the declaration lost on the gutter side only and every row below it sat
   * half a pixel low.
   */
  it("keeps the band row above the line box it has to hold", () => {
    const band = Number(
      (rule(".boss-matrix-wrap").match(/--boss-band-h:\s*(\d+)px/) as RegExpMatchArray)[1],
    );
    expect(band, "the band row is back under the 25.5px its own label measures").toBeGreaterThan(
      25.5,
    );
  });

  it("keeps the boss row above the portrait it has to hold", () => {
    // 26px of art plus .boss-name's 5px either side, and the 1px rule between rows.
    const row = Number(
      (rule(".boss-matrix-wrap").match(/--boss-row-h:\s*(\d+)px/) as RegExpMatchArray)[1],
    );
    const portrait = Number(
      (rule(".boss-portrait").match(/height:\s*(\d+)px/) as RegExpMatchArray)[1],
    );
    expect(row).toBeGreaterThanOrEqual(portrait + 10);
  });

  it("gives the gutter's head a box of its own, so the two sides collapse borders alike", () => {
    // As one table with a thead the gutter was half a pixel out. See the note above.
    expect(rule(".boss-matrix-gutter-head")).toMatch(/position:\s*sticky/);
    expect(rule(".boss-matrix-gutter-head")).toMatch(/top:\s*0/);
  });

  it("sizes the gutter from the names' own width, so the column cannot drift from its box", () => {
    expect(rule(".boss-matrix-gutter")).toMatch(/width:\s*var\(--boss-name-col\)/);
    expect(rule(".boss-table.is-gutter")).toMatch(/width:\s*100%/);
  });

  /**
   * The marks' width no longer subtracts the names, because the names are not in that table: the
   * pane is already the width the marks have. Getting this wrong is not subtle (the fifth
   * character lands off screen), but it is the one number the split changed.
   */
  it("measures the marks against their pane, not against the page column", () => {
    const declared = rule(".boss-table.is-marks");
    expect(declared).toMatch(/calc\(100% \* var\(--boss-span, 1\)\)/);
    expect(declared).toMatch(/calc\(var\(--boss-char-min\) \* var\(--boss-cols, 1\)\)/);
    expect(declared, "the marks still subtract a name column they no longer hold").not.toContain(
      "--boss-name-col",
    );
  });
});
