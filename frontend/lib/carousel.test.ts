import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TILES_SHOWN } from "./carousel";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// The strip's cap is a width in CSS, the placeholders' is a count in TS, and nothing at runtime
// compares them. Move one and the loading strip is a tile wider than the strip that replaces it,
// which is the jump the skeletons exist to prevent.
describe("how many sprites a strip shows", () => {
  it("is the same number in the CSS share and in TILES_SHOWN", () => {
    // Both tile classes the track holds: the character strips and the people board's lanes. Sized
    // by one rule, so a lane cannot come to show a different number from a carousel.
    expect(css, "the people board's cards share the strip's rule").toContain(
      ".carousel-track .char-tile,\n.carousel-track .roster-tile {",
    );
    const share = css.match(
      /\.carousel-track \.char-tile,\n\.carousel-track \.roster-tile \{[^}]*flex: 0 0 max\(calc\(\(100% - (\d+) \* 16px\) \/ (\d+)\), (\d+)px\)/,
    );
    expect(share?.[2], "tiles across the strip").toBe(String(TILES_SHOWN));
    // One gap fewer than tiles, or the shares do not add up to the width they divide.
    expect(share?.[1], "gaps between them").toBe(String(TILES_SHOWN - 1));
  });

  // A narrow window shows fewer tiles rather than overlapping the sprites, so the floor must hold
  // the 96px sprite and the tile's padding either side.
  it("never shrinks a tile below its sprite", () => {
    const floor = css.match(/flex: 0 0 max\(calc\([^)]*\) \/ \d+\), (\d+)px\)/)?.[1];
    const sprite = css.match(/\.tile-sprite \{[^}]*width: (\d+)px/)?.[1];
    const padding = css.match(/\n\.char-tile \{[^}]*padding: (\d+)px/)?.[1];
    expect(Number(floor)).toBeGreaterThanOrEqual(Number(sprite) + 2 * Number(padding));
  });
});
