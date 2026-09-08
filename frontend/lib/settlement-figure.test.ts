import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Settlement Ledger's headline figure is what somebody is going to be ASKED for, so it is stated
// to the meso.
//
// It was shortened, and that hid a real movement: settling a 144m share took a card from 253.86b to
// 254b, which at two decimals reads as a number that did not move at all. The parts underneath were
// exact the whole time, so rounding only their sum made the one figure you act on the one figure you
// cannot check against them.
//
// A source test, like ledger-card-title.test.ts, because there is nothing to call: the choice is
// which formatter a literal in the header uses, and the way it goes wrong is somebody reaching for
// the shorter one because it fits better.

const source = readFileSync(join(__dirname, "..", "components", "settlement-ledger.tsx"), "utf8");
const page = readFileSync(join(__dirname, "..", "app", "bosses", "drops", "page.tsx"), "utf8");
const summary = readFileSync(join(__dirname, "..", "components", "settlement-summary.tsx"), "utf8");
const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
const settlement = readFileSync(join(__dirname, "settlement.ts"), "utf8");
const entry = readFileSync(join(__dirname, "..", "components", "add-settlement.tsx"), "utf8");

describe("what the card says a person owes", () => {
  it("states it to the meso, never shortened", () => {
    expect(source).toContain("formatMesos(row.mesos, true)");
    // What you owe them, which is the netted debt and the shares nobody has decided about, added
    // rather than netted against the above: both are money leaving your hands. See sharesYouOwe.
    expect(source).toContain("const youOwe = row.owedByYou + row.sharesYouOwe;");
    expect(source).toContain("formatMesos(youOwe, true)");
  });

  it("does not reach for shortMesos anywhere, including the import", () => {
    // The import is the tell. While it is there the short form is one keystroke away, and every
    // figure on this card is money somebody is owed rather than a scale to eyeball.
    expect(source).not.toContain("shortMesos");
  });

  it("counts the pieces rather than formatting them, since they are not money", () => {
    // A piece debt has no price. Putting it through a meso formatter would be the first step back
    // towards pricing it, which is what #354 deleted. Netted into ONE count now, and the direction is
    // in the words: netting a count of the same coupon between the same two people values nothing.
    // The noun moved to the step above it, which names the coupon, so repeating it here was the
    // same fact twice on one line. The count is still raw either way, which is what this pins.
    expect(source).toContain("${row.piecesNet} to hand over");
    expect(source).toContain("${-row.piecesNet} owed");
  });

  it("leaves the arithmetic uncoloured, and signs every component instead", () => {
    // The parts sum to the headline, so "settled" cannot be asked of one. Colouring them put a
    // credit AGAINST the debt in red for being unsettled, so one number read as a problem and as
    // progress at once.
    expect(source).not.toContain('className="droplog-take"');
    expect(source).toContain('const signed = (value: number, currency: Currency = "MESO") =>');
    expect(source).toContain("{signed(part.mesos)}");
    expect(source).toContain("{signed(entry.amount)}");
    expect(css).not.toContain(".ledger-amount.is-open");
    expect(css).not.toContain("is-owing");
  });

  it("keeps green meaning PAID, the way a share badge already uses it", () => {
    // .loot-paid.is-paid is --good for a share that has been paid, and one app cannot have green
    // mean settled on one page and outstanding on the next. This went the wrong way round first.
    expect(css).toMatch(/\.ledger-amount\.is-paid\s*\{\s*color: var\(--good\)/);
    expect(css).toMatch(/\.ledger-summary\.is-open\s*\{\s*color: var\(--bad\)/);
    expect(css).toMatch(/\.loot-paid\.is-paid\s*\{[^}]*var\(--good\)/);
  });

  it("says what settling will RECORD, never what you have already done", () => {
    // "says you have already sent 139,548,023" beside an enabled button reads as a statement of
    // fact rather than as the act the button performs. Same subject-less fragment as the entry box
    // it replaced.
    expect(source).not.toContain("already sent");
    // Mark Sent's own line, which names both pots AND both units. It used to have to be pinned
    // apart from the Settle line, which carried the same words after "also"; that button is gone
    // now (see below), so this is the only line saying it.
    expect(source).toContain("records ${movedBoth(owes, row.usd.owe)} sent to ${row.name}");
  });
  it("puts the nights behind the shares figure on hover, and marks that it has them", () => {
    // The same list sits under its own step further down, with two forms between the two, so the
    // figure and the nights it came off did not read as the same thing.
    expect(source).toContain("const behindShares = row.lines");
    expect(source).toContain("title={part.detail || undefined}");
    expect(source).toContain('part.detail ? "loot-name has-detail" : "loot-name"');
    expect(css).toContain(".loot-name.has-detail");
  });
  it("has no aggregate Settle, an act being per line and in one direction", () => {
    // Kept as a guard rather than deleted, because deleting it would delete the lesson. Settle
    // marked every share on the card paid in BOTH directions, on the reasoning that a relationship
    // is settled by one transfer of the difference. Before that it had already been pulled off
    // cards with nothing to collect, where it could only mean "I have already paid them": hit three
    // times running, each time taking a debt of Jonathan's out of the netting and putting the
    // figure back UP.
    //
    // What finished it is the second unit. No rate exists to net $333.33 against 2.32b, so the one
    // transfer it assumed cannot happen, and a button doing both halves records one that did not.
    expect(source).not.toContain("{collectable && (");
    expect(source).not.toContain("onSettleShares(sharesOf(row))");
    expect(source).not.toContain("also records");
  });

  it("puts the act on the line it is about, named for that line's own direction", () => {
    // The same write either way. What differs is which way the money went, and the line knows.
    expect(source).toContain("onSettleShares([{ lootId: line.lootId, memberId: line.payeeId }])");
    expect(source).toContain('line.direction === "owed" ? "Mark Received" : "Mark Sent"');
    // The Closing Actions face, not the paid pill's. They are the same kind of thing, and a pill
    // beside a squared button read as a different one.
    expect(source).toContain('className="party-save ledger-line-act"');
    expect(css).toContain(".ledger-line-act");
  });
  it("names the nights an offset discharged, off the pools", () => {
    // Without V58 the link is gone: the settle marks those shares PAID, so they leave the wallet,
    // and the adjustment is left saying only "-139,548,023, offset against Bro".
    expect(source).toContain("const nightsBehind = (payouts:");
    expect(source).toContain("offsetShares.get(shareKey(share.lootId, share.memberId))");
    expect(source).toContain("function DischargeRow(");
  });

  it("hands the server every share, since the history is one row per share", () => {
    // A press covering three nights wrote ONE entry: 5.6b against "offset against Bro", with which
    // three of them a fold down from a figure that named none. The rows are what the act was, and
    // writeOffset is where they are written now, so what this side owes is the whole list of shares
    // with the figure the button quoted for each. See SettlementDebtRoutes.kt for the rows.
    expect(page).toContain("parts: parts.map((part) => ({");
    expect(page).toContain("amount: part.amount,");
    // Off the same parts the button quoted a total from, so the rows cannot come to a different sum.
    expect(source).toContain("onOffsetShares(row.holder, row.name, offset.parts)");
    expect(settlement).toContain("parts.reduce((sum, part) => sum + part.amount, 0)");
  });

  it("is ONE request, the halves of an offset cancelling in the net", () => {
    // It was a settle and then an entry per share, each drawn as it landed, and the state between
    // them is the debt un-offset: Bro's card went 253.86b, 254b, 253.86b over two round trips, which
    // reads as a button that did nothing. A failure in the gap left it there for good.
    const handler = page.slice(
      page.indexOf("onOffsetShares={async"),
      page.indexOf("{/* What the cards above do NOT cover"),
    );
    expect(handler).toContain("`${DEBTS_KEY}/offset`");
    // Neither of the page's write helpers: each draws the moment it lands, and this act has two
    // halves that must be drawn together or not at all.
    expect(handler).not.toContain("settleShares(");
    expect(handler).not.toContain("debtWrite(");
    // Both lists off the one answer, so there is no repaint between them.
    expect(handler).toContain("setPools(done.pools);");
    expect(handler).toContain("setDebts(done.debts);");
  });

  it("promises the figures the headline actually moves by", () => {
    // It used to say "clears", because the headline was the net and the two halves of an offset
    // cancelled in it: the button could not promise to take anything off a figure that did not move.
    // A share you owe is outside the net now, so it can.
    expect(source).toContain(
      "takes ${moved(offset.offered ? offset.amount : 0)} off what ${row.name} owes you",
    );
    // POT BY POT, never one sum of the two. One Offset covers the shares you owe and their own money
    // you are holding, and the act writes them as two calls; a single figure over the pair would be
    // an addition this card makes nowhere else.
    expect(source).toContain(
      "? `${formatMesos(shares, true)} of shares and ${formatMesos(row.holding, true)} you are holding`",
    );
    expect(source).toContain(": formatMesos(shares > 0 ? shares : row.holding, true);");
    // And the share figure it promises is the one the act writes: `parts` is what the request carries.
    expect(settlement).toContain(
      "const amount = parts.reduce((sum, part) => sum + part.amount, 0);",
    );
  });

  it("splits an old offset with NO control, since it is not a decision anybody is making", () => {
    // Asking somebody to click through their own history one entry at a time is asking them to do
    // the migration by hand. The guard refuses on an unresolved share, which is what makes running
    // it on every render safe: pools that have not arrived are not a split yet.
    expect(page).toContain("const pendingSplits = splittableDebts(debts, offsetShares);");
    expect(settlement).toContain("if (!share || (claims.get(key) ?? 0) > 1) {");
    expect(settlement).toContain("!== -debt.amount) continue;");
    // The rows first, the entry they replace last. See the comment there for which way fails safely.
    const posts = page.indexOf("incurredAt: debt.incurredAt");
    const del = page.indexOf(
      `await debtWrite(\`\${DEBTS_KEY}/\${debt.id}\`, { method: "DELETE" })`,
    );
    expect(posts).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(posts);
    // The guard cannot live in a ref. StrictMode remounts on purpose, a remount makes a fresh one,
    // and the second pass then re-ran the split against the debts the page first fetched and wrote
    // one night twice. Module scope holds across a remount; V68 holds across a second tab.
    expect(page).toContain("const SPLIT_ATTEMPTED = new Set<string>();");
    expect(page).toContain("SPLIT_ATTEMPTED.add(s.debt.id)");
    expect(page).not.toContain("splitting.current");
    // No button, and nothing that reads like one.
    expect(source).not.toContain("Record as");
    expect(source).not.toContain("onSplitOffset");
  });

  it("carries the drop's art into the nights an offset covered", () => {
    // The row above has it, and a list of drops with the icons dropped is the one place on this
    // card two grindstones cannot be told apart at a glance.
    expect(source).toContain(
      '<img className="loot-icon" src={apiAssetUrl(share.iconUrl)} alt="" />',
    );
    expect(css).toContain(".loot-shares .loot-icon");
  });

  it("puts the DROP on the offset's own row, not a note and a count", () => {
    // Every offset written since one-row-per-share covers one share, and the entries written before
    // it keep the fold. A middle row reading "offset against Bro · 1 share" cost a second click to
    // reach the only fact anybody wanted: which drop that was. Where there is one share, its drop IS
    // the row, with the art the rest of the account reads drops by.
    expect(source).toContain("const one = shares.length === 1 ? shares[0]! : null;");
    expect(source).toContain("const art = one?.iconUrl ?? (pieces > 0 ? iconUrl : null);");
    expect(source).toContain("apiAssetUrl(art)");
    expect(source).toContain("{one.item}");
    expect(source).toContain(`one.members.join(", ")`);
    expect(source).toContain("formatDropped(one.on)");
    expect(source).toContain("sold for ${formatMesos(one.sale, true)}");
  });

  it("keeps a fold for the offset that really is a group", () => {
    // Several nights, or several sales, and no single one names the act, so the count stands and
    // opens. One of either IS the row.
    expect(source).toContain("const folds = shares.length > 1 || act.sales.length > 1;");
    expect(source).toContain("{folds && (");
    expect(source).toContain("party-row-chevron");
  });

  it("counts the coupons a sale offset was made of, and opens onto them", () => {
    // The row reached Jonathan's card as the bare words "coupon sale" beside 2.41b: how many coupons
    // that was, what each fetched and when they sold were on no screen in the app.
    expect(source).toContain(
      "const pieces = act.sales.reduce((sum, sale) => sum + sale.pieces, 0);",
    );
    expect(source).toContain("`${pieces} coupons sold`");
    expect(source).toContain("`${sale.pieces} coupons`");
    expect(source).toContain("sale.soldAt && dayOf(sale.soldAt)");
    expect(source).toContain("signed(-sale.mesos)");
  });

  it("wears the coupon's own art on a sale offset, every piece of one being a coupon", () => {
    expect(source).toContain("iconUrl: string | null;");
    // Off the drop tables, which is where every other coupon sprite on this page comes from.
    expect(page).toContain("iconUrl={vestigeIcon}");
  });

  it("dates every act in the history, and means the same thing by it on each", () => {
    // A history read from the top, in which nothing said which day an act was. The day the ACT was
    // recorded, not the day the drop fell: one column down one list cannot mean two facts, so the
    // drop's own day stays on hover.
    expect(source).toContain('<span className="loot-meta ledger-when">{dayOf(act.at)}</span>');
    expect(source).toContain("const dayOf = (at: string) => formatDropped(at.slice(0, 10));");
    // Never shrunk: a date is unreadable clipped, so the name stays the only part that gives.
    expect(css).toContain(".ledger-drop-head.is-oneline .ledger-when");
    // And below 560px the line runs out. Measured at 390px: a 15-digit figure and the date leave the
    // name at nothing and still spill 6px past the card, so the row wraps rather than lose the
    // figure off the end. One line is worth having where there is width for it, and no further.
    expect(css).toMatch(
      /@media \(max-width: 560px\) \{\s*\.ledger-drop-head\.is-oneline \{\s*flex-wrap: wrap;/,
    );
  });

  it("holds an offset to ONE line, whatever is behind it", () => {
    // Two folds in there is no width for an icon, a name, a boss, three member names, a date and two
    // mesos figures: they came out three lines tall and the list stopped being scannable. The figure,
    // the art and what fell stay; the rest is the title, which is what the shares row above already
    // does. The name is the only part allowed to give, being the one a reader recognises from half.
    expect(source).toContain(
      '<div className="ledger-drop-head is-oneline" title={behind || undefined}>',
    );
    expect(css).toContain(".ledger-drop-head.is-oneline");
    expect(css).toContain("flex-wrap: nowrap");
    expect(css).toContain("text-overflow: ellipsis");
    // The figure is pushed right and never shrunk: it is the one number nobody can infer.
    expect(css).toContain(".ledger-drop-head.is-oneline .ledger-amount");
    // The art is smaller than its 46px frame, which is now every settlement row's rule rather than
    // this one's: an offset's row and a share's are the same kind of row.
    expect(css).toContain(".ledger-drop-head .loot-icon");
  });

  it("puts the acts in a drop queue, never a share list", () => {
    // `.loot-shares > li` is a wrapping ROW with a rule above it and a `.ledger-drop` is a COLUMN
    // with a rule down its left. One inside the other gave every act both, and the section came out
    // with stray borders and two indents fighting.
    expect(source).toContain('<ul className="ledger-queue" id={`off-${row.key}`}>');
    // The queue hangs off the step now rather than off a row of it, so `.ledger-drop .ledger-queue`
    // is gone with the row: nothing on this card nests one queue in another. What a drop row still
    // holds is a list of NIGHTS, and that keeps its indent.
    expect(css).not.toContain(".ledger-drop .ledger-queue");
    expect(css).toContain(".ledger-drop .loot-shares");
  });

  it("states a discharge once, in the list that is for discharges", () => {
    // `soldOfTheirs` is only ever the part somebody has said comes off their debt, which makes it a
    // discharge. Listed as a part as well, 2,412,222,150 sat in the owed list AND inside the fold
    // below it, so the two lists came to more than the card did.
    expect(source).not.toContain("mesos: row.parts.soldOfTheirs");
  });

  it("resolves a share off the POOLS, since an offset's shares are paid and gone from the wallet", () => {
    expect(page).toContain("const offsetShares = new Map<string, OffsetShare>()");
    expect(page).toContain("item: loot.name");
    expect(page).toContain("on: loot.droppedOn");
    // In the sale's own unit, not off `saleAmount`: that column is null for a sale made in real
    // money, so reading it directly would print no price at all on the row meant to let the share
    // be checked against one. See saleMoney.
    expect(page).toContain("sale: sold?.amount ?? null");
    expect(page).toContain("currency: split.currency");
  });

  it("splits only the drops an offset actually names", () => {
    // Splitting every loot row in every pool to answer for a handful would be a pass over the whole
    // account on every render.
    expect(page).toContain("const wanted = new Set(debts.flatMap");
    expect(page).toContain("if (!wanted.has(loot.id)) continue;");
  });

  it("says so when a drop behind an offset has been deleted", () => {
    // A row that quietly drops one of the nights behind a figure is a figure that no longer adds up.
    expect(source).toContain('item: "A drop that has been deleted"');
  });

  it("keeps a hand-entered debt a plain row, since it discharges no share", () => {
    // No fold on it at all: an entry that names a share is a discharge and is drawn under `offsets`,
    // so what is left in the owed list names nothing and never had anything to open.
    expect(source).toContain("function EnteredRow(");
    const entered = source.slice(source.indexOf("function EnteredRow("));
    expect(entered).not.toContain("party-row-chevron");
  });
  it("keeps the summary to totals, since the cards are the per-person list", () => {
    // A line per person went here and came straight back out: the cards below say the same thing, at
    // more length and with something to do about it, so it was a second list of the same names half
    // a screen above the first.
    expect(page).toContain("<SettlementSummary rows={settlement} totals={owedTotals} />");
    expect(summary).not.toContain("settlement-strip");
    expect(css).not.toContain(".settlement-strip");
  });

  it("sums the strip off the same rows the cards draw", () => {
    // The Wallet had its own pass over the pools, which is how two surfaces come to give two
    // answers. A strip disagreeing with the list under it is the same bug with a shorter walk.
    // Asserted on the IMPORTS, not on the prose: the comment above it has to be free to name the
    // pools in order to say why it does not read them.
    expect(summary).toContain("rows: Settlement[]");
    expect(summary).not.toMatch(/^import .*(wallet|types\/loot)/m);
  });

  it("lets a figure be copied, since it gets pasted into the game", () => {
    // Retiring the Wallet took the only place on this account where an amount could be copied, and
    // CopyAmount sends the RAW digits: a pasted "3,284,739,285" is not a price the game accepts.
    expect(source).toContain("<CopyAmount");
  });

  it("lets the money you are HOLDING be copied too, it being the one you send", () => {
    // "I paid them" beside it means the mesos went across in a trade, so this is a figure that gets
    // pasted, and it was the only one on the card with an act behind it and no way to take it.
    expect(source).toContain(
      "<CopyAmount value={row.holding} display={formatMesos(row.holding, true)} />",
    );
  });

  it("asks what a PAYMENT was for too, the same way the entry beside it does", () => {
    // The two halves of one conversation were recorded differently: a debt could say "for the Kalos
    // run" and the money arriving back could not say which debt it answered. Same box, same words,
    // and optional on both, so neither form waits on it. Both boxes are the entry card's now.
    expect(entry).toContain("onAddPayment(payer.holder, paid, gotNote.trim())");
    expect(entry).toContain("const [gotNote, setGotNote] = useState");
    // Its own state. One box shared between the two forms would clear a half-typed note in the
    // other the moment either saved.
    expect(entry).not.toContain("setGotNote(note)");
    expect(page).toContain("body: JSON.stringify({ holder, amount, note: note || undefined })");
  });

  it("says what a receipt was for where it has one, and stays plain where it does not", () => {
    expect(source).toContain("${formatMesos(got.amount, true)} paid \\u00b7 ${got.note}");
  });

  it("keeps a pinned person's card drawn with nothing on it", () => {
    // The one case a blank card is wanted: it is where next week's entry goes. Without it the place
    // you record what somebody owes is somewhere you have to make appear first.
    expect(source).toContain("row.pinned ?");
    expect(page).toContain("people.filter((p) => p.pinned)");
  });

  it("offers the pin only on a PERSON, never on an unclaimed character", () => {
    // A character nobody has claimed is somebody the account cannot name yet, and pinning one would
    // keep a card for a human it may turn out to already have.
    expect(source).toContain("{row.attributed && (");
  });

  it("does not offer to copy a COUNT of pieces, which is not a price", () => {
    expect(source).toContain("row.piecesNet > 0");
    expect(source).toContain("const toCopy = row.mesos > 0 ? row.mesos");
  });
});

// A payment was on the card twice, in two different words: an unlabelled "received" line folding
// every receipt into the arithmetic, and a "210,000,000 paid · 20 stars" pill under the form. The
// note was legible only on the pill and the figure only in the list, so neither said the whole act.
describe("a receipt on the card", () => {
  it("is an act in the history, beside the offsets that also came off", () => {
    expect(source).toContain("moneyRows(row, payments.counted)");
    expect(settlement).toContain('source: "PAYMENT"');
    expect(settlement).toContain('label: got.note ?? "paid"');
  });

  it("is not also folded into a received line, which said the sum and nothing else", () => {
    expect(source).not.toContain("row.parts.received");
    expect(source).not.toContain('label: "received"');
  });

  it("goes under the step this account already calls what came off the debt", () => {
    // OFFSETS is the word, and it means anything that came off: a payment is one, so the fold
    // counts acts and each row inside names which act it was. The step was renamed for a turn and
    // the rename was the wrong half of the change to make.
    expect(source).toContain('<span className="ledger-heading">Offsets</span>');
    expect(source).toContain('plural(discharges.length, "offset")');
  });

  it("is removable where it is drawn, since this is the only screen that records one", () => {
    expect(source).toContain("onRemovePayment(act.id)");
  });

  it("keeps the strip for the receipts a closure already spent, and only those", () => {
    // Those came off a debt that is closed, so listing them with the rest would put money against a
    // debt they have already paid. They stay drawn because nothing else takes a mistyped one back.
    expect(source).toContain("{payments.spent.length > 0 && (");
    expect(page).toContain("paymentsSinceClosing(payments, settlements)");
  });
});

// One card, one unit, and one word for what the pair button closes.
describe("what the figures on the card are counted in", () => {
  it("draws a share PRE-FEE, the unit the net and the Offset are already in", () => {
    // `pay` is what the sender lists, `nets` is what survives the receiver's 5%. The header's net is
    // built from `pay` on both sides and offsetOf sums `pay`, so a line drawn in `nets` put a
    // 703,703,488 offset directly under the 668,518,313 share it was made of. The party page this
    // row links to leads with `pay` too, and carries the fee underneath.
    expect(source).toContain(
      'signed(line.direction === "owe" ? -line.pay : line.pay, line.currency)',
    );
    // And in the line's OWN unit. A share of a sale made in real money is cents, so drawing it
    // through the meso formatter would state $333.34 as 33,334 mesos: a thousandth of the debt,
    // with nothing on screen to say which unit was meant. See lib/money.ts.
    expect(source).toContain("formatMoney(line.pay, line.currency, true)");
    // The hover list behind the `shares` part is one direction, because that part is: what they owe
    // you. What you owe is not in it and is not netted off it. Mesos only, for the same reason: it
    // is the breakdown of a meso figure, and a dollar share is not one of its components.
    expect(source).toContain('line.direction === "owed" && line.currency === "MESO"');
    // No figure on this card comes off the fee, so `nets` is not read here at all.
    expect(source).not.toContain("line.nets");
  });

  it("says only what closing the pair will NOT cover, never a count of what it will", () => {
    // "closes 22 bosses" counted drop rows across both coupon piles and sat directly under the two
    // lists holding those rows: the wrong unit (one boss run two weeks running is two nights) and a
    // restatement of the lists at once, with nothing on the card to check 22 against. The lists ARE
    // the answer, so the count goes rather than gets reworded.
    expect(source).not.toContain('"boss" : "bosses"');
    expect(source).not.toContain("pair.nights");
    expect(source).not.toContain("closes ${");
    // What no list says stays: a night owing a third person is drawn and cannot be closed here.
    expect(source).toContain("${pair.shared} shared with others, not closed here");
    // And nothing is left on the type to invite it back.
    expect(settlement).not.toMatch(/^\s*nights\??:/m);
  });

  it("spaces no row for a chevron, in either list", () => {
    // `.party-row-toggle` is 18px and `.ledger-drop-head` adds its own 10px gap, so an empty frame
    // is 28px of indent. `owed` lost its frame first, being a list where nothing folds at all: it
    // put the one row wearing it, a typed debt, 28px right of the parts stacked above it. Under
    // `offsets` some rows fold and some do not, and the frame kept that column straight at the cost
    // of holding 28px in front of a 32px icon on every row of the list. The chevron hangs off the
    // act's date now, so there is no column to keep straight and no frame anywhere on this card.
    const entered = source.slice(source.indexOf("function EnteredRow("));
    expect(entered).not.toContain("party-row-toggle");
    const discharge = source.slice(
      source.indexOf("function DischargeRow("),
      source.indexOf("function PieceNights("),
    );
    expect(discharge).not.toContain("is-empty");
    // Art first, which is the whole point of moving it.
    expect(discharge.indexOf("loot-icon")).toBeLessThan(discharge.indexOf("party-row-toggle"));
  });
});
