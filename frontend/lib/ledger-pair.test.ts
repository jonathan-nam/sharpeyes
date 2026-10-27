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

// The card is settlement-ledger.tsx drawn through ledger-card.tsx, so a guard reads both.
const ledger = read("components", "settlement-ledger.tsx") + read("components", "ledger-card.tsx");
const shared = read("components", "shared-cards.tsx");
const acts = read("components", "closing-acts.tsx");
// The Settlement tab's body. See components/settlement-stage.tsx.
const stage = read("components", "settlement-stage.tsx");
const view = read("lib", "settlement-view.ts");
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
    const offsets = ledger.indexOf('<span className="ledger-heading">Paid</span>');
    expect(at).toBeLessThan(owed);
    expect(owed).toBeLessThan(offsets);
    // The share lines are not in the pair: each sits under the Unsettled half whose hands its money
    // is in (2026-10-23), so there is no `shares` step of its own any more.
    expect(ledger).not.toContain('<span className="ledger-step">shares</span>');
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
    // Unsettled Amounts does not fold: what stands open is the card's point, listed in full.
    expect(ledger).not.toContain("showUnsettled");
  });

  it("draws no chevron where there is no list to fold", () => {
    // The card's rule everywhere else: a row that does not fold draws none. With nothing priced the
    // step is two forms, and they stay reachable.
    expect(ledger).toContain("const owedParts = parts.length + theirEntries.length;");
    expect(ledger).toContain("const openOwed = showOwed || owedParts === 0;");
    expect(ledger).toContain("{owedParts > 0 && (");
  });

  it("says what its own rows come to, and reads it off those rows", () => {
    // The sum of the list it heads, the way the offsets figure is the sum of its own, so the card's
    // arithmetic is on the card: owed less offsets is the header. Off the drawn rows rather than
    // worked out a second way, because two spellings of one number is how they come to disagree.
    expect(ledger).toContain("const owedTotal =");
    expect(ledger).toContain("parts.reduce((sum, part) => sum + part.mesos, 0) +");
    expect(ledger).toContain("theirEntries.reduce((sum, entry) => sum + entry.amount, 0);");
    expect(ledger).toContain('<span className="ledger-amount">{signed(owedTotal)}</span>');
  });

  it("wears one shape in all three sections: heading, chevron, figure", () => {
    // They grew up separately and read as three kinds of thing. Offsets carried its total and its
    // chevron on a ROW inside the list, and the chevron belongs to the heading, not to a row of it.
    // Not Unsettled Amounts: it does not fold (2026-10-23), and its line carries the net instead.
    for (const heading of ["Owed", "Paid"]) {
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

  it("puts the net on Unsettled Amounts' own line, where it is read first", () => {
    const at = ledger.indexOf('<span className="ledger-heading">Unsettled Amounts</span>');
    const head = ledger.slice(at, ledger.indexOf("</div>", at));
    expect(head).toContain('className="ledger-net"');
  });
});

describe("one section for what is unsettled", () => {
  it("holds the shares and the coupon money in one, not a section each", () => {
    // Two sections with a rule between them said the same thing: these are the amounts standing
    // between you. One transfer of the difference closes both, and Closing Actions acts on both.
    // The heading is the shared layout's (ledger-card.tsx); the card fills its halves.
    expect(ledger).toContain('<span className="ledger-heading">Unsettled Amounts</span>');
    // Each share under the half whose hands its money is in.
    expect(ledger).toContain("<ShareRows lines={linesYouHold.map(shareLine)} />");
    expect(ledger).toContain("<ShareRows lines={linesTheyHold.map(shareLine)} />");
    // ONE FIGURE over the pair, which is what one press of Offset moves. The held money was the
    // whole of it, so the other half of the act had a figure nowhere and the two came off what they
    // owe you one after the other. See unsettledParts for why adding these two is safe.
    expect(ledger).toContain('<HeldBy label="Held by You" mesos={unsettled}>');
    expect(ledger).toContain("mesos: offset.amount,");
    expect(ledger).toContain("mesos: row.holding,");
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
    expect(ledger).toContain('<div className="ledger-offsets-panel" id={`nights-${row.key}`}>');
  });

  it("draws one list of nights, the side the net runs, with no week filter", () => {
    // Both sides drawn read as 20 you held under a net of 360 owed. The step says the direction.
    expect(ledger).toContain("const nights = nightsOwing(theirNights, myNights);");
    expect(ledger).not.toContain("I am holding");
    expect(ledger).not.toContain("nightWeek");
  });

  it("puts each half's figure on its own line, over the drops that make it", () => {
    // A bare 500,000,000 on a row of its own under the heading read as a row of the list. On the
    // "Held by You" half, the one Offset moves; "Held by <name>" carries its own figure.
    expect(ledger).toContain('<HeldBy label="Held by You" mesos={unsettled}>');
    // The half's own line carries its figure, copyable. See HeldBy.
    const at = ledger.indexOf('<span className="ledger-step">{label}</span>');
    expect(at, "the figure is off the half's line").toBeGreaterThan(-1);
    const head = ledger.slice(at, ledger.indexOf("</div>", at));
    expect(head).toContain("<CopyAmount value={mesos}");
    // No summary row repeating the figure ("shares I owe Bro 2,468,431,118" under 2,468,431,118):
    // the drops themselves are listed.
    expect(ledger).not.toContain("{unsettledParts.map(");
    expect(ledger).toContain(
      "const unsettled = unsettledParts.reduce((sum, part) => sum + part.mesos, 0);",
    );
    expect(ledger).toContain("const theyHold = row.heldByThem + theyHoldShares;");
  });

  it("draws the art on both lists in the section, at one size and legibly", () => {
    // A list of drops that drops the icons is the one place you cannot tell two grindstones apart at
    // a glance. The share rows carried none at all, and then carried them at a clean half, where
    // nearest-neighbour takes every other row of the sprite and the art stops being readable.
    // Through DropIcon, which every row in the shared layout draws its art with.
    expect(ledger).toContain('<img className="loot-icon" src={apiAssetUrl(url)} alt="" />');
    expect(ledger).toContain("iconUrl: line.iconUrl,");
    expect(wallet).toContain("iconUrl: loot.iconUrl,");
    // One rule over every row, so none can drift: an offset's row and a share's are the same kind of
    // row, and the coupon sale under the same heading is drawn as one too.
    const coupons = ledger.slice(ledger.indexOf("export function CouponTotal("));
    expect(coupons.slice(0, coupons.indexOf("\n}\n"))).toContain('className="ledger-drop-head');
    const both = rule(".ledger-drop-head .loot-icon");
    expect(both).toMatch(/width:\s*32px/);
    expect(both).toMatch(/image-rendering:\s*auto/);
  });

  it("names the item a sale row is a count of, off the row its sprite comes from", () => {
    // "130 coupons" is the count and not what was sold. One item behaves this way, so the card can
    // spell it, and reading the name off the same drop row as the icon is what stops it drawing one
    // item and naming another.
    // One row per side since 2026-10-23: the coupons' total, named. See CouponTotal.
    expect(ledger).toContain('`${formatPieces(pieces)} ${couponName ?? "coupons"}`');
    expect(view).toContain(".find((drop) => drop.dropKey === VESTIGE) ?? null");
    expect(stage).toContain("const vestige = vestigeOf(page.drops);");
    expect(stage).toContain("iconUrl={vestige?.iconUrl ?? null}");
    expect(stage).toContain("couponName={vestige?.name ?? null}");
  });
});

describe("every act in one step", () => {
  it("draws every closing act on both cards from one builder", () => {
    // Each card deciding its own buttons is how the owner's netted while the member's did not, and
    // a listing offered beside a figure running the other way (2026-10-25). The labels live in
    // components/closing-acts.tsx and nowhere else; see lib/closing-acts.test.ts.
    for (const card of [ledger, shared]) {
      expect(card).toContain("acts={closingActs({");
      expect(card).not.toMatch(/`Mark \$\{/);
      expect(card).not.toMatch(/`Offset \$\{/);
    }
    expect(ledger.match(/^\s*I paid them$/gm)).toBeNull();
  });

  it("writes every pot in ONE call, one press being one act", () => {
    // Each answer drew the card, so two requests walked Owen's owed figure down in two steps. The
    // body itself is pinned in lib/closing-acts.test.ts.
    expect(ledger).toContain("void write(onClose(row.holder, row.name, kind, pots), null);");
    expect(ledger).not.toContain("onDecideHeld");
    expect(ledger).not.toContain("onDisposeProceeds");
  });

  it("puts every act after the step that heads them, and none before it", () => {
    // They were scattered across the steps they acted on, which is how one card came to carry two
    // buttons wearing the word Offset. The entry forms are submits and stay where they are typed.
    const at = ledger.indexOf('<span className="ledger-heading">Closing Actions</span>');
    expect(at, "the step is gone").toBeGreaterThan(-1);
    for (const m of ledger.matchAll(
      /<Button\s+variant="primary"(?!\s+(?:type="submit"|className=))/g,
    )) {
      expect(m.index, "an act is drawn outside Closing Actions").toBeGreaterThan(at);
    }
  });

  it("offers no act that closes the coupon nights wholesale", () => {
    // Settle Both Sides marked every open night handed over in both directions. Removed at the
    // user's request (2026-10-23): coupon counts close through a sale or a keep at a price.
    expect(ledger).not.toContain("Settle Both Sides");
    expect(ledger).not.toContain("onSettlePair");
    expect(ledger).not.toContain("row.piecesNet)} coupons`");
    // Nor the count of what it will NOT close, which was the same reasoning stopping one step
    // short. Each of those nights says so on its own row: see the marker in PieceNights.
    expect(ledger).not.toContain("shared with others, not closed here");
    expect(ledger).toContain('{drop.shared && " \u00b7 owes somebody else too"}');
  });

  it("titles every act the same way, so one is not a different kind of thing", () => {
    // One case for every act, Title Case like every other button in the app, and each names the
    // amount it moves. What each says is pinned in lib/closing-acts.test.ts; this keeps the case.
    expect(acts).toContain("`Offset ${amount}`");
    expect(acts).toContain("`Take ${amount} Off Owed Amount`");
    expect(acts).toContain('"Mark Settled"');
    expect(ledger).not.toMatch(/^\s*Settle$/gm);
    // Received on the line, the per-share act; the lot under Closing Actions.
    expect(ledger).toContain("Mark Received");
    for (const source of [ledger, acts]) {
      expect(source).not.toContain("Mark received");
      expect(source).not.toContain("Mark sent");
    }
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
    const entry = stage.indexOf("<AddSettlement");
    const cards = stage.indexOf("<SettlementLedger");
    expect(entry, "the entry card is gone").toBeGreaterThan(-1);
    expect(entry).toBeLessThan(cards);
    // And under the totals, which is the section's own heading and its one figure.
    expect(stage.indexOf("<SettlementSummary")).toBeLessThan(entry);
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
    // A night that never owed anything sits in `drops` at zero. Read as a length, that put "Owen is
    // holding" over nothing at all. A night a sale answered in full is not drawn either.
    expect(ledger).toContain("const theirNights = row.drops.filter((drop) => drop.pieces > 0);");
    expect(ledger).toContain("const myNights = row.owedDrops.filter((drop) => drop.pieces > 0);");
    // The washed list is what gets drawn, and what opens the section.
    expect(ledger).toContain("drops={nights}");
    expect(ledger).toContain("const couponsOpen = row.piecesNet !== 0 && nights.length > 0;");
    // And nothing is drawn off the raw arrays, which is the question that was being asked wrong.
    expect(ledger).not.toContain("row.drops.length > 0");
    expect(ledger).not.toContain("row.owedDrops.length > 0");
    expect(ledger).not.toContain("drops={row.drops}");
    expect(ledger).not.toContain("drops={row.owedDrops}");
  });

  it("keeps the price a pill records beside the lists, not inside one", () => {
    // A tranche against their pile has a pill nowhere else on any screen, so it must not go with a
    // heading when that heading goes.
    const at = ledger.indexOf("drops={nights}");
    const pills = ledger.indexOf("{yourKeeps.length > 0 && (");
    expect(at).toBeGreaterThan(-1);
    expect(pills).toBeGreaterThan(at);
    // Outside the panel the toggle owns, which ends before it.
    expect(ledger.indexOf("</div>", at)).toBeLessThan(pills);
    // Only the keeps you wrote: the other side's are its own sales, on its own Sale Ledger.
    expect(ledger).toContain(
      "const yourKeeps = keptRows.filter((tranche) => tranche.recordedByYou !== false);",
    );
  });

  it("holds a typed entry to ONE line, whatever its note says", () => {
    // A grid item's default min-width is `auto`, which is its longest word: one 120-character note
    // with no space in it sized the whole half and pushed its row's × out over the half beside it.
    expect(rule(".ledger-pair > .ledger-entry")).toMatch(/min-width:\s*0/);
    // Breaking the note mid-word kept the × inside the card but took the row to four lines. It
    // truncates instead, and the whole note is the row's tooltip.
    expect(ledger).toMatch(
      /<Tooltip text=\{entry\.note\}>\s*<div className="ledger-drop-head is-oneline is-typed">/,
    );
    const name = rule(".ledger-drop-head.is-oneline .loot-name");
    expect(name).toMatch(/text-overflow:\s*ellipsis/);
    expect(name).toMatch(/white-space:\s*nowrap/);
    expect(name).toMatch(/min-width:\s*0/);
    // The figure and the × never give, so a long note cannot push either off the row.
    expect(rule(".ledger-drop-head.is-oneline .ledger-amount")).toMatch(/flex:\s*none/);
    expect(css).toContain(".ledger-drop-head.is-oneline button.ledger-drop-sale");
    // And no width takes it back to two lines.
    expect(css).toContain(".ledger-drop-head.is-oneline:not(.is-typed)");
  });
});
