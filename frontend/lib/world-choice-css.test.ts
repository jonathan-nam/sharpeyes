import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

/** The declarations of one rule, by selector. */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

// One card per world, all four seen at once, so the choice is a comparison rather than a question
// with an unseen alternative. A rule that let one card grow would break the row on the one screen a
// new account cannot get past.
describe("the world cards are one row", () => {
  it("gives them a column each", () => {
    expect(rule(".world-choice-cards")).toMatch(/grid-template-columns:\s*repeat\(4,\s*1fr\)/);
  });

  // A grid item's automatic minimum is its content, not its 1fr share, so a long world name would
  // push its own track wider and take the other card's width. This is the same defeat that leaked a
  // fifth tile into the four-wide sprite strip, and a cap on the card cannot fix it: the minimum
  // has to be lifted first.
  it("holds a card to its share of the track", () => {
    expect(rule(".world-choice-card")).toMatch(/min-width:\s*0/);
  });

  // Wrapping is for where four will not fit, and nowhere else. Written as a max-width query, so
  // widening the breakpoint is a deliberate edit rather than something a default inherits.
  it("wraps them only on a narrow screen", () => {
    const at = css.indexOf(".world-choice-cards");
    const stacked = css.slice(at);
    expect(stacked).toMatch(/@media \(max-width: 560px\) \{\s*\.world-choice-cards \{/);
  });
});
