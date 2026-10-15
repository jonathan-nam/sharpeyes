import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

// The matrix draws its four states as marks with no fills, so three of them are glyphs and the
// fourth is the gap between them. That only works while the glyphs are visible: make the dash
// transparent and "no capture" becomes an empty cell, which is "not cleared" as far as anyone
// reading the table can tell. Nothing errors when it happens, the table just starts answering a
// question it was not asked, which is the failure this project exists to prevent.
describe("boss clear marks stay visible", () => {
  it("gives the three marked states a colour and leaves only not-cleared blank", () => {
    expect(rule(".boss-cell.is-cleared")).toMatch(/color:\s*var\(--ink\)/);
    expect(rule(".boss-cell.is-unseen")).toMatch(/color:\s*var\(--muted-2\)/);
    expect(rule(".boss-cell.is-skipped")).toMatch(/color:\s*var\(--muted-2\)/);
    expect(rule(".boss-cell.is-pending")).toMatch(/color:\s*transparent/);
  });

  it("lets the mark's colour through the button the live view wraps it in", () => {
    // The three colours above are set on the cell, and a button does not inherit colour on its
    // own: the UA sets its own. Drop `color: inherit` and every mark on the editable matrix goes
    // to the button's default, which takes the dash and the tick to the same shade and collapses
    // "no capture" into "not cleared" on the one view where they can be told apart.
    expect(rule(".boss-mark")).toMatch(/color:\s*inherit/);
  });

  it("holds the not-cleared cell open, since its mark is the absence of one", () => {
    // The button's only visible child is the glyph, and not-cleared has none, so without a height
    // the cell collapses to its padding and that row's gap stops lining up with the marks it is
    // read against.
    expect(rule(".boss-mark")).toMatch(/min-height:/);
  });

  it("keeps the per-character count readable, since the bar does not repeat it", () => {
    // The band's bar is drawn once, at the top. Every character's own progress is the figure in
    // this cell and nothing else, so dimming it to the background takes the column's answer away
    // with nothing left standing in for it.
    expect(rule(".boss-progress-cell")).toMatch(/color:\s*var\(--ink\)/);
  });

  it("does not fill the cells, so the state is the mark and not the background", () => {
    // Colouring the cells was tried twice and taken back out: the fill landed in the same channel
    // as the row striping below, and read as shading rather than as a state.
    for (const state of ["is-cleared", "is-pending", "is-unseen", "is-skipped"]) {
      expect(rule(`.boss-cell.${state}`)).not.toMatch(/background/);
    }
  });
});

// A finished character's column head steps back the way a finished row does. The pairing is what
// the test is for: the class is written in one file and read in another, so a rename in either
// leaves a sprite that never dims and nothing that fails.
describe("a finished character's head dims", () => {
  const matrix = readFileSync(join(__dirname, "..", "components", "boss-matrix.tsx"), "utf8");

  it("styles the class the matrix writes", () => {
    expect(matrix).toContain("is-col-cleared");
    expect(rule(".boss-table .boss-char-head.is-col-cleared")).toMatch(/opacity:\s*0\.5/);
  });

  it("starts the IGN at full text colour, so the dim is the only grey", () => {
    // The head dims by opacity alone, so a name that begins at --muted gives the cleared and
    // uncleared columns two shades of grey to be told apart by instead of a state.
    expect(matrix).toContain("boss-char-name");
    expect(rule(".boss-char-name")).toMatch(/color:\s*var\(--ink\)/);
  });

  it("desaturates the sprite, the two numbers a finished row's portrait uses", () => {
    // Opacity is shared with the IGN and floored at 0.5 by the test below, so the sprite's own
    // colour is the only channel left to take a finished character further back.
    // The row's rule is a group, so read it by the selector the brace actually follows.
    expect(rule(".boss-table tr.is-row-unrun .boss-portrait")).toMatch(/saturate\(0\.3\)/);
    expect(rule(".boss-table .boss-char-head.is-col-cleared .boss-char-sprite")).toMatch(
      /saturate\(0\.3\)/,
    );
  });

  it("dims rather than hides, since the column still has to be read", () => {
    // The sprite and the IGN are what says whose column this is, and the marks under a dimmed head
    // are still marks to read. Taken much further this is a column that has left the table.
    const opacity = Number(
      /opacity:\s*([\d.]+)/.exec(rule(".boss-table .boss-char-head.is-col-cleared"))?.[1],
    );
    expect(opacity).toBeGreaterThanOrEqual(0.5);
    expect(opacity).toBeLessThan(1);
  });

  it("comes back under the cursor, as the /inventory tile does", () => {
    expect(rule(".boss-table .boss-char-head.is-col-cleared.is-col-hover")).toMatch(/opacity:\s*1/);
    expect(
      rule(".boss-table .boss-char-head.is-col-cleared.is-col-hover .boss-char-sprite"),
    ).toMatch(/filter:\s*none/);
    expect(rule(".char-tile:hover")).toMatch(/opacity:\s*1/);
  });
});

describe("a filtered-out cell", () => {
  const grey = (token: string) => {
    const hex = css.match(new RegExp(`--${token}:\\s*#([0-9a-f]+);`))?.[1] ?? "";
    expect(hex, `--${token} is missing`).not.toBe("");
    return parseInt(hex.length === 3 ? hex[0]!.repeat(2) : hex.slice(0, 2), 16);
  };

  it("fades a left-out tick well below the quietest live mark", () => {
    // Nearer the background than halfway to a live dash, so the two cannot be mistaken.
    const opacity = Number(
      rule(".boss-cell.is-filtered-out > span").match(/opacity:\s*([\d.]+)/)?.[1],
    );
    const bg = grey("bg");
    const fadedTick = bg + opacity * (grey("ink") - bg);
    expect(fadedTick).toBeLessThan((bg + grey("muted-2")) / 2);
  });
});
