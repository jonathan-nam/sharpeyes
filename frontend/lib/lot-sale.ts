// Selling a pile of one interchangeable drop in one go, instead of pricing each row where it sits.
//
// Some drops are the same as each other: an unopened armour box is any unopened armour box, and a
// grindstone is a grindstone. You dump four of them at the going rate, and WHICH four went is not a
// fact anybody has. So the sale is entered once, against a queue, and the rows it covers are worked
// out here rather than navigated to.
//
// That is only honest because of what those drops ARE, which is why the catalog says so per drop
// (`fungible` in catalog/drops.yaml). A Whisper of the Source has its own potential lines and its own
// price, so two of them are two different sales, and a queue that picked one would file a sale
// against a party that did not make it. See the note on `proposeLot`.
//
// Which is why `rowSales` is here too: those drops are sold from the Drop Log as well, a card per
// row rather than a queue, and the two lists must not overlap. Both read the same `fungible` set,
// so nothing can be offered twice and nothing can fall between them.
//
// NOTHING here is a second splitter. A row, once priced, goes through the ordinary sale: splitOf(),
// which is splitDrop(). The only arithmetic in this file is dividing the lot's mesos across the rows
// it covers, and that is piece-ledger's largestRemainder, so the slices add up to exactly what was
// entered.

import { isPieceDrop } from "./drop-log";
import { largestRemainder } from "./piece-ledger";
import { holderKey, holderOf } from "./vestige-ledger";
import { canTrade } from "./world";
import type { DropTables } from "@/types/drop";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

/**
 * Every drop key whose copies are interchangeable, off the catalog's own tables.
 *
 * Collected across all of them rather than read per boss: the flag is a property of the item, so
 * every table that lists it carries the same answer, and a row whose boss is not recorded still
 * needs one. Same reasoning as the comment in catalog/drops.yaml about where flags sit.
 */
export function fungibleDropKeys(dropTables: DropTables): Set<string> {
  const keys = new Set<string>();
  for (const table of Object.values(dropTables)) {
    for (const drop of table) {
      if (drop.fungible) keys.add(drop.dropKey);
    }
  }
  return keys;
}

/** One unsold row a sale could be filed against, with everything that sale needs. */
export type LotRow = {
  lootId: string;
  partyId: string;
  /**
   * Units of the lot this row is. What FELL, so a row of three grindstones is three of them.
   *
   * The row is priced whole or not at all, which is what makes a lot land on row boundaries: half a
   * row sold would need a sale amount for a part of a row, and the row has one.
   */
  units: number;
  name: string;
  iconUrl: string | null;
  bossKey: string | null;
  droppedOn: string;
  weekStart: string;
  /** Which of your characters' pools it is in, for the row to name. */
  characterId: string;
  /** The seat the sale will name as seller. Had to have run that week, which the server checks. */
  sellerMemberId: string;
  sellerName: string;
  /**
   * The seats that ran that week: who this row divides between, and what the card's share boxes are
   * one of each. Every seat, not only the uneven ones, so a lot that does not divide is tellable
   * from one that does.
   */
  ran: PartyMember[];
};

/**
 * Every unsold row a sale could be filed against, oldest first, narrowed by `wanted`.
 *
 * By `droppedOn`, which is the Drop Log's own order and the plain reading of "the oldest ones went
 * first". The loot id breaks ties, so two drops logged the same day keep one order and the queue
 * cannot shuffle between reads.
 *
 * A row is only here when the holder has a seat that RAN that week: they are who the sale names as
 * seller, and the server refuses a seller who was not there. So a lot is one person's, and a pool
 * where they did not run is not theirs to price.
 *
 * Shared by the two ways a drop is priced from the Drop Log, a queue of interchangeable copies and
 * a row of its own, so which rows are sellable at all is decided once.
 */
function sellableRows(
  parties: Party[],
  pools: PartyLootPool[],
  /** Whose rows these are, as holderKey() spells it. `SELF_KEY` is yours. */
  holder: string,
  wanted: (loot: Loot, party: Party) => boolean,
): LotRow[] {
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const rows: LotRow[] = [];

  for (const pool of pools) {
    const party = partyById.get(pool.partyId);
    // Heroic worlds do not trade, so nothing in that pool can be sold at all. The server refuses it
    // too; this is what keeps it off the queue rather than the whole of the rule. See lib/world.ts.
    if (!party || !canTrade(party.worldType)) continue;

    for (const loot of pool.loot) {
      if (loot.soldAt !== null || loot.quantity < 1 || !wanted(loot, party)) continue;

      const ran = party.seats.filter((s) => loot.ranThatWeek.includes(s.id));
      const seller = ran.find((s) => holderKey(holderOf(s)) === holder);
      if (!seller) continue;

      rows.push({
        lootId: loot.id,
        partyId: pool.partyId,
        units: loot.quantity,
        name: loot.name,
        iconUrl: loot.iconUrl,
        bossKey: loot.bossKey,
        droppedOn: loot.droppedOn,
        weekStart: loot.weekStart,
        characterId: party.characterId,
        sellerMemberId: seller.id,
        sellerName: seller.name,
        ran,
      });
    }
  }

  return rows.sort(
    (a, b) => a.droppedOn.localeCompare(b.droppedOn) || a.lootId.localeCompare(b.lootId),
  );
}

/** The unsold rows of one interchangeable drop that a lot could cover, oldest first. */
export function lotQueue(
  parties: Party[],
  pools: PartyLootPool[],
  dropKey: string,
  holder: string,
): LotRow[] {
  return sellableRows(parties, pools, holder, (loot) => loot.dropKey === dropKey);
}

/**
 * One share each, keyed by seat id. What a lot pins where nobody typed a ratio.
 *
 * Even, never seeded from `party_member.shares`: that is the stack entitlement the party config
 * writes, and a party on 1:2 vestige stacks sold every lot of grindstones 1:2 and said so nowhere.
 * See the note in loot-row.tsx.
 */
export function evenShares(ran: PartyMember[]): Record<string, number> {
  return Object.fromEntries(ran.map((s) => [s.id, 1]));
}

/**
 * The seats a set of share boxes stands for: the names that ran, in the order the row lists them.
 *
 * By NAME, and keyed by the sorted names, because one lot spans pools and a person holds a
 * different seat id in each. Rows that the same people ran take one set of boxes, which is what
 * makes a four-week pile of grindstones one ratio to type rather than four.
 */
export type LotRoster = {
  key: string;
  names: string[];
};

export function rosterOf(row: LotRow): LotRoster {
  const names = row.ran.map((s) => s.name);
  return { key: [...names].sort().join("\u0000"), names };
}

/**
 * The distinct rosters among the rows a lot covers, in queue order.
 *
 * Only the rows that divide: a solo row has nobody to divide with, and a box beside one name would
 * be a ratio against nothing.
 */
export function lotRosters(rows: LotRow[]): LotRoster[] {
  const seen = new Map<string, LotRoster>();
  for (const row of rows) {
    if (row.ran.length < 2) continue;
    const roster = rosterOf(row);
    if (!seen.has(roster.key)) seen.set(roster.key, roster);
  }
  return [...seen.values()];
}

/** What one row of a lot divides by: the counts typed against its roster, or one each. */
export function rowShares(row: LotRow, typed: LotShares): Record<string, number> {
  const counts = typed[rosterOf(row).key];
  if (!counts) return evenShares(row.ran);
  return Object.fromEntries(row.ran.map((s) => [s.id, counts[s.name] ?? 1]));
}

/** Share counts as the card holds them: per roster, then per name. */
export type LotShares = Record<string, Record<string, number>>;

/** Which rows a lot of this size covers, or why it covers none. */
export type LotProposal = {
  /** The rows it would sell, oldest first. Empty when the count cannot be made. */
  rows: LotRow[];
  /** Units those rows come to. Equal to the count asked for whenever `rows` is not empty. */
  units: number;
  /**
   * The unit counts this queue CAN make, in order, when the one asked for falls between rows.
   *
   * Named rather than rounded to the nearest. A row is sold whole, so a count that lands mid-row is
   * a count nobody can act on, and quietly selling the nearest number of rows would file a sale for
   * a quantity that was never entered.
   */
  reachable: number[];
};

/**
 * The oldest rows adding up to exactly this many units.
 *
 * A proposal, not an answer: the point of showing it is that somebody confirms it before anything is
 * written. What a queue cannot know is which of several identical drops actually left the inventory,
 * and for these drops nobody knows, which is the whole reason FIFO is honest here and would not be
 * for a drop that has its own price.
 *
 * Refuses rather than rounds when the count does not land on a row boundary. Every prefix that IS
 * reachable is named, so "3 grindstones" against rows of two says what can be sold instead.
 */
export function proposeLot(queue: LotRow[], units: number): LotProposal {
  const rows: LotRow[] = [];
  let covered = 0;
  for (const row of queue) {
    if (covered + row.units > units) break;
    rows.push(row);
    covered += row.units;
  }
  if (units >= 1 && covered === units) return { rows, units: covered, reachable: [] };

  // Every prefix, not only the ones under the count: somebody who typed 3 against rows of two is
  // choosing between 2 and 4, and naming only 2 hides the other half of the choice. Empty above,
  // where there is nothing to offer instead.
  const sums: number[] = [];
  let running = 0;
  for (const row of queue) {
    running += row.units;
    sums.push(running);
  }
  return { rows: [], units: 0, reachable: sums };
}

/**
 * The counts nearest the one asked for that the queue can actually make.
 *
 * At most two, one either side. The choice is which way to round to a whole row, and every prefix
 * of the queue is a list rather than a choice: three grindstones against rows of two is a decision
 * between two and four, and the other eleven sums do not help make it.
 */
export function nearestCounts(reachable: number[], asked: number): number[] {
  const below = reachable.filter((n) => n < asked).pop();
  const above = reachable.find((n) => n > asked);
  return [below, above].filter((n): n is number => n !== undefined);
}

/** One row of a lot, priced. Mirrors backend's LotSaleRow. */
export type LotSaleRowBody = {
  partyId: string;
  lootId: string;
  amount: number;
  sellerMemberId: string;
  shares: Record<string, number>;
};

/** POST /api/parties/loot/lot. Mirrors backend's LotSaleRequest. */
export type LotSaleBody = {
  dropKey: string;
  total: number;
  amountBasis: string;
  splitMethod: string;
  rows: LotSaleRowBody[];
};

/**
 * What each row of the lot sold for: the total split across them by how many units each holds.
 *
 * Largest remainder, so the slices add up to EXACTLY what was entered. A per-unit price rounded and
 * then multiplied out would not: 1b across three rows is 333,333,333 each and a meso short of the
 * sale, and every figure downstream would look ordinary while the party was quietly under-paid by
 * it. The server checks this sum for the same reason.
 *
 * Positional with `rows`.
 */
export function priceLot(total: number, rows: LotRow[]): number[] {
  return largestRemainder(
    total,
    rows.map((r) => r.units),
  );
}

/** The request for a proposal somebody has confirmed. Priced here, so one place divides the lot. */
export function lotSaleBody(
  dropKey: string,
  total: number,
  amountBasis: string,
  splitMethod: string,
  rows: LotRow[],
  /** What was typed into the share boxes. Absent is an even split, which is what they open on. */
  typed: LotShares = {},
): LotSaleBody {
  const amounts = priceLot(total, rows);
  return {
    dropKey,
    total,
    amountBasis,
    splitMethod,
    rows: rows.map((row, i) => ({
      partyId: row.partyId,
      lootId: row.lootId,
      amount: amounts[i] ?? 0,
      sellerMemberId: row.sellerMemberId,
      shares: rowShares(row, typed),
    })),
  };
}

/** One drop with a queue behind it. What the page draws a panel per. */
export type LotDrop = {
  dropKey: string;
  name: string;
  iconUrl: string | null;
  queue: LotRow[];
  /** Units across the whole queue. What the panel counts down. */
  units: number;
};

/**
 * Every interchangeable drop you are holding unsold, most rows first.
 *
 * Only the ones with something to sell: a panel for a drop whose queue is empty is a box that
 * refuses everything typed into it. Ordered by how much is waiting, so the pile that has been
 * building is the one at the top, and by name so two equal piles keep one order.
 */
export function lotDrops(
  parties: Party[],
  pools: PartyLootPool[],
  fungible: Set<string>,
  holder: string,
): LotDrop[] {
  const out: LotDrop[] = [];
  for (const dropKey of fungible) {
    const queue = lotQueue(parties, pools, dropKey, holder);
    if (queue.length === 0) continue;
    out.push({
      dropKey,
      name: queue[0]!.name,
      iconUrl: queue[0]!.iconUrl,
      queue,
      units: queue.reduce((sum, r) => sum + r.units, 0),
    });
  }
  return out.sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
}

/**
 * Every unsold drop of yours that prices ALONE, oldest first.
 *
 * The complement of the lots above, and the four accessories, the four hammers, the selection box
 * and the two rings are all in it. Each has its own potential lines and its own price, so a queue
 * holding two of them could only guess which one went, which is why they are out of `fungible` and
 * why each gets a card naming ONE row instead. A row somebody points at raises no such question.
 *
 * Piece drops are out. They divide by COUNT and are settled in tranches, so pricing one here would
 * be a second settlement for a drop the piece ledger is already counting.
 *
 * Free text is in. A drop typed by hand has no catalog row to call it interchangeable, and it is
 * still something you sold.
 */
export function rowSales(
  parties: Party[],
  pools: PartyLootPool[],
  dropTables: DropTables,
  fungible: Set<string>,
  holder: string,
): LotRow[] {
  return sellableRows(
    parties,
    pools,
    holder,
    (loot, party) => !fungible.has(loot.dropKey ?? "") && !isPieceDrop(loot, party, dropTables),
  );
}
