import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Marking a share paid is a TOGGLE, and the paid state has to look like one.
//
// It read "paid" in a green pill, which is exactly what a status badge looks like. Undoing a share
// marked paid by mistake was not discoverable: the only obviously clickable thing said "Mark paid",
// and clicking that put it straight back. Three attempts in a row ended with the row still paid, and
// the figure it was supposed to move never moved.
//
// A source test, like ledger-card-title.test.ts, because there is nothing to call: it is a literal
// in the JSX and the way it goes wrong is somebody tidying the label back to the state alone.

const source = readFileSync(join(__dirname, "..", "components", "loot-row.tsx"), "utf8");

describe("the paid toggle on a share", () => {
  it("marks the paid state as undoable, not as a badge", () => {
    // × is this app's own undo mark: a tranche row and an entered debt both carry it.
    expect(source).toContain('share.paid ? "Paid \\u00d7" : "Mark paid"');
  });

  it("names the ACTION to a screen reader, in both states", () => {
    // The visible label carries the state, so the accessible name has to carry what a click does.
    expect(source).toContain("Mark ${share.name} unpaid");
    expect(source).toContain("Mark ${share.name} paid");
  });

  it("still sends the opposite of what is stored, which is what makes it a toggle", () => {
    expect(source).toContain("onSetPaid(share.memberId, !share.paid)");
  });
});
