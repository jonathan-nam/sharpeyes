// What a pile can be told became of its pieces, and how many each answer has room for.
//
// Split out of the card because of the way this goes wrong. A fate left off is not a missing
// control, it is a pile that can never reach "all accounted for": the count sits short and the card
// asks forever, with nothing on screen saying which answer it is waiting for.
//
// That is what BOUGHT being somebody else's fate did to your own card. You cannot buy your own
// coupons, which is true and is not what the option is for: it takes the pieces in a pile that are
// NOT the holder's, and your inventory holds those every time a night did not divide your way.
// Without it they could only be sold, so a pile you meant to keep never finished.
//
// `coversThePile` is that property, stated once so a test can hold it.
//
// The other half is `asksAnything`: WHETHER a pile has a question at all. Since #354 deleted the
// apportioning, no debt is derived from these rows, so a pile that owes nobody gets the same figures
// whatever it is told. Asking it to account for itself is work with no reader.

import { spendOldestFirst, spendSales } from "./piece-ledger";
import type { AnsweredSale } from "./piece-ledger";
import { SELF_KEY, holderKey, unaccounted } from "./vestige-ledger";
import type { Holder, HolderLedger } from "./vestige-ledger";

/** Every answer a pile can be given. All three, on every card, whoever is holding it. */
export const FATES = ["SOLD", "KEPT", "BOUGHT"] as const;

export type Fate = (typeof FATES)[number];

/**
 * How many pieces this fate has room for.
 *
 * A redemption stops at the holder's OWN share and a purchase at what is left over, because the
 * pieces past their share are not theirs to redeem. Bounding the redemption is only safe because the
 * purchase exists to take what it turns away: clamping with nowhere for the surplus to go would
 * record 195 of a 250 that really happened and leave 55 pieces waiting on a sale that is not coming.
 * See V50.
 *
 * A sale is bounded only by what is unaccounted for. It is not a claim about whose pieces they were,
 * so there is no share to measure it against.
 *
 * Rows already entered count against all three, so three of them cannot walk past what one cannot.
 */
export function roomFor(ledger: HolderLedger, fate: Fate): number {
  const left = unaccounted(ledger);
  if (fate === "KEPT") return Math.min(left, Math.max(0, ledger.ownShare - ledger.kept));
  if (fate === "BOUGHT")
    return Math.min(left, Math.max(0, ledger.pieces - ledger.ownShare - ledger.bought.pieces));
  return left;
}

/**
 * Whether the answers on offer can between them account for the whole pile without a sale.
 *
 * The invariant the card is built on, and the one thing about the fate list that cannot be seen by
 * looking at it. Every piece is either the holder's own or somebody else's, so a redemption and a
 * purchase cover the pile between them and nobody is forced to sell a coupon to make the count come
 * out. False means a pile has pieces with no honest answer, whoever holds it.
 */
export function coversThePile(ledger: HolderLedger): boolean {
  return roomFor(ledger, "KEPT") + roomFor(ledger, "BOUGHT") >= unaccounted(ledger);
}

/**
 * Pieces this pile owes somebody, across the drops still open.
 *
 * Off the transfers, which are already filtered to what THIS holder owes, so a pile you are merely
 * the creditor of counts zero: what they are holding of yours is the Settlement Ledger's to say.
 */
export function owes(ledger: HolderLedger, heldOfYours: HeldOfYours = new Map()): number {
  const byCreditor = new Map<string, number>();
  for (const drop of ledger.drops) {
    if (drop.closed) continue;
    for (const transfer of drop.transfers) {
      byCreditor.set(transfer.toId, (byCreditor.get(transfer.toId) ?? 0) + transfer.pieces);
    }
  }
  let total = 0;
  for (const [creditor, pieces] of byCreditor) {
    // PER CREDITOR, and floored there. Owing Bro 90 while Bro holds 20 of yours is 70 changing
    // hands, but owing Bro 90 while JARED holds 20 of yours is still 90: netting across two people
    // would ask one of them to settle the other's debt, which is the cross-person netting this app
    // refuses. Floored, because a creditor holding more of yours than you owe them is a debt the
    // other way and belongs on their own card.
    total += Math.max(0, pieces - (heldOfYours.get(creditor) ?? 0));
  }
  return total;
}

/** Pieces of THIS pile's holder that each other pile is sitting on, keyed by the pile holding them. */
export type HeldOfYours = Map<string, number>;

/**
 * Who this pile owes, and how many each, after their own coupons come off.
 *
 * The same per-creditor subtraction `owes` totals, kept apart so the card can name them. A count with
 * nobody's name on it is the state this was reported in: "owes 90 pieces" over a pile whose whole debt
 * was one person's, and no way to tell from the card which person.
 *
 * Biggest first, and a creditor who nets to nothing drops out: they are square, and the pile has
 * nothing to say to them.
 *
 * Off the ONE spend, so the names over the queue count the same pieces the rows under it do. It used
 * to total the transfers itself and subtract only the coupons of yours they hold, which left the
 * header naming a debt a sale had already answered.
 */
export function owedByCreditor(
  ledger: HolderLedger,
  heldOfYours: HeldOfYours = new Map(),
): { key: string; name: string; pieces: number }[] {
  const { nights, left } = spendAnswered(ledger, heldOfYours);
  const names = new Map(nights.flatMap((n) => n.transfers.map((t) => [t.toId, t.to] as const)));
  return [...left.entries()]
    .map(([key, pieces]) => ({ key, name: names.get(key) ?? key, pieces }))
    .filter((row) => row.pieces > 0)
    .sort((a, b) => b.pieces - a.pieces || a.name.localeCompare(b.name));
}

/**
 * That map, off the other piles' own figures rather than recomputed.
 *
 * `owedToYou` is already "pieces of yours this pile holds, open drops only", so this is a re-keying
 * and not a second reading of the transfers. Your own pile is skipped: it cannot hold your pieces
 * against you.
 */
export function heldOfYoursBy(ledgers: HolderLedger[]): HeldOfYours {
  const out: HeldOfYours = new Map();
  for (const ledger of ledgers) {
    if (ledger.holder.kind === "SELF" || ledger.closed) continue;
    // Net of what a sale out of THEIR pile has already answered you for. Those pieces are money on
    // their Settlement card, so counting them here as coupons of yours they are still holding would
    // let one debt cancel your own a second time. The same subtraction settlement.ts makes to reach
    // `piecesAnswered.yours`, and the reason both ledgers now reduce a night alike.
    const answered = Math.min(ledger.owedToYou, piecesOf(ledger.answeredByCreditor.get(SELF_KEY)));
    const held = ledger.owedToYou - answered;
    if (held > 0) out.set(holderKey(ledger.holder), held);
  }
  return out;
}

/**
 * How a sale out of your own pile lands on the people it owes, without being asked.
 *
 * The pieces you owe go out first, biggest debt first, each capped at what that person is owed, and
 * whatever is left over is your own. So a sale is two numbers again: how many went, and for how much.
 *
 * This reverses #362's "ask me, per sale", and the reason it can is that the arrangement is recorded
 * per night now. What the box was guarding against was crediting real money off a guess at a mixed
 * pile; the answer it wanted is the one thing the ledger already knows exactly, which is who is short
 * and by how much. What it still is not is a claim about WHICH physical coupons went to market: it is
 * a statement that this much of the money is theirs, which is what the debt was in.
 *
 * Feed it the NETTED debts (owedByCreditor), never pieceCreditors: that one sums transfers gross, so a
 * creditor holding coupons of yours would be credited for pieces they are already sitting on.
 *
 * Biggest first is arbitrary between two creditors and has to be: no order can be read off the
 * coupons. It is deterministic, capped, and the row says what it did, which is what makes it
 * correctable rather than a guess nobody can see.
 */
export function distributeSale<T extends { key: string; pieces: number }>(
  pieces: number,
  creditors: T[],
): { creditor: T; pieces: number }[] {
  let left = Math.max(0, Math.floor(pieces));
  const out: { creditor: T; pieces: number }[] = [];
  for (const creditor of [...creditors].sort(
    (a, b) => b.pieces - a.pieces || a.key.localeCompare(b.key),
  )) {
    if (left <= 0) break;
    const cut = Math.min(left, creditor.pieces);
    if (cut <= 0) continue;
    out.push({ creditor, pieces: cut });
    left -= cut;
  }
  return out;
}

/**
 * How much of what this pile owes has been answered, in pieces.
 *
 * A redemption is the holder's own share by definition, so it settles nothing they owe. The other two
 * both do, and by the same means: the creditor gets a FIGURE instead of their coupons, on their
 * Settlement card. A purchase is that agreement outright (V50), and a sale is it at the price the
 * market paid, once the sale says whose pieces were in it (V56).
 *
 * That last clause is what #362 changed. Before it, a sale of a mixed pile could not say which of the
 * coupons went out, so it answered for nothing and the pile asked forever. Do not read the old rule
 * back in: the pieces are priced, and the debt is on the other ledger in mesos.
 *
 * Both routes are counted in one place, answeredByHolder, so a purchase that named its creditor
 * cannot be counted once as a purchase and again as an attribution.
 *
 * Capped, because a holder may have bought pieces on a night whose books were later closed.
 */
export function settledOf(ledger: HolderLedger, heldOfYours: HeldOfYours = new Map()): number {
  // What the spend actually consumed, rather than `ledger.answered` capped at the whole debt. That
  // total is the PILE's, so a tranche naming Bro counted against what Jared was owed, and the header
  // could read less outstanding than its own rows came to.
  return owes(ledger, heldOfYours) - outstandingOf(ledger, heldOfYours);
}

/**
 * Whether the card has a question, or is only somewhere a sale MAY be recorded.
 *
 * A night that divided the way it fell is finished when it is logged. Nothing is derived from what
 * became of those coupons, so "0 of 1140 pieces accounted for" asked for 1140 pieces of typing to
 * move a figure nobody reads. The count is an instruction, and an instruction with no consequence is
 * the narration this app's screens are not allowed to carry.
 *
 * What is asked is the DEBT, not the pile: of 1160 coupons in your inventory, 1150 are your own and
 * nobody is waiting on them. Counting the pile demanded 1160 answers for a 10-piece debt.
 *
 * Over-entry still speaks, whoever holds the pile: more entered than the pile holds is a miscount,
 * and a card that went quiet about it would be hiding what it dropped rather than saying it short.
 */
export function asksAnything(ledger: HolderLedger, heldOfYours: HeldOfYours = new Map()): boolean {
  return outstandingOf(ledger, heldOfYours) > 0 || ledger.accounted > ledger.pieces;
}

/** One night under a pile, as the queue reads it. */
type Night = HolderLedger["drops"][number];

/**
 * ONE spend of everything that has answered this pile's debt, night by night and creditor by
 * creditor. Every figure the card states about a debt comes off this.
 *
 * Three separate subtractions is how the Sale Ledger came to say a night owed Bro 60 while the
 * Settlement Ledger said 20 off the same night, each right under its own rule: the fold here was
 * ALL-OR-NOTHING per night, so a night its credit could not finish outright was drawn GROSS;
 * `settledOf` pooled the answered pieces over the whole pile, so one creditor's sale could count
 * against another's debt; and `owedByCreditor` subtracted nothing at all.
 *
 * Credit is a creditor's own coupons sitting in your inventory plus what a sale has already answered
 * for them. That is the same pair the Settlement Ledger cancels and V56 prices, and it is why a night
 * can go quiet without anybody being paid: 20 of theirs against 20 of yours is nothing changing hands.
 *
 * Sales first, NEWEST night first through the primitive the Settlement Ledger spends with, then
 * their own coupons, oldest night first. A sale cannot have come off a night logged after it, the reckoning receivedSinceClosing
 * applies to money (#350), and two surfaces reducing one night by different rules are two answers.
 * Not the order the rows are DRAWN in: that is the catalog's, so two bosses in one week never swap
 * places, and it is not the order the nights happened in.
 *
 * Leftover credit goes unspent. A creditor holding more of yours than you owe them is a debt the
 * other way and belongs on their own card, which is the floor `owes` already applies.
 */
export function spendAnswered(
  ledger: HolderLedger,
  heldOfYours: HeldOfYours = new Map(),
): {
  /** The open nights that owe somebody, each transfer reduced to what it STILL owes. */
  nights: Night[];
  /** Nights nothing is left on. Kept in `nights` so a caller can count them. */
  folded: Set<string>;
  /** What is still owed each creditor once the spend is done. */
  left: Map<string, number>;
} {
  const open = ledger.drops.filter((d) => !d.closed && d.transfers.length > 0);
  const creditors = new Set(open.flatMap((d) => d.transfers.map((t) => t.toId)));

  // Keyed on the TRANSFER, not on (night, creditor): one night can owe one person twice, off two
  // stacks, and those are two rows on the card. Identity holds because the nights are only copied
  // once the spend is finished.
  const remaining = new Map<Night["transfers"][number], number>();
  const left = new Map<string, number>();
  for (const creditor of creditors) {
    const owed = open.flatMap((night) =>
      night.transfers
        .filter((t) => t.toId === creditor)
        .map((t) => ({
          droppedOn: night.droppedOn,
          recordedAt: night.recordedAt,
          pieces: t.pieces,
          transfer: t,
        })),
    );
    // The sales first, each reaching only the nights it could have answered, then the cancellation,
    // which is not a sale and reaches all of them. The same order settleCouponNights spends in.
    const sold = spendSales(owed, ledger.answeredByCreditor.get(creditor) ?? []);
    let over = 0;
    for (const row of spendOldestFirst(sold, heldOfYours.get(creditor) ?? 0)) {
      remaining.set(row.transfer, row.pieces);
      over += row.pieces;
    }
    left.set(creditor, over);
  }

  const nights = open.map((night) => ({
    ...night,
    transfers: night.transfers.map((t) => ({ ...t, pieces: remaining.get(t) ?? t.pieces })),
  }));
  return {
    nights,
    folded: new Set(
      nights.filter((n) => n.transfers.every((t) => t.pieces === 0)).map((n) => n.lootId),
    ),
    left,
  };
}

/**
 * The three fates of an open night, of which only `owing` is drawn.
 *
 * A night that divided the way it fell is finished when it is logged, and one whose debt has been
 * ANSWERED has its money on somebody's Settlement card. Neither leaves anything here to act on, and
 * drawn they WERE the queue: the handful of rows with a debt under them were lost among them.
 * `clean` and `answered` are kept because they are how the tests pin which fate a night took.
 *
 * Answered NIGHT BY NIGHT. See foldAnswered for why, and for the order.
 *
 * A CLOSED night is none of the three. It is the Settled View's, which names the act that closed it,
 * who with, and what it wrote off. See lib/settled-log.ts.
 */
export function queueOf(
  ledger: HolderLedger,
  heldOfYours: HeldOfYours = new Map(),
): { owing: Night[]; clean: number; answered: number } {
  const open = ledger.drops.filter((d) => !d.closed);
  // REDUCED, not merely filtered. A night the spend part-answered is listed at what is left on it,
  // which is what the Settlement Ledger has always listed and what the header above counts.
  const { nights, folded } = spendAnswered(ledger, heldOfYours);
  return {
    owing: nights.filter((n) => !folded.has(n.lootId)),
    clean: open.length - nights.length,
    answered: folded.size,
  };
}

/**
 * What this pile still owes, which is the whole of what the card is for.
 *
 * The header's one figure, and it moves as the debt is answered, so no second line restates it.
 * `holding 1495` stood there before and was a number nobody could act on.
 */
export function outstandingOf(ledger: HolderLedger, heldOfYours: HeldOfYours = new Map()): number {
  // The sum of what the rows under it say, off the same spend, so the header and its own queue cannot
  // come to two figures. See spendAnswered.
  let total = 0;
  for (const pieces of spendAnswered(ledger, heldOfYours).left.values()) total += pieces;
  return Math.max(0, total - unattributed(ledger));
}

/**
 * Pieces a purchase answered for without saying whose they were.
 *
 * V50: a purchase is one creditor's in full. `answeredByPair` refuses to guess WHICH, because naming
 * one would discharge a debt against somebody who never agreed to it, so these pieces can come off no
 * night and no creditor. They come off the pile's total alone, which is the one question they can
 * honestly answer: this pile owes that much less.
 *
 * So the header can read below what its rows come to, and only ever below: the rows keep a piece the
 * total has let go, which is the safe direction for a list that is a worklist. Zero for every tranche
 * entered since V56, all of which name their shares.
 */
function unattributed(ledger: HolderLedger): number {
  let named = 0;
  for (const sales of ledger.answeredByCreditor.values()) named += piecesOf(sales);
  return Math.max(0, ledger.answered - named);
}

/** What a run of sales comes to. The total the pair used to be stored as. See answeredSalesByPair. */
function piecesOf(sales: AnsweredSale[] | undefined): number {
  return (sales ?? []).reduce((sum, sale) => sum + sale.pieces, 0);
}

/**
 * Your own piles, split by whether the Sale Ledger has a reason to draw one.
 *
 * A pile that owes somebody, or one with a row still to deal with, is a card: there is something to
 * answer or something to correct. A pile with neither is a place a sale MAY be recorded and nothing
 * else, and drawn anyway it is a permanent "holding 1140" at a reader with nothing to do about it.
 *
 * `recorded` is the caller's, and what it counts moved with `stillAsking`: a sale that is finished is
 * not drawn on the card any more, so a pile kept open by one would be a card with nothing on it.
 *
 * Nothing draws the quiet ones. The two controls that asked for one are gone, so a pile that owes
 * nobody has no card on the tab, and no sale can be entered against it until it owes somebody again.
 * That takes a mistyped tranche on a settled pile with it: this card was the only place one could be
 * taken back off. `quiet` is returned to say what was left out, and nothing renders it.
 *
 * A pile whose every night is CLOSED is quiet whatever it has recorded. It is finished, so it is the
 * Settled View's, and a worklist that keeps drawing finished work is not a worklist.
 */
export function worthDrawing(
  yours: HolderLedger[],
  recorded: (key: string) => boolean,
  heldOfYours: HeldOfYours = new Map(),
): { drawn: HolderLedger[]; quiet: HolderLedger[] } {
  const drawn: HolderLedger[] = [];
  const quiet: HolderLedger[] = [];
  for (const ledger of yours) {
    const has =
      !ledger.closed && (asksAnything(ledger, heldOfYours) || recorded(holderKey(ledger.holder)));
    (has ? drawn : quiet).push(ledger);
  }
  return { drawn, quiet };
}

/**
 * A pile's recorded sales, less the ones that are finished.
 *
 * A sale of somebody's coupons is finished when its money has been paid out or taken off what they
 * owe you. Nothing about it is waiting on anybody then, and this card is a worklist, so it leaves:
 * kept, it is a row per sale for as long as the account runs, and the finished ones outnumber the
 * live one within a month of playing. Which decisions took which sales is `decidedSales`, off the
 * same match the Settlement card's own rows are drawn from.
 *
 * NAMING a creditor is not finished, and it is the trap here: the money sits in your hands as theirs
 * until the two of you say which of the two things happens to it, so a sale nobody has decided about
 * is exactly the one still to deal with.
 *
 * DROPPED, not folded behind a count. That count was still finished work on a worklist, and this was
 * never the only way back to a row: the act that settled it is on the other person's Settlement card,
 * where an offset names the very sale it was made of, and taking it off there puts the money back in
 * your hands undecided, which brings the sale back here to be corrected or removed.
 *
 * A share naming the pile's own holder does not count as naming anybody: a pile owes itself nothing,
 * so there is no decision to wait for and no other screen carrying the row. Same rule as
 * `answeredByPair`, and it has to be, or a sale the two disagree about would vanish from the card
 * while still asking on it.
 */
export function stillAsking<
  T extends { id: string; holder: Holder; shares?: { holder: Holder }[] },
>(
  tranches: T[],
  /** Creditors whose money off each sale has been decided, keyed by tranche. See decidedSales. */
  decided: Map<string, Set<string>>,
): T[] {
  return tranches.filter((tranche) => {
    const pile = holderKey(tranche.holder);
    const named = (tranche.shares ?? [])
      .map((s) => holderKey(s.holder))
      .filter((creditor) => creditor !== pile);
    // EVERY creditor, since one sale can hold two people's coupons: settled with one of them, it is
    // still waiting on the other, and this row is where that is said.
    return !(named.length > 0 && named.every((creditor) => decided.get(tranche.id)?.has(creditor)));
  });
}
