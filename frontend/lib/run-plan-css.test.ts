import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
const runPlan = readFileSync(join(__dirname, "..", "components", "run-plan.tsx"), "utf8");

// The per-row time column is gone: the clock is a rule across the table every half hour, so no row
// draws a time and nothing has to reserve the width of one. What is left to pin is that the rule
// reads as a gridline rather than as another row of the plan.
describe("the half-hour rule", () => {
  const rule = () => {
    const at = css.indexOf(".run-tick td {");
    expect(at, ".run-tick td is missing").toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  it("draws a solid line, where a wait row draws a dashed one", () => {
    expect(rule()).toMatch(/border-top:\s*1px solid/);
    const wait = css.indexOf(".run-wait td {");
    expect(css.slice(wait, css.indexOf("}", wait))).toMatch(/border-top:\s*1px dashed/);
  });

  it("lines the times up, being a column of numbers", () => {
    const at = css.indexOf(".run-tick-at {");
    expect(at, ".run-tick-at is missing").toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf("}", at))).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("takes no hover, being a rule and not a row you can read across", () => {
    expect(css).toMatch(/\.run-tick:hover\s*\{[^}]*background:\s*none/);
  });

  it("keeps no width reserved for a time on the row", () => {
    expect(css).not.toMatch(/\.run-time\s*\{/);
  });
});

// A wait row sits between two runs, and now a rule row does too, so :nth-child banding counts both
// and inverts the stripes under every gap. The component bands from the row's own index instead,
// which only works if the CSS is asking for the class rather than the position.
describe("the plan's banding", () => {
  it("bands on a class, not on where the row happens to sit", () => {
    expect(css).toMatch(/\.run-table tbody tr\.is-banded/);
    expect(css).not.toMatch(/\.run-table tbody tr:nth-child/);
  });
});

// Answering for a run from the order: the clear pill in a column of its own, the drop picker on a
// row across the table. Both borrow Party View's chrome on purpose, so the two screens cannot end
// up drawing the same three states differently.
describe("answering for a run", () => {
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, `${selector} is missing`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  it("gives the clear a column no wider than its head", () => {
    expect(rule(".run-clear-head,\n.run-clear-cell")).toMatch(/width:\s*1%/);
    expect(rule(".run-clear-head,\n.run-clear-cell")).toMatch(/white-space:\s*nowrap/);
  });

  // The whole point of the mark: done is the tick, still-to-do is the gap. Hiding the glyph with
  // `display: none` or a conditional render instead would shrink the button to nothing, so the
  // column would change width as runs are ticked off and the click target would move.
  it("holds the tick's width when a run is not cleared", () => {
    expect(rule(".run-mark")).toMatch(/color:\s*transparent/);
    expect(rule(".run-mark.is-cleared")).toMatch(/color:\s*var\(--ink-strong\)/);
  });

  it("shows the empty cell is a control when it is pointed at", () => {
    expect(rule(".run-mark:not(.is-cleared):hover")).toMatch(/color:/);
  });

  // Party View's three-word pill is what this column replaced. It must not come back here: with
  // the not-cleared filter on, every row would carry the same word.
  it("does not put the worded pill back in the run table", () => {
    expect(css).not.toMatch(/\.run-clear-cell \.party-clear/);
  });

  // The rotation is what says the chevron did something. It used to be a per-row-type selector list
  // and a run's row had to be in it; it comes off the toggle's own aria-expanded now, which this row
  // sets like every other, so there is no list left to be left out of. See party-fold-css.
  it("turns the chevron on an open run", () => {
    expect(runPlan).toMatch(/className="party-row-toggle"\s*\n\s*aria-expanded=\{open\}/);
    expect(css).toMatch(/\.party-row-toggle\[aria-expanded="true"\] \.party-row-chevron/);
  });

  it("recedes a done run without greying who ran it", () => {
    expect(css).toMatch(/\.run-table tbody tr\.is-done \.run-boss-name/);
    expect(css).not.toMatch(/\.run-table tbody tr\.is-done \.run-cell/);
  });

  it("takes no hover on the picker's row, which is not a run", () => {
    expect(css).toMatch(/\.run-panel:hover\s*\{[^}]*background:\s*none/);
  });
});

// A plan tab carries two numbers, so a row of them that cannot wrap breaks the labels instead and
// each chip grows a second line. Measured at 420px with four tabs: 38px tall chips on one row
// before, 23px tall chips over two rows after.
describe("the plan tabs", () => {
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, `${selector} is missing`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  it("wraps between tabs", () => {
    expect(rule(".basis-row")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("never wraps inside one", () => {
    expect(rule(".basis-tab")).toMatch(/white-space:\s*nowrap/);
  });

  it("leaves the copy button where the markup puts it, at the start of the line", () => {
    expect(css).not.toMatch(/\.night-plan-copy \.copy-amount\s*\{[^}]*margin-left:\s*auto/);
  });

  // A row put the tabs beside the button while there was space for them and under it once there
  // was not, so the button moved with the tab count. It sits above them either way now.
  it("keeps the copy button on a line of its own above them", () => {
    expect(rule(".night-plan-copy")).toMatch(/flex-direction:\s*column/);
  });
});
