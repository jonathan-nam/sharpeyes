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
 * The coupon's own row, off whichever boss table carries it. Sprite and name both come off it.
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
 * The intermediates are returned for the Drop Log's other stages. Any screen that states these
 * figures must call this rather than rebuild the chain.
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

  // The catalog's order, so two bosses cleared in one week never swap and re-price each other.
  const bossOrder = new Map(bosses.map((b, i) => [b.bossKey, i]));
  const closures = closedByHolder(settlements);
  const settled = outstanding(parties, pools, VESTIGE, bossOrder);
  // Plus your own coupons from nights that owed nobody, which are still yours to sell.
  const ledgers = holderLedgers(
    [...settled, ...alsoHeldByYou(parties, pools, VESTIGE, bossOrder, settled)],
    salesByHolder(tranches),
    keptByHolder(tranches),
    boughtByHolder(tranches),
    receivedByHolder(payments),
    closures,
    answeredByHolder(tranches),
    answeredSalesByPair(tranches),
  );
  // People first, so a holder is named after their seat has left every party. Seats then win, as
  // they carry the name as this account spells it.
  const holderNames = new Map<string, string>();
  for (const person of people) holderNames.set(`person:${person.id}`, person.name);
  for (const party of parties) {
    for (const seat of foldSeats(party.seats)) holderNames.set(seat.key, seat.name);
  }
  const wallet = buildWallet(parties, pools);
  // The shares an offset discharged, splitting only the drops an offset names. Off the pools, since
  // an offset marks its shares PAID and they leave the wallet. See V58.
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
        // In its own unit: `saleAmount` alone is null for a dollar sale.
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
            // Off the same split as the share, so the roster matches the divisor.
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
  // What sales of somebody else's coupons came to, returned for the Sale Ledger. See decidedSales.
  const credits = saleCredits(tranches);
  const settlement = buildSettlement(
    ledgers,
    wallet,
    debts,
    credits,
    // Only what no closure has already spoken for, or a spent payment counts twice.
    receivedSinceClosing(payments, settlements),
    holderNames,
    new Set(people.filter((p) => p.pinned).map((p) => `person:${p.id}`)),
    // The pieces a priced tranche already spoke for, per pair. Always pass it alongside
    // `saleCredits` (the money the same rows came to), or this card and the Sale Ledger disagree.
    answeredSalesByPair(tranches),
    // An empty list means undecided. See V61.
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
    totals: settlementTotals(settlement),
  };
}
