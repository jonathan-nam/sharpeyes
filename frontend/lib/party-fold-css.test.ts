import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// Things fold in eight places and share one chevron class. The rotation used to be a list of the
// rows that carry an is-open CLASS: .party-row, .droplog-row, .droplog-character, a Run Order table
// row. A list is a thing to be left out of, and the Settlement Ledger's three toggles were left out
// of it, so `Owed` opened with its arrow still pointing at a closed panel.
//
// It comes off the BUTTON's own aria-expanded now, which every toggle in the app sets from the state
// it folds on, so the class is closed rather than opt-in: there is no list to add a new fold to.
describe("a folding control turns its chevron", () => {
  it("rotates it off the state the button already publishes", () => {
    const at = css.indexOf(".party-row-chevron {");
    expect(at, ".party-row-chevron is missing").toBeGreaterThan(-1);
    expect(css.slice(at)).toMatch(/\.party-row-toggle\[aria-expanded="true"\] \.party-row-chevron/);
  });

  it("is the only rule that turns one, so no fold can be left out", () => {
    // Two mentions in the whole sheet: the chevron itself, and the one thing that turns it. A third
    // is the per-row-type list growing back, which is what let a fold be forgotten.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(bare.match(/\.party-row-chevron/g)).toHaveLength(2);
    expect(bare).not.toMatch(/\.is-open[^{]*\.party-row-chevron/);
  });

  // The Drop Log nests one fold inside another, so a descendant selector on the outer row reached
  // the inner rows' chevrons: opening a drop turned every closed character arrow with it. Scoped to
  // the toggle, that cannot happen again, an inner chevron sitting in no outer button.
  it("turns only its own, where one fold sits inside another", () => {
    const at = css.indexOf(".party-row-chevron {");
    expect(css.slice(at)).not.toMatch(/\.droplog-row\.is-open \.party-row-chevron/);
  });
});
