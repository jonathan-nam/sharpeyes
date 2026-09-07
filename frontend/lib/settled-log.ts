// What is finished, and how it got that way.
//
// The last stage of one pipeline: a drop is logged, its pieces are sold or its item is priced, what
// that leaves owed is settled, and then it is done. The first three stages are worklists and this
// one is a record, which is the whole difference: nothing here is waiting on anybody, so nothing
// here is asked for. It exists so the earlier stages can stop carrying finished rows, and so what
// they stopped carrying is still somewhere.
//
// NOT a second reader. Every field comes off buildDropLog's entries, which is splitOf()'s money and
// couponGapOf()'s pieces. The one thing this file adds is which ACT finished a row, and that is read
// off the settlements rather than worked out: whether a debt is done is a decision, and this file has
// no more way to reach one than drop-log.ts does.
//
// A row can be finished twice over and honestly. One night's coupons sit in as many piles as there
// were people bending down, and closing the books with Bro says nothing about Jared, so a night
// settled with both is TWO records. Folding them would name one person and quietly drop the other.

import type { DropEntry } from "./drop-log";
import type { Currency } from "./money";
import { NO_COUPON_MONEY, holderKey } from "./vestige-ledger";
import type { CouponMoney } from "./vestige-ledger";
import type { VestigeSettlement } from "@/types/vestige";

/** One finished thing: what it was, what it came to, and the act that ended it. */
export type SettledRecord = {
  /** One act on one drop. Stable, so a row keeps its place when the list is redrawn. */
  key: string;
  lootId: string;
  partyId: string;
  /** Whose config it fell on, so the view reads one character at a time like the log does. */
  characterId: string;
  name: string;
  iconUrl: string | null;
  bossKey: string | null;
  droppedOn: string;
  weekStart: string;
  /** What FELL, as V40 files it. */
  quantity: number;
  /**
   * Which pipeline it came down.
   *
   * MONEY is one item that sold for one price and divided as money. PIECES is a stack the party
   * divides by count, whose debt is in coupons and is closed by somebody deciding. The two are not
   * comparable and are never added: see the totals below.
   */
  kind: "MONEY" | "PIECES";
  /**
   * The day it was finished, as the act recorded it. Null on a drop that was taken rather than sold,
   * where nothing was owed and so nothing was ever settled.
   */
  settledOn: string | null;
  /** What it sold for and what that left to divide. Null on a coupon night, which has no one price. */
  sale: {
    amount: number;
    /** The unit `amount`, `pooled` and `yourTake` are in. Cents when USD. See lib/money.ts. */
    currency: Currency;
    /** LISTED, RECEIVED or BOUGHT. What the amount MEANS, which is why it is never dropped. */
    basis: string | null;
    /** What there was to split, fee already off. Null when the split names a seat that has left. */
    pooled: number | null;
    /** Your side of it. Null for the same reason. */
    yourTake: number | null;
    seller: string | null;
  } | null;
  /** Who took it, on a drop that cannot be sold. Null everywhere else. */
  takenBy: string | null;
  /** Who the books were closed with. Null on a money drop, which is settled with the whole party. */
  holderName: string | null;
  /** Pieces of the night that were in that holder's hands. Zero on a money drop. */
  pieces: number;
  /**
   * Mesos the act wrote off, spread over the drops it closed.
   *
   * A settlement records ONE figure for the whole act, so a row's share of it is that figure divided
   * by the drops closed with it. Said rather than left off, because a write-off is a decision, and
   * shown per row rather than once because a row is what the reader is looking at. The remainder goes
   * to the first row so the shares add back up to what was written off.
   */
  writtenOff: number;
  /** The act, so it can be taken back off. Null on a money drop, which has no act to undo. */
  settlementId: string | null;
};

/**
 * A settlement's write-off, spread over the drops it closed.
 *
 * Whole mesos that add up to exactly the figure entered, the remainder on the first row. The same
 * property largestRemainder gives the pieces, for the same reason: a total that does not add back up
 * is a wrong number wherever the reader happens to sum it.
 */
function shareOfWriteOff(unpaid: number, drops: number, index: number): number {
  if (drops < 1 || unpaid < 1) return 0;
  const each = Math.floor(unpaid / drops);
  return index === 0 ? each + (unpaid - each * drops) : each;
}

/**
 * Everything finished, newest first.
 *
 * Both kinds in one list, because "what happened to this drop" is one question however the drop
 * divided. They are kept apart by `kind` rather than by being two views: a reader looking for a
 * night knows the boss and the week, not which pipeline the app filed it under.
 */
export function buildSettledLog(
  entries: DropEntry[],
  /** The acts that closed the coupon nights. See V52. */
  settlements: VestigeSettlement[] = [],
  /** What to call a holder, keyed the way holderKey() spells them. */
  names: Map<string, string> = new Map(),
): SettledRecord[] {
  const byLoot = new Map(entries.map((e) => [e.lootId, e]));
  const out: SettledRecord[] = [];

  for (const entry of entries) {
    // A piece drop is settled through the tranche ledger and never through a sale on its own row, so
    // its status stays PENDING for ever. Reading the status here would file every coupon night the
    // account has ever had as unfinished.
    if (entry.pieces) continue;
    if (entry.status !== "PAID_OUT" && entry.status !== "TAKEN") continue;

    const taken = entry.status === "TAKEN";
    out.push({
      key: `loot:${entry.lootId}`,
      lootId: entry.lootId,
      partyId: entry.partyId,
      characterId: entry.characterId,
      name: entry.name,
      iconUrl: entry.iconUrl,
      bossKey: entry.bossKey,
      droppedOn: entry.droppedOn,
      weekStart: entry.weekStart,
      quantity: entry.quantity,
      kind: "MONEY",
      settledOn: taken ? null : entry.soldAt,
      sale:
        taken || entry.saleAmount === null
          ? null
          : {
              amount: entry.saleAmount,
              currency: entry.currency,
              basis: entry.amountBasis,
              pooled: entry.pooled,
              yourTake: entry.yourTake,
              seller: entry.sellerName,
            },
      takenBy: taken ? entry.takenByName : null,
      holderName: null,
      pieces: 0,
      writtenOff: 0,
      settlementId: null,
    });
  }

  for (const act of settlements) {
    const key = holderKey(act.holder);
    const name = names.get(key) ?? key;
    // Ordered, so which row carries the odd meso of a write-off does not depend on the order the
    // ids came back in.
    const closed = [...act.lootIds].sort();
    closed.forEach((lootId, i) => {
      const entry = byLoot.get(lootId);
      // A settlement whose drop is not in the log is not silently dropped: it is a row the pool no
      // longer has, which the caller says out loud. See `orphansOf`.
      if (!entry) return;
      out.push({
        key: `settlement:${act.id}:${lootId}`,
        lootId,
        partyId: entry.partyId,
        characterId: entry.characterId,
        name: entry.name,
        iconUrl: entry.iconUrl,
        bossKey: entry.bossKey,
        droppedOn: entry.droppedOn,
        weekStart: entry.weekStart,
        quantity: entry.quantity,
        kind: "PIECES",
        settledOn: act.settledAt,
        sale: null,
        takenBy: null,
        holderName: name,
        // What that holder was holding of it. The gap, never the whole night: a night you looted four
        // stacks of six on owes nothing even though a partner was there.
        pieces: entry.owedToYou > 0 ? entry.owedToYou : entry.owedByYou,
        writtenOff: shareOfWriteOff(act.unpaid, closed.length, i),
        settlementId: act.id,
      });
    });
  }

  // Newest first, like the log. Ties on the drop's own day, then the id, so two acts on one day keep
  // one order however the rows arrived.
  return out.sort(
    (a, b) =>
      (b.settledOn ?? b.droppedOn).localeCompare(a.settledOn ?? a.droppedOn) ||
      b.droppedOn.localeCompare(a.droppedOn) ||
      a.key.localeCompare(b.key),
  );
}

/**
 * Settlements naming a drop the pool no longer has.
 *
 * Counted rather than skipped. A settlement is only ever deleted along with its drop, so this is
 * zero on any account nobody has been editing the database of, and a count that changed still gets
 * said. See CLAUDE.md.
 */
export function orphansOf(entries: DropEntry[], settlements: VestigeSettlement[]): number {
  const known = new Set(entries.map((e) => e.lootId));
  return settlements.reduce(
    (sum, act) => sum + act.lootIds.filter((id) => !known.has(id)).length,
    0,
  );
}

/** One line of the view: a single record, or the nights one act closed together. */
export type SettledLine = {
  /** The act when this is a fold, the record's own key when it stands for one row. */
  key: string;
  /** The rows behind it, newest first. Exactly one unless this is a fold. */
  records: SettledRecord[];
  /** True when it stands for more than one, so the line counts instead of naming. */
  folded: boolean;
  /** Coupons across every night behind it. Zero on a money line. */
  pieces: number;
  /** Mesos written off across them, which is the act's own figure put back together. */
  writtenOff: number;
};

/**
 * The records as lines, folding the nights ONE ACT closed.
 *
 * A settlement usually closes several nights at once, so drawn flat it is a row per night saying the
 * same thing about the same person on the same day: five for one act on this account, and one per
 * boss per week for ever after. The act is the honest unit anyway, because "how it was settled" is a
 * property of the act and not of any one night behind it.
 *
 * By the ACT and never by the person. Two settlements with Bro a month apart are two decisions, and
 * folding them together would put one date on both.
 *
 * A money drop is its own line always. Each sold separately, at its own price, and nothing groups
 * them: a fold would be a heading over unrelated rows.
 *
 * Order is kept from the records, so a fold sits where its newest night sat.
 */
export function consolidateSettled(rows: SettledRecord[]): SettledLine[] {
  const at = new Map<string, number>();
  const out: SettledLine[] = [];

  for (const row of rows) {
    const act = row.settlementId;
    if (act === null) {
      out.push({ key: row.key, records: [row], folded: false, pieces: 0, writtenOff: 0 });
      continue;
    }
    const seen = at.get(act);
    if (seen === undefined) {
      at.set(act, out.length);
      out.push({
        key: `settlement:${act}`,
        records: [row],
        folded: false,
        pieces: row.pieces,
        writtenOff: row.writtenOff,
      });
      continue;
    }
    const line = out[seen]!;
    line.records.push(row);
    line.folded = true;
    line.pieces += row.pieces;
    line.writtenOff += row.writtenOff;
  }
  return out;
}

/** What the view says above the rows. The two kinds counted apart, because they do not add. */
export type SettledTotals = {
  /** Coupon nights whose books were closed. */
  nights: number;
  /** Drops that sold and paid out. */
  sales: number;
  /** Drops taken rather than sold, where nothing was owed. */
  taken: number;
  /**
   * What there was to split across the sales, never the sum of what they sold for.
   *
   * A drop entered as "listed for 10b" and one entered as "received 9.5b" are different quantities,
   * one before the Auction House cut and one after, and adding them is the confident wrong number
   * this repo exists to prevent. Same total, same reason, as the Drop Log's. See drop-log.ts.
   *
   * The coupon sales are in it and are on NO ROW, so this is the one figure here that does not add
   * back up to the rows beneath it. A coupon night has no one price: its pieces sell in lots that
   * name no night, so the money can be stated whole or not at all, and leaving it out made this
   * every sale the account has made except the vestiges.
   */
  pooled: number;
  /**
   * Your share of the above, which is the one figure here that is yours rather than the party's.
   *
   * The Drop Ledger totalled this per month and no longer states a meso, sale figures being this
   * view's. Off the same sales as `pooled`, coupon lots included, so the two cannot come to
   * different sets of them.
   */
  yourTake: number;
  /** Mesos written off closing the nights. A decision, so it is said rather than absorbed. */
  writtenOff: number;
  /**
   * Sales whose split names a seat that has left its party, so no figure can be read off them.
   *
   * In neither total above, and counted here rather than left out: an absence nothing says is the
   * silent wrong number. It was the Drop Ledger's note while that page carried the totals.
   */
  unreadable: number;
  /**
   * The same pair over sales made in real money, in cents.
   *
   * Its own pair for the reason the coupon COUNT is not in the meso totals: two units, no rate
   * between them, so the only honest total is two totals. The coupon money is not in it, coupons
   * having never been sold for dollars. See lib/money.ts.
   */
  usd: { pooled: number; yourTake: number };
};

/** One unit's share of one column of one row, so the two units are summed apart. See SettledTotals. */
function saleIn(row: SettledRecord, currency: Currency, key: "pooled" | "yourTake"): number {
  if (row.sale === null || row.sale.currency !== currency) return 0;
  return row.sale[key] ?? 0;
}

export function settledTotals(
  rows: SettledRecord[],
  /** What the coupon piles fetched, which no row carries. See couponMoney and `pooled` above. */
  coupons: CouponMoney = NO_COUPON_MONEY,
): SettledTotals {
  return {
    nights: rows.filter((r) => r.kind === "PIECES").length,
    sales: rows.filter((r) => r.kind === "MONEY" && r.takenBy === null).length,
    taken: rows.filter((r) => r.takenBy !== null).length,
    pooled: rows.reduce((sum, r) => sum + saleIn(r, "MESO", "pooled"), coupons.pooled),
    yourTake: rows.reduce((sum, r) => sum + saleIn(r, "MESO", "yourTake"), coupons.yourTake),
    usd: {
      pooled: rows.reduce((sum, r) => sum + saleIn(r, "USD", "pooled"), 0),
      yourTake: rows.reduce((sum, r) => sum + saleIn(r, "USD", "yourTake"), 0),
    },
    writtenOff: rows.reduce((sum, r) => sum + r.writtenOff, 0),
    // A sale that HAS a price and no split behind it. `pooled` is null exactly when the seat that
    // sold it has left, which is what makes the share unreadable. See drop-log.ts.
    unreadable: rows.filter((r) => r.sale !== null && r.sale.pooled === null).length,
  };
}
