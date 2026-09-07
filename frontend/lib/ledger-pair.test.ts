import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The two halves of one figure, read against each other: `owed` is what builds the debt and
// `offsets` is what has come off it. Stacked, the second was a scroll past the `shares` list in
// between, so the card said its arithmetic in two places a screen apart.
//
// There are no component tests in this repo, so this reads the source, the same approach as
// settlement-figure.test.ts.

const root = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

const ledger = read("components", "settlement-ledger.tsx");
const css = read("app", "globals.css");

/** A rule's body, by its selector. */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

describe("`owed` and `offsets` are half a card each", () => {
  it("holds both halves, and only those, in the pair", () => {
    const at = ledger.indexOf('<div className="ledger-pair">');
    expect(at, "the pair is gone").toBeGreaterThan(-1);
    const owed = ledger.indexOf('<span className="ledger-step">owed</span>');
    const offsets = ledger.indexOf('<span className="ledger-step">offsets</span>');
    const shares = ledger.indexOf('<span className="ledger-step">shares</span>');
    expect(at).toBeLessThan(owed);
    expect(owed).toBeLessThan(offsets);
    // `shares` is the detail behind ONE row of the left half, not a third question, so it follows
    // the pair rather than sitting in it.
    expect(offsets).toBeLessThan(shares);
  });

  it("gives the width back on a card with no offsets on it", () => {
    // Which is most of them. Two fixed halves left the left one at half width with nothing beside
    // it, and the forms in it take a price, a note and a button.
    expect(rule(".ledger-pair")).toMatch(/grid-template-columns:\s*repeat\(auto-fit,/);
  });

  it("draws one rule under the pair rather than one under each half", () => {
    // The halves end at different heights, so their own borders came out as two ragged lines.
    expect(rule(".ledger-pair")).toContain("border-bottom");
    const half = rule(".ledger-pair > .ledger-entry");
    expect(half).toMatch(/border-bottom:\s*none/);
    expect(half).toMatch(/padding-bottom:\s*0/);
  });
});

describe("folding `owed`", () => {
  it("folds by hiding, so a half-typed amount survives the fold", () => {
    // The step holds the two forms that record a debt and a receipt. Unmounting them threw away
    // whatever was in the boxes, and re-mounting cleared the note beside it too.
    expect(ledger).toContain(
      '<div className="ledger-fold" id={`owed-${row.key}`} hidden={!openOwed}>',
    );
    // `display: flex` on the fold beats the attribute, so the attribute has to be said in CSS.
    expect(rule(".ledger-fold[hidden]")).toMatch(/display:\s*none/);
  });

  it("opens by default, being the half the card is for", () => {
    expect(ledger).toContain("const [showOwed, setShowOwed] = useState(true);");
  });

  it("draws no chevron where there is no list to fold", () => {
    // The card's rule everywhere else: a row that does not fold draws none. With nothing priced the
    // step is two forms, and they stay reachable.
    expect(ledger).toContain("const owedParts = parts.length + typed.length;");
    expect(ledger).toContain("const openOwed = showOwed || owedParts === 0;");
    expect(ledger).toContain("{owedParts > 0 && (");
  });

  it("says how many rows are folded away, and no second sum", () => {
    // The count is what says the list is there. The money it comes to is the header's figure, and a
    // total spelled out here as well is two spellings of one number, which is how they disagree.
    expect(ledger).toContain('{plural(owedParts, "part")}');
    expect(ledger).not.toContain("owedTotal");
  });
});
