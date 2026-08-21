import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The sale form's seller sets which way the debt runs, so its default cannot be arbitrary.
//
// It seeded from ran[0], whichever seat sits first in the week's roster by PartyMember.position.
// Submitting without opening the select therefore recorded a specific person as holding the value
// and owing everyone else, off nothing. Now that a drop can say who picked it up (V64), the seat
// holding it is a recorded fact, and that is the one to open on.
//
// A source test, like paid-toggle.test.ts: the seed is a useState initialiser in the JSX and the
// way it goes wrong is somebody tidying it back to the first seat.

const source = readFileSync(join(__dirname, "..", "components", "loot-row.tsx"), "utf8");

describe("who the sale form opens on", () => {
  it("opens on the seat recorded as looting it", () => {
    expect(source).toContain("ran.find((m) => m.id === loot.looterMemberId)?.id");
    expect(source).toContain('useState(looted ?? ran[0]?.id ?? "")');
  });

  it("takes the looter from `ran`, so it can only offer a seat the sell route accepts", () => {
    // Reading loot.looterMemberId straight would seed the select with an id that has no option on
    // a week the looter did not run, leaving it blank and the submit disabled with nothing said.
    expect(source).not.toContain("useState(loot.looterMemberId ??");
  });
});
