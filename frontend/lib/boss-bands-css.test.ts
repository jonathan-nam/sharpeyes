import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

const rule = (selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

// Shared by both head cells; the corner one adds to the bottom of it. See below.
const BASE_CELL_PADDING = 6;

/**
 * The band figures sit in the corner of the column heads, and they are meant to read as level with
 * the character art beside them. That cell is a sprite with an IGN under it, so centring in the
 * whole of it lands them half a line low and hard against the rule at the bottom of the row, which
 * is what this replaced. The extra bottom padding is that line, lifting the centre onto the art.
 *
 * Measured in Chromium against the real stylesheet: sprite centre 63.0, bands centre 62.8.
 * Nothing in a browser checks it and being a few px out is not a bug anyone files, so the two
 * things that would undo it are pinned instead: the alignment, and the padding that corrects it.
 */
describe("the band figures in the corner cell", () => {
  it("centres rather than sitting on the bottom rule", () => {
    expect(rule(".boss-col-head")).toMatch(/vertical-align:\s*middle/);
  });

  it("pads the bottom past the shared cell padding, to lift the centre onto the sprite", () => {
    const found = rule(".boss-col-head").match(/padding-bottom:\s*(\d+)px/);
    expect(found, ".boss-col-head has no padding-bottom to correct the centring").not.toBeNull();
    expect(Number((found as RegExpMatchArray)[1])).toBeGreaterThan(BASE_CELL_PADDING);
  });
});

/**
 * A 1/49 band drew as a lone dot: the fill came out 4px wide on a 198px track, and at 6px tall with
 * a 4px radius that is a circle, sitting on a track of --surface-2 that is 15/255 off the page
 * behind it. Two things fixed it and neither shows up in a test that does not look at the CSS.
 */
describe("a band bar with very little in it", () => {
  it("draws its track as a rule that can be seen, not as a field", () => {
    // --surface-2 is the app's filled-block colour, which is what it was and what made the track
    // disappear. Any of the --line tokens is a rule; this only refuses the field.
    expect(rule(".boss-progress-bar")).not.toMatch(/background:\s*var\(--surface-2\)/);
  });

  it("floors the fill past its own height, so a small one is not a circle", () => {
    const found = rule(".boss-progress-bar > span.is-nonzero").match(/min-width:\s*(\d+)px/);
    expect(found, "the fill has no floor, so one clear in fifty draws as a dot").not.toBeNull();
    const height = rule(".boss-progress-bar").match(/height:\s*(\d+)px/);
    expect(Number((found as RegExpMatchArray)[1])).toBeGreaterThan(
      Number((height as RegExpMatchArray)[1]),
    );
  });

  // The floor overstates the fill, so it may only ever reach a fill that is already non-zero. On
  // `> span` it would paint 6% of the track for a band with no clears at all; bandFill is the other
  // half of this pair.
  it("keeps the floor off every fill but the non-zero one", () => {
    expect(rule(".boss-progress-bar > span")).not.toMatch(/min-width/);
  });
});
