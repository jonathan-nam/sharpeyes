// What a pile can be told became of its pieces, and how many each answer has room for.
//
// A fate left off is a pile that can never reach "all accounted for", with nothing on screen saying
// which answer it is waiting for. BOUGHT applies to your own pile too: it takes the pieces in a pile
// that are NOT the holder's. `coversThePile` pins that property.

import { pieces as roundPieces, spendOldestFirst, spendSales } from "./piece-ledger";
import type { AnsweredSale } from "./piece-ledger";
import { SELF_KEY, holderKey, unaccounted } from "./vestige-ledger";
import type { Holder, HolderLedger } from "./vestige-ledger";

/** Every answer a pile can be given. All three, on every card, whoever is holding it. */
export const FATES = ["SOLD", "KEPT", "BOUGHT"] as const;

export type Fate = (typeof FATES)[number];

/**
 * How many pieces this fate has room for.
 *
 * A redemption stops at the holder's OWN share and a purchase at what is left over. Bounding the
 * redemption is only safe because the purchase takes what it turns away. See V50.
 *
 * A sale is bounded only by what is unaccounted for. Rows already entered count against all three.
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
 * Every piece is either the holder's own or somebody else's, so a redemption and a purchase cover
 * the pile between them. False means a pile has pieces with no honest answer.
 */
export function coversThePile(ledger: HolderLedger): boolean {
  return roomFor(ledger, "KEPT") + roomFor(ledger, "BOUGHT") >= unaccounted(ledger);
}

/**
 * Pieces this pile owes somebody, across the drops still open.
 *
 * The transfers are already filtered to what THIS holder owes, so a pile you are only the creditor of
 * counts zero.
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
    // PER CREDITOR: this app never nets one person's debt against another's. Floored, because a
    // creditor holding more of yours than you owe them is a debt the other way, on their own card.
    total += Math.max(0, pieces - (heldOfYours.get(creditor) ?? 0));
  }
  return total;
}

/** Pieces of THIS pile's holder that each other pile is sitting on, keyed by the pile holding them. */
export type HeldOfYours = Map<string, number>;

/**
 * Who this pile owes, and how many each, after their own coupons come off.
 *
 * Biggest first, and a creditor who nets to nothing drops out. Off the ONE spend (spendAnswered), so
 * the names over the queue count the same pieces the rows under it do.
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
 * That map, re-keyed off each other pile's `owedToYou` rather than recomputed. Your own pile is
 * skipped.
 */
export function heldOfYoursBy(ledgers: HolderLedger[]): HeldOfYours {
  const out: HeldOfYours = new Map();
  for (const ledger of ledgers) {
    if (ledger.holder.kind === "SELF" || ledger.closed) continue;
    // Net of what a sale out of THEIR pile has already answered you for: those pieces are money on
    // their Settlement card, and counting them again would cancel your debt twice. Same subtraction
    // as settlement.ts's `piecesAnswered.yours`.
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
 * whatever is left over is your own. It says how much of the money is theirs, not which physical
 * coupons went to market.
 *
 * Feed it the NETTED debts (owedByCreditor), never pieceCreditors: that one sums transfers gross, so a
 * creditor holding coupons of yours would be credited for pieces they are already sitting on.
 *
 * Biggest first is arbitrary but deterministic: no order can be read off the coupons.
 */
export function distributeSale<T extends { key: string; pieces: number }>(
  pieces: number,
  creditors: T[],
): { creditor: T; pieces: number }[] {
  // Exact, as the debts it pays are. See entitlements.
  let left = Math.max(0, pieces);
  const out: { creditor: T; pieces: number }[] = [];
  for (const creditor of [...creditors].sort(
    (a, b) => b.pieces - a.pieces || a.key.localeCompare(b.key),
  )) {
    if (left <= 0) break;
    const cut = Math.min(left, creditor.pieces);
    if (cut <= 0) continue;
    out.push({ creditor, pieces: cut });
    left = roundPieces(left - cut);
  }
  return out;
}

/**
 * How much of what this pile owes has been answered, in pieces.
 *
 * A redemption is the holder's own share by definition, so it settles nothing they owe. The other two
 * both do, and by the same means: the creditor gets a FIGURE instead of their coupons, on their
 * Settlement card. A purchase is that agreement outright (V50), and a sale is it at the price the
 * market paid, once the sale says whose pieces were in it (V56). Do not read back in the rule that a
 * sale of a mixed pile answers for nothing: the debt is on the other ledger in mesos.
 */
export function settledOf(ledger: HolderLedger, heldOfYours: HeldOfYours = new Map()): number {
  // What the spend consumed, not `ledger.answered`: that total is the PILE's, so one creditor's sale
  // would count against another's debt.
  return owes(ledger, heldOfYours) - outstandingOf(ledger, heldOfYours);
}

/**
 * Whether the card has a question, or is only somewhere a sale MAY be recorded.
 *
 * What is asked is the DEBT, not the pile: nothing is derived from what became of coupons nobody is
 * owed. Over-entry still asks, whoever holds the pile, because more entered than the pile holds is a
 * miscount.
 */
export function asksAnything(ledger: HolderLedger, heldOfYours: HeldOfYours = new Map()): boolean {
  return outstandingOf(ledger, heldOfYours) > 0 || ledger.accounted > ledger.pieces;
}

/** One night under a pile, as the queue reads it. */
type Night = HolderLedger["drops"][number];

/**
 * ONE spend of everything that has answered this pile's debt, night by night and creditor by
 * creditor. Every figure the card states about a debt comes off this, so the Sale Ledger and the
 * Settlement Ledger cannot reduce one night to two different figures.
 *
 * Credit is a creditor's own coupons sitting in your inventory plus what a sale has already answered
 * for them, the same pair the Settlement Ledger cancels and V56 prices.
 *
 * Sales first, NEWEST night first (spendSales), then their own coupons, oldest night first, matching
 * the Settlement Ledger. Not the order the rows are DRAWN in, which is the catalog's.
 *
 * Leftover credit goes unspent: the same floor `owes` applies.
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
  // stacks. Identity holds because the nights are only copied once the spend is finished.
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
    // Sales first, each reaching only the nights it could have answered, then the cancellation,
    // which reaches all of them. The same order settleCouponNights spends in.
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
 * A night that divided the way it fell, or whose debt has been ANSWERED, leaves nothing here to act
 * on. `clean` and `answered` are counts the tests pin. A CLOSED night is none of the three: see
 * lib/settled-log.ts.
 */
export function queueOf(
  ledger: HolderLedger,
  heldOfYours: HeldOfYours = new Map(),
): { owing: Night[]; clean: number; answered: number } {
  const open = ledger.drops.filter((d) => !d.closed);
  // REDUCED, not merely filtered: a part-answered night is listed at what is left on it.
  const { nights, folded } = spendAnswered(ledger, heldOfYours);
  return {
    owing: nights.filter((n) => !folded.has(n.lootId)),
    clean: open.length - nights.length,
    answered: folded.size,
  };
}

/**
 * What this pile still owes: the card header's one figure.
 */
export function outstandingOf(ledger: HolderLedger, heldOfYours: HeldOfYours = new Map()): number {
  // Off the same spend as the rows, so the header and its queue cannot disagree.
  let total = 0;
  for (const pieces of spendAnswered(ledger, heldOfYours).left.values()) total += pieces;
  return Math.max(0, total - unattributed(ledger));
}

/**
 * Pieces a purchase answered for without saying whose they were.
 *
 * V50: a purchase is one creditor's in full. `answeredByPair` refuses to guess WHICH, because naming
 * one would discharge a debt against somebody who never agreed to it. They come off the pile's total
 * alone, so the header can read below what its rows come to, and only ever below. Zero for every
 * tranche entered since V56, all of which name their shares.
 */
function unattributed(ledger: HolderLedger): number {
  let named = 0;
  for (const sales of ledger.answeredByCreditor.values()) named += piecesOf(sales);
  return Math.max(0, ledger.answered - named);
}

/** What a run of sales comes to. See answeredSalesByPair. */
function piecesOf(sales: AnsweredSale[] | undefined): number {
  return (sales ?? []).reduce((sum, sale) => sum + sale.pieces, 0);
}

/**
 * Your own piles, split by whether the Sale Ledger has a reason to draw one.
 *
 * A pile that owes somebody, or one with a row still to deal with, is a card. `recorded` should count
 * only sales `stillAsking` keeps, or a pile would be a card with nothing on it.
 *
 * Nothing renders `quiet`, so no sale can be entered against a pile until it owes somebody again. A
 * pile whose every night is CLOSED is quiet whatever it has recorded.
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
 * owe you (see decidedSales). NAMING a creditor is not finished: the money sits in your hands as
 * theirs until it is decided.
 *
 * Dropped, not folded behind a count. Taking the settling act off the other person's Settlement card
 * brings the sale back here.
 *
 * A share naming the pile's own holder does not count as naming anybody. Same rule as
 * `answeredByPair`, or a sale the two disagree about would vanish while still asking.
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
    // EVERY creditor, since one sale can hold two people's coupons.
    return !(named.length > 0 && named.every((creditor) => decided.get(tranche.id)?.has(creditor)));
  });
}
