import { buildSettlement, settlementTotals } from "@/lib/settlement";
import {
  alsoHeldByYou,
  answeredByHolder,
  answeredSalesByPair,
  boughtByHolder,
  closedByHolder,
  foldSeats,
  holderLedgers,
  keptByHolder,
  outstanding,
  receivedByHolder,
  receivedSinceClosing,
  saleCredits,
  salesByHolder,
} from "@/lib/vestige-ledger";
import { buildWallet } from "@/lib/wallet";
import type { DropLogPage } from "@/types/page";

// The stacking drop the piece ledger is for. See lib/piece-ledger.ts.
const VESTIGE = "vestige-of-erion";

/**
 * The Settlement stage's figures off the Drop Log payload.
 *
 * One function for every screen that states them, so the home widget and the Drop Log cannot
 * disagree about what somebody owes. The intermediates are returned because the Drop Log reads
 * them for its other stages.
 */
export function settlementView(
  page: Pick<
    DropLogPage,
    | "parties"
    | "pools"
    | "bosses"
    | "people"
    | "tranches"
    | "payments"
    | "settlements"
    | "debts"
    | "disposals"
  >,
) {
  const { parties, pools, bosses, people, tranches, payments, settlements, debts, disposals } =
    page;

  // The catalog's own order, which is what /api/bosses returns, so two bosses cleared in one week
  // never swap places in the queue and re-price each other.
  const bossOrder = new Map(bosses.map((b, i) => [b.bossKey, i]));
  const closures = closedByHolder(settlements);
  const settled = outstanding(parties, pools, VESTIGE, bossOrder);
  // Your own coupons from the nights that owed nobody anything, which the queue above leaves out.
  // They are yours to sell, so the card that takes a sale has to know you are holding them.
  const ledgers = holderLedgers(
    [...settled, ...alsoHeldByYou(parties, pools, VESTIGE, bossOrder, settled)],
    salesByHolder(tranches),
    keptByHolder(tranches),
    boughtByHolder(tranches),
    receivedByHolder(payments),
    closures,
    answeredByHolder(tranches),
    // The same pieces per creditor, which is what lets a night the sales already answered stay off
    // the queue when a later one is logged. See foldAnswered.
    answeredSalesByPair(tranches),
  );
  // Somebody a debt can name but no open drop does. The people list first, so somebody who is owed
  // something is named even after their seat has left every party. Seats then win, because a seat
  // carries the name as this account spells it.
  const holderNames = new Map<string, string>();
  for (const person of people) holderNames.set(`person:${person.id}`, person.name);
  for (const party of parties) {
    for (const seat of foldSeats(party.seats)) holderNames.set(seat.key, seat.name);
  }
  const wallet = buildWallet(parties, pools);
  // What sales of somebody else's coupons came to. Held rather than passed inline: the Sale Ledger's
  // fold reads the same figures, and two calls is two lists to fall out of step. See decidedSales.
  const credits = saleCredits(tranches);
  const settlement = buildSettlement(
    ledgers,
    wallet,
    debts,
    credits,
    // Only what no closure has already spoken for. A payment that settled a pile is spent, and
    // counting it again takes it off the next thing entered against that person. See #350.
    receivedSinceClosing(payments, settlements),
    holderNames,
    new Set(people.filter((p) => p.pinned).map((p) => `person:${p.id}`)),
    // The pieces a priced tranche already spoke for, per pair. `saleCredits` above is the money the
    // same rows came to, and passing one without the other is what had this card asking Bro for 130
    // coupons while the Sale Ledger, subtracting the 70 he had been sold, asked for 60.
    answeredSalesByPair(tranches),
    // What has been decided about their money, and nothing more. An empty list means undecided,
    // which is the honest state for a sale nobody has said anything about. See V61.
    disposals,
  );

  return {
    bossOrder,
    closures,
    settled,
    ledgers,
    holderNames,
    wallet,
    credits,
    settlement,
    // The three tiles above the cards, off the cards themselves. See settlementTotals.
    totals: settlementTotals(settlement),
  };
}
