import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

const page = read("app", "bosses", "drops", "page.tsx");
const settled = read("components", "settled-view.tsx");
const skeleton = read("components", "drop-log-skeleton.tsx");
const ledger = read("components", "settlement-ledger.tsx");
const runPlan = read("components", "run-plan.tsx");
const partyCard = read("components", "party-card.tsx");
const css = read("app", "globals.css");

/** The body of `name`, up to the next top-level `function`. */
function body(source: string, name: string): string {
  const at = source.indexOf(`function ${name}(`);
  expect(at, `${name} has been renamed`).toBeGreaterThan(-1);
  const next = source.indexOf("\nfunction ", at + 1);
  return source.slice(at, next === -1 ? undefined : next);
}

// One rule, in every list that leads with art: the art goes first and the chevron hangs off the
// NAME. It used to have a COLUMN at the row's left edge, held open even on rows with nothing to
// open, so a folding row and a plain one lined up. Measured against globals.css in headless
// chromium: 28px of that column in front of a 46px drop icon, a 32px ledger icon and a 40px boss
// portrait.
//
// A name is not a column, so there is nothing to reserve and nothing to align: a row that does not
// fold draws no chevron at all. In Run Order that also ends a raggedness, since a row with no config
// behind it never had the column and started its portrait 28px left of its neighbours'.
//
// The Settlement Ledger's `offsets` heading followed, though it leads with a count rather than art
// and so pushed nothing aside: standing one step left of every act it opens onto, it read as a
// second column down a card that no longer has one.
describe("a chevron hangs off the name in every list that leads with art", () => {
  const leadsWithArt = [
    ["the Drop Log's row", body(page, "DropRow"), "loot-icon"],
    ["the Settled View's row", body(settled, "SettledRow"), "loot-icon"],
    ["the Settlement Ledger's act", body(ledger, "DischargeRow"), "loot-icon"],
    ["a Run Order row", runPlan, "run-art"],
  ] as const;

  it.each(leadsWithArt)("%s draws its art before its chevron", (_what, source, art) => {
    const at = source.indexOf(art);
    const toggle = source.indexOf("party-row-toggle");
    expect(at, `${art} is gone`).toBeGreaterThan(-1);
    expect(toggle, "the chevron is gone").toBeGreaterThan(-1);
    expect(
      toggle,
      "the chevron is back in front of the art, which is the 28px gutter",
    ).toBeGreaterThan(at);
  });

  // A held-open frame is what the gutter WAS. One left behind is 28px of nothing at whichever end
  // it was left at, so no row that leads with art keeps one.
  it.each([
    ["the Drop Log's row", body(page, "DropRow")],
    ["the Settled View's row", body(settled, "SettledRow")],
    ["the skeleton's row", body(skeleton, "Row")],
    ["the Settlement Ledger's act", body(ledger, "DischargeRow")],
  ] as const)("%s reserves no frame", (_what, source) => {
    expect(source).not.toContain("party-row-toggle is-empty");
  });

  // The Drop Log pairs name and chevron in a wrapper, because its meta sits on a second line and the
  // title is a column. The one-line rows have no such column and put the chevron after the name
  // directly, so only the Drop Log's shape is pinned here.
  it.each([
    ["the Drop Log's row", body(page, "DropRow")],
    ["the Settled View's row", body(settled, "SettledRow")],
    ["a fold's character heading", body(page, "RunGroup")],
    ["the skeleton's row", body(skeleton, "Row")],
  ] as const)("%s pairs the name and the chevron in one line", (_what, source) => {
    expect(source).toContain("droplog-name-line");
  });

  // The name line sizes to its content. Left to stretch across the title's column it would put the
  // chevron out where the status chip begins, which is the gutter again, pointing the other way.
  it("sizes that line to its content", () => {
    const at = css.indexOf(".droplog-name-line {");
    expect(at, ".droplog-name-line is missing").toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf("}", at))).toMatch(/width:\s*max-content/);
  });

  // The ledger's date is drawn tight against its name on purpose (a -4px pull), so the chevron goes
  // after the pair rather than between them.
  it("keeps the Settlement Ledger's date against its name", () => {
    const discharge = body(ledger, "DischargeRow");
    expect(discharge.indexOf("ledger-when")).toBeLessThan(discharge.indexOf("party-row-toggle"));
    const at = css.indexOf(".ledger-drop-head.is-oneline .ledger-when {");
    expect(at, "the -4px pull is gone").toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf("}", at))).toMatch(/margin-left:\s*-4px/);
  });

  // The heading over the acts, which is the last chevron on this card that stood in front of its
  // row. It opens onto rows that carry theirs after the name, so in front it was a step out of line
  // with everything under it.
  it("puts the offsets heading's chevron after its count", () => {
    const at = ledger.indexOf('className="ledger-heading">Offsets<');
    expect(at, "the offsets step is gone").toBeGreaterThan(-1);
    // Up to the close of `.ledger-drop-head`, which is the first one after the marker.
    const head = ledger.slice(at, ledger.indexOf("</div>", at));
    expect(head).toContain("party-row-toggle");
    expect(head.indexOf("loot-name"), "the chevron is back in front of the count").toBeLessThan(
      head.indexOf("party-row-toggle"),
    );
  });

  // Not an app-wide move, and the exception is the point: a party row is a heading with no art in
  // front of it, so its chevron has nothing to push aside and stays where the eye starts, frame and
  // all. Pinned so the two conventions stay a decision rather than drift.
  it("leaves the chevron in front of a party row, which has no art to lead with", () => {
    const toggle = partyCard.indexOf("party-row-toggle");
    const heading = partyCard.indexOf("party-row-heading");
    expect(toggle, "party-row-toggle is gone from party-card").toBeGreaterThan(-1);
    expect(heading, "party-row-heading is gone from party-card").toBeGreaterThan(-1);
    expect(toggle).toBeLessThan(heading);
    expect(partyCard).toContain("party-row-toggle is-empty");
  });
});
