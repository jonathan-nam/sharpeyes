import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A typed debt and a typed receipt are the two things on a settlement card that nothing else
// recorded: the amount, the note and the day are gone with the row, and no drop or sale can give
// them back. Both sat behind a bare × at the end of a dense row, one click from gone.
//
// There are no component tests in this repo, so this reads the source, the same approach as
// piece-row-guard.test.ts. What it pins is that neither row hands its remove straight to onClick.

const source = (...parts: string[]) =>
  readFileSync(join(__dirname, "..", ...parts), "utf8").replace(/\s+/g, " ");

const ledger = source("components", "settlement-ledger.tsx");
const css = source("app", "globals.css");

describe("the rows under `owed` take two clicks to remove", () => {
  it("arms first and only removes on the second click", () => {
    expect(ledger).toContain("function ArmedRemove(");
    // The whole guard in one line: an unarmed click sets the flag and returns before onRemove.
    expect(ledger).toContain("if (!armed) { setArmed(true); return; }");
  });

  it("draws both rows under `owed`, and every offset, through it", () => {
    // The typed debt, and the receipt a closure has already spoken for.
    expect(ledger).toContain("label={`Remove ${formatMesos(entry.amount, true)} against ${name}`}");
    expect(ledger).toContain("label={`Remove the ${formatMesos(got.amount, true)} payment`}");
    // An offset is deleted outright, with nothing that keeps its amount, so it takes two clicks too.
    expect(ledger).toContain(
      "label={`Undo ${formatMesos(act.amount, true)} off what ${name} owes you`}",
    );
    expect(ledger.match(/<ArmedRemove/g)).toHaveLength(3);
  });

  it("disarms on blur, so a click elsewhere leaves nothing armed", () => {
    expect(ledger).toContain("onBlur={() => setArmed(false)}");
    expect(ledger).toContain('if (e.key === "Escape") setArmed(false);');
  });

  it("says which state it is in in words, not only in colour", () => {
    // Hover already paints the button --warn, so an armed button that only changed colour would be
    // indistinguishable from one under the pointer.
    expect(ledger).toContain('{armed ? "Remove?" : "×"}');
    expect(ledger).toContain("aria-label={armed ? `Confirm: ${label}` : label}");
    expect(css).toContain("button.ledger-drop-sale.is-armed");
    expect(css).toContain("button.ledger-drop-sale.is-armed:hover:not(:disabled) { padding-left");
  });
});
