// Who owes who, when a drop arrives in pieces and one person picks up more than their share.
//
// A boss drops vestige coupons in bundles, more bundles than a small party has members, so they do
// not divide by looting alone: somebody ends up holding pieces that are not theirs. This works out
// who is short, who is over, and how many pieces move between them.
//
// It is NOT the money split in drop-split.ts, and it is not a second copy of it. That file divides
// one pot among seats. This one divides a COUNT, which is exact, and it stops there.
//
// It used to go further, and no longer does. A debt was priced by apportioning the holder's own sale
// proceeds pro rata over the part of their pile that was for sale, tranche by tranche, so the ledger
// had to be told what somebody else sold at. That is not knowable and it was not the reader's job:
// coupons are single-trade, so only the holder can sell them, and the two sides of a debt come off
// different nights at different prices. A debt is now a count of pieces, and what it is worth is
// whatever the two of them agree. The apportioning machinery (allocate, spreadKept, spreadBought,
// the coverage queue and everything #281 and #316 were about) is deleted rather than left unused.

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
 * by position. Deterministic, so the same input always divides the same way and a figure somebody
 * has already been paid does not move to a different row on the next read.
 *
 * Zeroes when there is nothing to divide, or no weight to divide it by.
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
 * What each seat was entitled to.
 *
 * Pieces are whole, so a share of them usually is not: 181 across four is 45.25 each. The point of
 * dividing it by the largest remainder is that the entitlements add up to exactly what dropped,
 * which is what makes the balances below sum to zero and the transfers clear the ledger completely
 * rather than nearly.
 */
export function entitlements(total: number, seats: LedgerSeat[]): Map<string, number> {
  const share = largestRemainder(
    total,
    seats.map((s) => s.shares),
  );
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
      balance: owed - s.looted,
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
   * Separate from `total` because a drop looted stack by stack sits in SEVERAL piles at once, and
   * the two numbers answer different questions. Who owes whom is measured against the whole drop.
   * What a holder's own sales can cover, and how much of their proceeds are somebody else's, is
   * measured against their pile: they can only ever sell what they picked up, and charging their
   * tranches against the whole drop would report a debt settled that their sales never touched.
   */
  held?: number;
  /**
   * Pieces of this pile the holder is redeeming rather than selling. Absent is none of them.
   *
   * Counted per HOLDER now, not per drop: which boss a redemption came off only mattered while a
   * debt was priced boss by boss. Kept on the type because the card bounds the redemption box at
   * the holder's own share, and `ownShareOf` is what draws that line.
   */
  kept?: number;
  /**
   * Pieces of the CREDITOR's that the holder took and paid for, and what they paid. See V50.
   *
   * Out of the sellable pile like a redemption, because they never went to market either. What makes
   * them a different kind is the money: it is one creditor's in full, at a price somebody agreed,
   * rather than the pile's to divide. Folded into KEPT instead, the same pieces were priced at
   * whatever average the holder's own sales happened to reach, which with a sliver of pile left is
   * a 60-piece claim set by one piece.
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
 *
 * The line a redemption crosses, and the card that bounds its box reads it from here rather than
 * deciding for itself.
 */
export function ownShareOf(drop: LedgerDrop, holder?: string): number {
  if (holder === undefined) return heldOf(drop);
  return Math.min(heldOf(drop), entitlements(drop.total, drop.seats).get(holder) ?? 0);
}

/**
 * Who owes whom out of one drop, and how many pieces.
 *
 * Deterministic on purpose: seats over their share pay seats under it, both in seat order. A stable
 * list is what lets a debt be remembered against a pair, and it means two people reading the same
 * row are told the same thing.
 *
 * Empty when the pieces were looted the way they divide, which is the ordinary night. Nothing to
 * say beats a list of zeroes.
 *
 * A COUNT and never a price. What the pieces are worth is not something this can see: coupons are
 * single-trade, so only the holder can sell them, and the two sides of a debt come off different
 * nights at different prices. It used to apportion the holder's sale proceeds pro rata over the
 * sellable pile, which is what made the ledger ask for somebody else's tranches one by one.
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
      const pieces = Math.min(debtor.left, creditor.left);
      out.push({
        fromId: debtor.memberId,
        toId: creditor.memberId,
        from: debtor.name,
        to: creditor.name,
        pieces,
      });
      debtor.left -= pieces;
      creditor.left -= pieces;
      if (creditor.left === 0) step += 1;
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
 * Three keys, and the middle one is the point. `droppedOn` is a date somebody TYPED, so an evening's
 * three bosses all carry the same one and it cannot order them; `recordedAt` is stamped by the
 * server when the drop was logged, which is the order the nights actually happened in.
 *
 * Without it the tie fell to `lootId`, a random uuid, so which of one evening's nights kept a debt
 * was decided by nothing anybody chose: three nights fell on 2026-08-23, a sale covered 85 of the
 * 150 they owed, and Hard Baldrix went silent while Hard Kaling still asked for 30, purely because
 * 28760ee5 sorts before acd816fc. Worse, the two spends disagreed: this file broke the tie on input
 * order and drop-log.ts broke it on the id, so the party badge and the Settlement card could pick
 * different nights out of the same evening.
 *
 * Absent `recordedAt` is a row cached from before the field and sorts first, which is what it meant
 * when it was cached. `lootId` stays as the last resort, so two rows stamped in the same millisecond
 * keep one order across renders rather than moving on a refresh.
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
 * coupons comes off the oldest 130 of them. Sales are not spent here: see spendSales. That is not
 * a claim about which physical coupons are where: it is the same statement the total already
 * makes, distributed over the rows the reader is looking at, so the list adds up to the figure
 * above it. A list that sums to 180 under a headline of 50 is a wrong number wherever the reader
 * happens to add it up.
 *
 * By the day the night FELL, never the order the rows are drawn in. The queue is drawn in the
 * catalog's order so that two bosses in one week never swap places.
 *
 * Every night is RETURNED, a covered one at zero rather than dropped. What a night still owes and
 * whether it is one of the nights an act would close are different questions: a night answered in
 * money is finished and closing the books on it is right, so dropping it here would quietly take it
 * out of `settleThePair` and leave it open for ever. Whoever DRAWS the list skips the zeroes. The
 * input order is preserved, because spending order and reading order are different questions too.
 *
 * The credit is one CREDITOR's. Spending Bro's answered coupons on a night Jared is owed is the
 * cross-person netting this app refuses everywhere else.
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
 * The eligibility rule spendOldestFirst's doc has always claimed and never enforced: a sale cannot
 * have come off a night that had not happened yet. Without it every sale ever recorded is one
 * undated pool, re-spent from scratch on each render, and it drains down the queue into nights that
 * fell after it. A night you logged tonight then reads as already answered by a sale from last week,
 * which is silence where a debt should be.
 *
 * Against `recordedAt` and never `droppedOn`, because droppedOn is a date somebody typed: logging a
 * drop, selling, and logging another drop is one date and three acts, and the day cannot order them.
 * A night with no recordedAt is a row cached from before the field, and stays eligible for
 * everything, which is what it meant when it was cached.
 *
 * Each sale takes the NEWEST nights it could have answered, because a sale is the evening's loot
 * going to market. Oldest first credited a Jupiter sale as "Jupiter (100), Malefic Star (20)" and
 * landed 1 of Bro's 41 sales on whole nights; newest first lands 29, every October one included.
 * Sales are taken in the order they were recorded. Every night is RETURNED at what it still owes,
 * for the reason spendOldestFirst says.
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
      // A row cached from before the field has no recordedAt, and stays eligible for everything:
      // that is what it meant when it was cached, and the next fetch corrects it.
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
 * The same walk, so what it names cannot disagree with the nights a card draws as answered: pinned
 * against spendSales in piece-ledger.test.ts. A sale that the nights cannot cover in full is null, not
 * a part of it: a week or boss claimed for some of its coupons is one claimed for money it cannot
 * name.
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
