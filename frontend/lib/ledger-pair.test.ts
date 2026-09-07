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
const page = read("app", "bosses", "drops", "page.tsx");
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
  it("draws no step at all where nothing is priced", () => {
    // The word OWED over a gap. What is left in the column is the two entry forms, and each of them
    // says what it adds.
    expect(ledger).toContain('{owedParts > 0 && (\n            <div className="ledger-step-line">');
  });

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

describe("one section for what is unsettled", () => {
  it("holds the shares and the coupon money in one, not a section each", () => {
    // Two sections with a rule between them said the same thing: these are the amounts standing
    // between you. One transfer of the difference closes both, and Closing Actions acts on both.
    const at = ledger.indexOf('<span className="ledger-heading">Unsettled Amounts</span>');
    expect(at, "the heading is gone").toBeGreaterThan(-1);
    const section = ledger.slice(at, ledger.indexOf("Closing Actions", at));
    expect(section).toContain('<span className="ledger-step">shares</span>');
    // The held money's own figure IS its heading, so there is no step over it saying where it came
    // from: the rows inside say that, one sale each.
    expect(section).toContain("<CopyAmount value={row.holding}");
    expect(section).toContain("aria-controls={`held-${row.key}`}");
    expect(ledger).not.toContain("coupon sales</span>");
    // The card is one person's, so neither heading names them again.
    expect(ledger).not.toContain("money I'm holding");
  });

  it("names the item a sale row is a count of, off the row its sprite comes from", () => {
    // "130 coupons" is the count and not what was sold. One item behaves this way, so the card can
    // spell it, and reading the name off the same drop row as the icon is what stops it drawing one
    // item and naming another.
    expect(ledger).toContain("`${sale.pieces} ${couponName}`");
    expect(page).toContain(".find((drop) => drop.dropKey === VESTIGE) ?? null;");
    expect(page).toContain("const vestigeIcon = vestige?.iconUrl ?? null;");
    expect(page).toContain("couponName={vestige?.name ?? null}");
  });
});

describe("every act in one step", () => {
  it("collapses the two ways of sending into one", () => {
    // "Mark sent" a step above "I paid them" was one errand in two buttons: shares of a night, and
    // their own money a coupon sale left with you. One trade settles both.
    // The label, not the word: the comment above the acts records the shape this replaced.
    expect(ledger.match(/^\s*I paid them$/gm)).toBeNull();
    expect(ledger.match(/^\s*Mark sent$/gm)).toHaveLength(1);
    expect(ledger.match(/^\s*Offset$/gm)).toHaveLength(1);
  });

  it("writes each pot on its own, since they are two facts", () => {
    expect(ledger).toContain(
      "if (offset.offered) await onOffsetShares(row.holder, row.name, offset.parts);",
    );
    expect(ledger).toContain(
      'if (row.holding > 0) await onDisposeProceeds(row.holder, row.holding, "OFFSET");',
    );
    expect(ledger).toContain("if (owes > 0) await onSettleShares(owedByYouShares(row));");
    expect(ledger).toContain(
      'if (row.holding > 0) await onDisposeProceeds(row.holder, row.holding, "PAID");',
    );
  });

  it("puts every act after the step that heads them, and none before it", () => {
    // They were scattered across the steps they acted on, which is how one card came to carry two
    // buttons wearing the word Offset. The entry forms are submits and stay where they are typed.
    const at = ledger.indexOf('<span className="ledger-heading">Closing Actions</span>');
    expect(at, "the step is gone").toBeGreaterThan(-1);
    for (const m of ledger.matchAll(/type="button"\s+className="party-save"/g)) {
      expect(m.index, "an act is drawn outside Closing Actions").toBeGreaterThan(at);
    }
  });

  it("says nothing about how many coupons Mark settled closes", () => {
    // The lists above are what it closes, and counting them back matched nothing else on the card:
    // 22 was eleven rows in each pile. What it cannot close is said with those lists.
    expect(ledger).not.toContain("row.piecesNet)} coupons`");
    expect(ledger).toContain("${pair.shared} shared with others, not closed here");
  });
});

describe("the two entry forms", () => {
  it("labels the boxes and submits with a mark", () => {
    expect(ledger).toContain('<span className="ledger-heading">Add Debt</span>');
    expect(ledger).toContain('<span className="ledger-heading">Add Payment</span>');
    // The visible label is inside the accessible name, which is WCAG 2.5.3.
    expect(ledger).toContain("aria-label={`Amount ${row.name} owes you`}");
    expect(ledger).toContain("aria-label={`Amount ${row.name} has paid you`}");
    expect(ledger).toContain('aria-label="Description, optional"');
    // A mark is not text, so the act is the label.
    expect(ledger).toContain("aria-label={`Add what ${row.name} owes you`}");
    expect(ledger).toContain("aria-label={`Add a payment from ${row.name}`}");
  });

  it("stacks the label over its box, so the row fits at half a card", () => {
    // Beside it, the label's own width came off the line the two boxes and the submit had to share,
    // and the submit was pushed to a row of its own.
    expect(rule(".loot-share-input.is-stacked")).toMatch(/flex-direction:\s*column/);
    // STRETCH, not grow: in a column the grow axis is the wrong one, and the box kept its own
    // 20-character width, wider at half a card than the label holding it.
    expect(rule(".ledger-sale .loot-share-input.is-grow .split-input")).toMatch(
      /align-self:\s*stretch/,
    );
  });

  it("sizes the submit like the boxes beside it", () => {
    // .party-save is 13px on 8px of padding, four pixels shorter than a 15px .split-input on 9px,
    // so one control in a row of three did not line up.
    const add = rule(".ledger-add");
    expect(add).toMatch(/font-size:\s*var\(--text-lg\)/);
    expect(add).toMatch(/padding:\s*9px/);
    expect(rule(".ledger-sale .ledger-add")).toMatch(/align-self:\s*flex-end/);
  });
});
