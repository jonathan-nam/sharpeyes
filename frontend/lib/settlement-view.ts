import { bossLabel } from "@/lib/boss-difficulty";
import { saleMoney, splitOf } from "@/lib/loot";
import { buildSettlement, type OffsetShare, settlementTotals, shareKey } from "@/lib/settlement";
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
import type { DropTables } from "@/types/drop";
import type { DropLogPage } from "@/types/page";

// The stacking drop the piece ledger is for. See lib/piece-ledger.ts.
export const VESTIGE = "vestige-of-erion";

/**
 * The coupon's own row, off whichever boss table carries it. Every table names the same drop, and
 * both its sprite and its name come off the one row so a card cannot draw one item and name
 * another.
 */
export function vestigeOf(dropTables: DropTables) {
  return (
    Object.values(dropTables)
      .flat()
      .find((drop) => drop.dropKey === VESTIGE) ?? null
  );
}

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
  // The shares an offset discharged, resolved. Only the drops an offset actually names, because
  // splitting every loot row in every pool to answer for a handful would be a pass over the whole
  // account on every render.
  //
  // Off the pools, since an offset marks its shares PAID and they leave the wallet. See V58.
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  const offsetShares = new Map<string, OffsetShare>();
  const wanted = new Set(debts.flatMap((d) => d.payouts.map((s) => s.lootId)));
  if (wanted.size > 0) {
    for (const pool of pools) {
      const party = partyById.get(pool.partyId);
      if (!party) continue;
      for (const loot of pool.loot) {
        if (!wanted.has(loot.id)) continue;
        const split = splitOf(loot, party.seats);
        if (split === null) continue;
        // The sale in its own unit, so the row's "sold for" and the share under it agree. Reading
        // `saleAmount` alone would print nothing at all for a sale made in real money.
        const sold = saleMoney(loot);
        const boss = bossByKey.get(loot.bossKey ?? "");
        for (const share of split.shares) {
          offsetShares.set(shareKey(loot.id, share.memberId), {
            key: shareKey(loot.id, share.memberId),
            lootId: loot.id,
            memberId: share.memberId,
            item: loot.name,
            iconUrl: loot.iconUrl,
            boss: boss ? bossLabel(boss.name, party.difficulty) : "–",
            // Everybody the night paid out to, which is who was in it. Off the same split the share
            // came from, so the row cannot name a roster the figure was not divided by.
            members: split.shares.map((s) => s.name),
            on: loot.droppedOn,
            weekStart: loot.weekStart,
            share: share.pay,
            sale: sold?.amount ?? null,
            currency: split.currency,
            partyId: pool.partyId,
          });
        }
      }
    }
  }
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
    offsetShares,
    credits,
    settlement,
    // The three tiles above the cards, off the cards themselves. See settlementTotals.
    totals: settlementTotals(settlement),
  };
}
