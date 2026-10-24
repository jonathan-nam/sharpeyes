// Who owes who, when a drop arrives in pieces and one person picks up more than their share.
//
// A boss drops vestige coupons in bundles, more bundles than a small party has members, so they do
// not divide by looting alone: somebody ends up holding pieces that are not theirs. This works out
// who is short, who is over, and how many pieces move between them.
//
// It is NOT the money split in drop-split.ts, which divides one pot among seats. This one divides a
// COUNT, which is exact, and it stops there.
//
// Do not price a debt here. Coupons are single-trade, so only the holder can sell them, and the two
// sides of a debt come off different nights at different prices: apportioning the holder's sale
// proceeds over the pile would need to know what somebody else sold at.

/** One seat on a stacking drop: what they took, and what fraction of it is theirs. */
export type LedgerSeat = {
  memberId: string;
  name: string;
  /** Pieces they picked up. */
  looted: number;
  /** Their weight in the even share. 1 unless the party agreed somebody takes more. */
  shares: number;
};

/** What one seat was entitled to against what they took. */
export type SeatBalance = {
  memberId: string;
  name: string;
  entitled: number;
  looted: number;
  /** Pieces owed TO them. Negative means they are holding that many that are not theirs. */
  balance: number;
};

/** One debt out of a drop: this many of the creditor's pieces are in the debtor's inventory. */
export type PieceTransfer = {
  fromId: string;
  toId: string;
  from: string;
  to: string;
  pieces: number;
};

/**
 * A whole divided by weights, in whole units that add up to exactly the whole.
 *
 * Everyone gets the floor of their exact share, then the odd units go to the biggest fractions, ties
 * by position. Deterministic, so a figure somebody has already been paid does not move to a different
 * row on the next read. Zeroes when there is nothing to divide, or no weight to divide it by.
 */
export function largestRemainder(total: number, weights: number[]): number[] {
  const weight = weights.reduce((sum, w) => sum + w, 0);
  if (weights.length === 0 || weight <= 0 || total <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (total * w) / weight);
  const share = exact.map(Math.floor);
  let left = total - share.reduce((sum, n) => sum + n, 0);

  const order = exact
    .map((value, i) => ({ i, fraction: value - (share[i] ?? 0) }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i);

  for (const { i } of order) {
    if (left <= 0) break;
    share[i] = (share[i] ?? 0) + 1;
    left -= 1;
  }
  return share;
}

/**
 * A count of coupons, held to the millionth of one.
 *
 * Exact for every share a party can have to two decimals, and it stops a third (61 across three)
 * leaving 7e-15 of a coupon owed after the transfers clear.
 */
export function pieces(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** A count of coupons as the screen says it: whole as a whole, a share to two places (22.5, 20.33). */
export function formatPieces(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2, useGrouping: false });
}

/**
 * What each seat was entitled to, EXACTLY: 45 across two is 22.5 each.
 *
 * Not the largest remainder: coupons trade whole, so a .5 is the two of them to settle, and the ledger
 * says so rather than deciding. The entitlements still add up to what dropped.
 */
export function entitlements(total: number, seats: LedgerSeat[]): Map<string, number> {
  const weight = seats.reduce((sum, s) => sum + s.shares, 0);
  if (weight <= 0 || total <= 0) return new Map(seats.map((s) => [s.memberId, 0]));
  const share = seats.map((s) => pieces((total * s.shares) / weight));
  // The last seat takes what makes it add up, so 61 across three is 20.333333 twice and 20.333334,
  // not 60.999999 and a millionth owed forever that no transfer can clear.
  const last = seats.map((s) => s.shares > 0).lastIndexOf(true);
  if (last >= 0)
    share[last] = pieces(total - share.reduce((sum, n, i) => (i === last ? sum : sum + n), 0));
  return new Map(seats.map((s, i) => [s.memberId, share[i] ?? 0]));
}

/** Every seat's position: what they should have, what they took, and the difference. */
export function balances(total: number, seats: LedgerSeat[]): SeatBalance[] {
  const entitled = entitlements(total, seats);
  return seats.map((s) => {
    const owed = entitled.get(s.memberId) ?? 0;
    return {
      memberId: s.memberId,
      name: s.name,
      entitled: owed,
      looted: s.looted,
      balance: pieces(owed - s.looted),
    };
  });
}

/** One boss's pieces in the queue: what dropped, who took it, and where it sits in line. */
export type LedgerDrop = {
  id: string;
  /** The reset week it was cleared in. Drops from one week share a place in the queue. */
  weekStart: string;
  /** Tie-break inside a week: the boss's own progression order, so the queue never shuffles. */
  order: number;
  /** What fell. Entitlements are measured against this, so it is the whole drop, not a slice. */
  total: number;
  seats: LedgerSeat[];
  /**
   * Pieces of it in the pile this row is about. Defaults to `total`, which is one seat having
   * looted the lot.
   *
   * Separate from `total` because a drop looted stack by stack sits in SEVERAL piles at once. Who
   * owes whom is measured against the whole drop; what a holder's own sales can cover is measured
   * against their pile, since they can only sell what they picked up.
   */
  held?: number;
  /** Pieces of this pile the holder is redeeming rather than selling. Absent is none of them. */
  kept?: number;
  /**
   * Pieces of the CREDITOR's that the holder took and paid for, and what they paid. See V50.
   *
   * Not folded into `kept`: the money is one creditor's in full, at an agreed price, rather than the
   * pile's to divide.
   */
  bought?: { pieces: number; paid: number };
};

/** Pieces in the pile a row is about. The looter's whole drop unless it was split at the stack. */
export function heldOf(drop: LedgerDrop): number {
  return drop.held ?? drop.total;
}

/**
 * Pieces of this pile that are the holder's OWN, which is what a redemption comes off first.
 *
 * Their entitlement, capped by what they are actually holding: a seat owed more than they picked up
 * has no surplus of their own to redeem. Absent holder reads the pile as all theirs, which is one
 * seat having looted the lot.
 */
export function ownShareOf(drop: LedgerDrop, holder?: string): number {
  if (holder === undefined) return heldOf(drop);
  return Math.min(heldOf(drop), entitlements(drop.total, drop.seats).get(holder) ?? 0);
}

/**
 * Who owes whom out of one drop, and how many pieces.
 *
 * Deterministic: seats over their share pay seats under it, both in seat order, so a debt can be
 * remembered against a pair. Empty when the pieces were looted the way they divide.
 *
 * A COUNT and never a price. See the file header.
 */
export function transfersOf(
  drop: LedgerDrop,
  /**
   * Only the debts owed BY this seat, for a drop split across several piles.
   *
   * The pairing still runs over every debtor, so who pays whom does not change with which pile is
   * being drawn. Undefined is the whole ledger, which is what one looter holding everything means.
   */
  from?: string,
): PieceTransfer[] {
  const position = balances(drop.total, drop.seats);
  const owing = position.filter((p) => p.balance < 0).map((p) => ({ ...p, left: -p.balance }));
  const owed = position.filter((p) => p.balance > 0).map((p) => ({ ...p, left: p.balance }));

  const out: PieceTransfer[] = [];
  let step = 0;
  for (const debtor of owing) {
    while (debtor.left > 0 && step < owed.length) {
      const creditor = owed[step]!;
      const moved = Math.min(debtor.left, creditor.left);
      out.push({
        fromId: debtor.memberId,
        toId: creditor.memberId,
        from: debtor.name,
        to: creditor.name,
        pieces: moved,
      });
      debtor.left = pieces(debtor.left - moved);
      creditor.left = pieces(creditor.left - moved);
      if (creditor.left <= 0) step += 1;
    }
  }
  return from === undefined ? out : out.filter((t) => t.fromId === from);
}

/** The key a transfer is remembered by. One pair, one debt, however the row is redrawn. */
export function transferKey(transfer: { fromId: string; toId: string }): string {
  return `${transfer.fromId}>${transfer.toId}`;
}

/**
 * The order a debt is answered in, and the ONE order every spend in the app runs in.
 *
 * `droppedOn` is a date somebody TYPED, so an evening's bosses all share one; `recordedAt` is
 * server-stamped and is the order the nights actually happened in. Without it, ties fell to a random
 * uuid and two spends could pick different nights out of the same evening.
 *
 * Absent `recordedAt` is a row cached from before the field and sorts first. `lootId` is the last
 * resort, so rows stamped in the same millisecond keep one order across renders.
 */
export function oldestNightFirst(
  a: { droppedOn: string; recordedAt?: string | null; lootId?: string },
  b: { droppedOn: string; recordedAt?: string | null; lootId?: string },
): number {
  return (
    a.droppedOn.localeCompare(b.droppedOn) ||
    (a.recordedAt ?? "").localeCompare(b.recordedAt ?? "") ||
    (a.lootId ?? "").localeCompare(b.lootId ?? "")
  );
}

/**
 * A credit spent over nights, oldest first, leaving what each still owes.
 *
 * A pair's debt is one running count and the nights behind it are a queue, so a credit of 130
 * coupons comes off the oldest 130 of them, so the list adds up to the figure above it. Sales are
 * not spent here: see spendSales.
 *
 * By when the night FELL (oldestNightFirst), never the order the rows are drawn in.
 *
 * Every night is RETURNED, a covered one at zero, in input order. Dropping it would take it out of
 * `settleThePair` and leave it open for ever; whoever DRAWS the list skips the zeroes.
 *
 * The credit is one CREDITOR's: never spend one person's credit on another's night.
 */
export function spendOldestFirst<
  T extends { pieces: number; droppedOn: string; recordedAt?: string | null; lootId?: string },
>(nights: T[], credit: number): T[] {
  let left = Math.max(0, credit);
  const owed = new Map<T, number>();
  for (const night of [...nights].sort(oldestNightFirst)) {
    const spent = Math.min(left, night.pieces);
    left -= spent;
    owed.set(night, night.pieces - spent);
  }
  return nights.map((night) => ({ ...night, pieces: owed.get(night) ?? night.pieces }));
}

/** One sale's coupons, with the moment it was recorded. See spendSales. */
export type AnsweredSale = {
  pieces: number;
  /** The tranche's soldAt, which is stamped by the server and has no edit path. */
  recordedAt: string;
};

/**
 * Sales spent over nights, each sale reaching only the nights already on the books when it was made.
 *
 * A sale cannot have come off a night that had not happened yet, or a night logged tonight reads as
 * answered by last week's sale. Against `recordedAt`, never `droppedOn` (a typed date that cannot
 * order a drop, a sale and another drop on one day). A night with no recordedAt is a row cached from
 * before the field, and stays eligible for everything.
 *
 * Each sale takes the NEWEST nights it could have answered, because a sale is the evening's loot
 * going to market; oldest first lands far fewer sales on whole nights. Sales are taken in the order
 * they were recorded. Every night is RETURNED, as in spendOldestFirst.
 */
export function spendSales<
  T extends { pieces: number; droppedOn: string; recordedAt?: string | null; lootId?: string },
>(nights: T[], sales: AnsweredSale[]): T[] {
  const owed = new Map<T, number>(nights.map((night) => [night, night.pieces]));
  const newest = [...nights].sort(oldestNightFirst).reverse();
  for (const sale of [...sales].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    let left = Math.max(0, sale.pieces);
    for (const night of newest) {
      if (left <= 0) break;
      // No recordedAt is a stale cached row: eligible for everything until the next fetch.
      if (night.recordedAt && night.recordedAt > sale.recordedAt) continue;
      const spent = Math.min(left, owed.get(night)!);
      left -= spent;
      owed.set(night, owed.get(night)! - spent);
    }
  }
  return nights.map((night) => ({ ...night, pieces: owed.get(night) ?? night.pieces }));
}

type PlaceableNight = {
  pieces: number;
  droppedOn: string;
  weekStart: string;
  recordedAt?: string | null;
  lootId?: string;
};

/**
 * Which nights each sale came off, and how many pieces of each, spending exactly as spendSales does.
 *
 * Pinned against spendSales in piece-ledger.test.ts. A sale the nights cannot cover in full is null,
 * not a part of it: a partial placement would claim money it cannot name.
 */
export function placeSalesOnNights<T extends PlaceableNight, S extends AnsweredSale>(
  nights: T[],
  sales: S[],
): Map<S, { night: T; pieces: number }[] | null> {
  const owed = new Map<T, number>(nights.map((night) => [night, night.pieces]));
  const newest = [...nights].sort(oldestNightFirst).reverse();
  const out = new Map<S, { night: T; pieces: number }[] | null>();
  for (const sale of [...sales].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    let left = Math.max(0, sale.pieces);
    const taken: { night: T; pieces: number }[] = [];
    for (const night of newest) {
      if (left <= 0) break;
      if (night.recordedAt && night.recordedAt > sale.recordedAt) continue;
      const spent = Math.min(left, owed.get(night)!);
      left -= spent;
      owed.set(night, owed.get(night)! - spent);
      if (spent > 0) taken.push({ night, pieces: spent });
    }
    out.set(sale, left > 0 ? null : taken);
  }
  return out;
}

/** The same placement folded to the reset weeks the pieces came from. See placeSalesOnNights. */
export function placeSales<T extends PlaceableNight, S extends AnsweredSale>(
  nights: T[],
  sales: S[],
): Map<S, Map<string, number> | null> {
  const out = new Map<S, Map<string, number> | null>();
  for (const [sale, taken] of placeSalesOnNights(nights, sales)) {
    if (taken === null) {
      out.set(sale, null);
      continue;
    }
    const weeks = new Map<string, number>();
    for (const { night, pieces } of taken) {
      weeks.set(night.weekStart, (weeks.get(night.weekStart) ?? 0) + pieces);
    }
    out.set(sale, weeks);
  }
  return out;
}
