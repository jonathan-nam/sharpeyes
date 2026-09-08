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
const wallet = read("lib", "wallet.ts");
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
    const owed = ledger.indexOf('<span className="ledger-heading">Owed</span>');
    const offsets = ledger.indexOf('<span className="ledger-heading">Offsets</span>');
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
    // The word Owed over a gap. Nothing is left in the column at all: the two entry forms moved to
    // the foot of the card, so an empty left half is an empty left half.
    expect(ledger).toMatch(/\{owedParts > 0 && \(\s*<div className="ledger-step-line">/);
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

  it("folds by default, like the two sections beside it", () => {
    // The figure it comes to is on the heading's line either way, so what opening it adds is which
    // rows made that figure. Open by default it also disagreed with its own arrow.
    expect(ledger).toContain("const [showOwed, setShowOwed] = useState(false);");
    expect(ledger).toContain("const [showOff, setShowOff] = useState(false);");
    expect(ledger).toContain("const [showHeld, setShowHeld] = useState(false);");
  });

  it("draws no chevron where there is no list to fold", () => {
    // The card's rule everywhere else: a row that does not fold draws none. With nothing priced the
    // step is two forms, and they stay reachable.
    expect(ledger).toContain("const owedParts = parts.length + typed.length;");
    expect(ledger).toContain("const openOwed = showOwed || owedParts === 0;");
    expect(ledger).toContain("{owedParts > 0 && (");
  });

  it("says what its own rows come to, and reads it off those rows", () => {
    // The sum of the list it heads, the way the offsets figure is the sum of its own, so the card's
    // arithmetic is on the card: owed less offsets is the header. Off the drawn rows rather than
    // worked out a second way, because two spellings of one number is how they come to disagree.
    expect(ledger).toContain("const owedTotal =");
    expect(ledger).toContain("parts.reduce((sum, part) => sum + part.mesos, 0) +");
    expect(ledger).toContain("typed.reduce((sum, entry) => sum + entry.amount, 0);");
    expect(ledger).toContain('<span className="ledger-amount">{signed(owedTotal)}</span>');
  });

  it("wears one shape in all three sections: heading, chevron, figure", () => {
    // They grew up separately and read as three kinds of thing. Offsets carried its total and its
    // chevron on a ROW inside the list, and the chevron belongs to the heading, not to a row of it.
    for (const heading of ["Owed", "Offsets", "Unsettled Amounts"]) {
      const at = ledger.indexOf(`<span className="ledger-heading">${heading}</span>`);
      expect(at, heading).toBeGreaterThan(-1);
      // The heading opens a `.ledger-step-line`, and the chevron and the figure are on it.
      const line = ledger.lastIndexOf('<div className="ledger-step-line">', at);
      expect(line, `${heading} is not on a step line`).toBeGreaterThan(-1);
      const head = ledger.slice(line, ledger.indexOf("</div>", at));
      expect(head, `${heading} lost its chevron`).toContain("party-row-toggle");
      expect(head, `${heading} lost its figure`).toContain("ledger-amount");
      expect(head.indexOf("party-row-toggle")).toBeLessThan(head.indexOf("ledger-amount"));
    }
    // And no total is left on a row inside a list.
    expect(ledger).not.toContain('<span className="loot-name">{offsets}</span>');
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
    // The held money has no step over it saying where it came from: its figure is on the section's
    // own heading line, and the rows it opens onto say it, one sale each.
    expect(section).toContain("<CopyAmount value={row.holding}");
    expect(ledger).not.toContain("coupon sales</span>");
    // The card is one person's, so neither heading names them again.
    expect(ledger).not.toContain("money I'm holding");
  });

  it("folds the coupon nights behind the step that counts them, same shape as the rest", () => {
    // A fourth foldable thing on this card, so it wears the card's shape: label, chevron, figure,
    // in that order. The step says what the nights come to, which is what the section is read for;
    // WHICH nights it came off is the follow-up, so it starts closed like the three above it.
    expect(ledger).toContain("const [showNights, setShowNights] = useState(false);");
    const at = ledger.indexOf('<span className="ledger-step">{couponName ?? "Coupons"}</span>');
    expect(at, "the coupon step is gone").toBeGreaterThan(-1);
    const line = ledger.slice(at, ledger.indexOf("</div>", at));
    expect(line, "the coupon step lost its chevron").toContain("party-row-toggle");
    expect(line.indexOf("party-row-toggle")).toBeLessThan(line.indexOf("ledger-amount"));
    // And both lists are inside the fold the chevron names, or it would open onto half of them.
    expect(ledger).toContain("aria-controls={`nights-${row.key}`}");
    expect(ledger).toContain("<div id={`nights-${row.key}`}>");
  });

  it("puts the figure on the heading's line, with its own way into the sales", () => {
    // A bare 500,000,000 on a row of its own under the heading read as a row of the list. What it is
    // NOT is a total of the section: the shares under it run both ways and are in the card's header
    // already, so the chevron opens onto the sales it is made of and onto nothing else.
    const at = ledger.indexOf(
      '<div className="ledger-step-line">\n            <span className="ledger-heading">Unsettled Amounts',
    );
    expect(at, "the figure is off the heading's line").toBeGreaterThan(-1);
    const head = ledger.slice(at, ledger.indexOf("</div>", at));
    expect(head).toContain("<CopyAmount value={row.holding}");
    expect(head).toContain("aria-controls={`held-${row.key}`}");
  });

  it("draws the art on both lists in the section, at one size and legibly", () => {
    // A list of drops that drops the icons is the one place you cannot tell two grindstones apart at
    // a glance. The share rows carried none at all, and then carried them at a clean half, where
    // nearest-neighbour takes every other row of the sprite and the art stops being readable.
    expect(ledger).toContain(
      '<img className="loot-icon" src={apiAssetUrl(line.iconUrl)} alt="" />',
    );
    expect(wallet).toContain("iconUrl: loot.iconUrl,");
    // One rule over both lists, so neither can drift: an offset's row and a share's are the same
    // kind of row, and a sale row under the same heading is one too.
    const both = rule(".ledger-drop-head .loot-icon,\n.ledger-entry > .loot-shares .loot-icon");
    expect(both).toMatch(/width:\s*32px/);
    expect(both).toMatch(/image-rendering:\s*auto/);
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
    // "Mark Sent" a step above "I paid them" was one errand in two buttons: shares of a night, and
    // their own money a coupon sale left with you. One trade settles both.
    // The label, not the word: the comment above the acts records the shape this replaced.
    expect(ledger.match(/^\s*I paid them$/gm)).toBeNull();
    expect(ledger.match(/^\s*Mark Sent$/gm)).toHaveLength(1);
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

  it("says what Mark Settled closes and never how much of it", () => {
    // Every act carries a line saying what pressing it will record, this one included. What it must
    // not carry is a figure: counting the nights back matched nothing else on the card (22 was
    // eleven rows in each pile), and a count of coupons would overclaim, a night shared with a third
    // person being one this cannot close. That much is said with the lists themselves.
    expect(ledger).toContain(
      '<span className="ledger-progress">closes the coupon nights on both sides</span>',
    );
    expect(ledger).not.toContain("row.piecesNet)} coupons`");
    expect(ledger).toContain("${pair.shared} shared with others, not closed here");
  });

  it("titles every act the same way, so one is not a different kind of thing", () => {
    // Two of the four were sentence case and read as prose beside Offset and Settle.
    //
    // Settle is gone: see settlement-figure. What replaced it is an act per share line, and those
    // are titled the same way, which is the whole point of this test. "Mark Sent" is written twice
    // on purpose, once on a line and once in Closing Actions, because they are different scopes of
    // one act: this share, or everything you owe them plus the money of theirs you are holding.
    for (const label of ["Offset", "Mark Sent", "Mark Settled"]) {
      expect(ledger.match(new RegExp(`^\\s*${label}$`, "gm")), label).toHaveLength(1);
    }
    expect(ledger).not.toMatch(/^\s*Settle$/gm);
    // The per-line act picks its label from the line's direction, so neither sits on a line of its
    // own the way the three above do. Title Case is the thing being pinned, not the layout.
    expect(ledger).toContain('"Mark Received" : "Mark Sent"');
    expect(ledger).not.toContain("Mark received");
    expect(ledger).not.toContain("Mark sent");
  });
});

describe("the two entry forms", () => {
  // Their own card, above the settlement cards they write to, so what follows is the ENTRY card's.
  it("is out of every settlement card", () => {
    // Inside one they put a form between every card's arithmetic and the next card's, and the debt
    // half could not open the first debt of a relationship: a card is drawn for somebody who
    // already owes you something.
    expect(ledger).not.toContain("Add Debt");
    expect(ledger).not.toContain("Add Payment");
    expect(ledger).not.toContain("onAddDebt");
    expect(ledger).not.toContain("onAddPayment");
    // Taking a row back off stays on the card, which is where the row is drawn.
    expect(ledger).toContain("onRemoveDebt");
    expect(ledger).toContain("onRemovePayment");
  });

  it("is drawn above the cards it writes to", () => {
    const entry = page.indexOf("<AddSettlement");
    const cards = page.indexOf("<SettlementLedger");
    expect(entry, "the entry card is gone").toBeGreaterThan(-1);
    expect(entry).toBeLessThan(cards);
    // And under the totals, which is the section's own heading and its one figure.
    expect(page.indexOf("<SettlementSummary")).toBeLessThan(entry);
  });

  it("stacks the label over its box, which is what lets the row hold four controls", () => {
    // Beside them, the labels' own width came off the line the picker, two boxes and submit share.
    expect(rule(".loot-share-input.is-stacked")).toMatch(/flex-direction:\s*column/);
    // STRETCH, not grow: in a column the grow axis is the wrong one, and the box keeps its own
    // 20-character width whatever the label holding it does.
    expect(rule(".ledger-sale .loot-share-input.is-grow .split-input")).toMatch(
      /align-self:\s*stretch/,
    );
  });

  it("sizes the submit like the boxes beside it", () => {
    // .party-save is 13px on 8px of padding, four pixels shorter than a 15px .split-input on 9px,
    // so one control in a row of four did not line up.
    const add = rule(".ledger-add");
    expect(add).toMatch(/font-size:\s*var\(--text-lg\)/);
    expect(add).toMatch(/padding:\s*9px/);
    expect(rule(".ledger-sale .ledger-add")).toMatch(/align-self:\s*flex-end/);
  });

  it("sizes the picker like them too, a select taking no line box of its own", () => {
    // Chrome gives a select's button 20px of content where an input builds 22.5px from the same
    // font, so the picker stood 11.5px shorter than the amount box. Measured in headless chromium:
    // all four controls are 42.50px tall now, top 55.50 to bottom 98.00.
    const picker = rule(".loot-share-input.is-stacked select.split-input");
    expect(picker).toMatch(/font-size:\s*var\(--text-lg\)/);
    expect(picker).toMatch(/min-height:\s*calc\(1\.5em \+ 20px\)/);
    // Its own selector: `.ledger-sale select` belongs to the Sale Ledger's disposition picker, which
    // is deliberately smaller for the sake of "they took mine, at a price".
    expect(css).toContain(".ledger-sale select.split-input {");
  });
});

// Two ways a half-width column went wrong, both found on screen rather than by a test.
describe("what a column draws and how wide it lets itself get", () => {
  it("heads a list of nights only where a night will be drawn", () => {
    // A night a sale answered for, or one the other side cancelled, sits in `drops` at zero:
    // settleThePair still closes it, so it is kept, and PieceNights draws it in neither list. Read
    // as a length, that put "Bro is holding" over nothing at all.
    expect(ledger).toContain("const theirNights = row.drops.filter((drop) => drop.pieces > 0);");
    expect(ledger).toContain("const myNights = row.owedDrops.filter((drop) => drop.pieces > 0);");
    expect(ledger).toContain("{theirNights.length > 0 && (");
    expect(ledger).toContain("{myNights.length > 0 && (");
    // The filtered arrays are what gets drawn, which is the claim. Not pinned to the whole tag:
    // one of these wraps and one does not, so the tag prefix was really pinning prettier.
    expect(ledger).toContain("drops={theirNights}");
    expect(ledger).toContain("drops={myNights}");
    // And nothing is drawn off the raw arrays, which is the question that was being asked wrong.
    expect(ledger).not.toContain("row.drops.length > 0");
    expect(ledger).not.toContain("row.owedDrops.length > 0");
    expect(ledger).not.toContain("drops={row.drops}");
    expect(ledger).not.toContain("drops={row.owedDrops}");
  });

  it("keeps the price a pill records beside the lists, not inside one", () => {
    // A tranche against their pile has a pill nowhere else on any screen, so it must not go with a
    // heading when that heading goes.
    const at = ledger.indexOf("{theirNights.length > 0 && (");
    const pills = ledger.indexOf("{keptRows.length > 0 && (");
    expect(pills).toBeGreaterThan(at);
    // Outside the fragment the heading owns, which ends before it.
    expect(ledger.indexOf("</>", at)).toBeLessThan(pills);
  });

  it("lets a typed note break rather than size the column it is in", () => {
    // A grid item's default min-width is `auto`, which is its longest word: one 120-character note
    // with no space in it sized the whole half and pushed its row's × out over the half beside it.
    expect(rule(".ledger-pair > .ledger-entry")).toMatch(/min-width:\s*0/);
    // Only the note breaks mid-word. Every other `.loot-name` is a drop or a boss out of the
    // catalog and breaks at its spaces.
    expect(ledger).toContain(
      '<span className="loot-name is-note">{entry.note ?? "entered"}</span>',
    );
    const note = rule(".ledger-drop-head .loot-name.is-note");
    expect(note).toMatch(/overflow-wrap:\s*anywhere/);
    expect(note).toMatch(/min-width:\s*0/);
  });
});
