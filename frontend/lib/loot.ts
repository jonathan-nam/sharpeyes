// Turning a recorded sale into what each member is owed.
//
// The arithmetic is NOT here. It is splitDrop() in lib/drop-split.ts, with its 64 tests, and this
// file only feeds it: the party's MVP flags become fee rates, the stored basis and method become
// its input, and the payout rows say who is in it. A second implementation of the split is the one
// thing this feature must not grow, because two answers to "what do I send you" is worse than none.

import { type AmountBasis, FEE_STANDARD, type Split, splitDrop } from "./drop-split";
import type { Currency, Money } from "./money";
import type { Loot } from "@/types/loot";
import type { PartyMember } from "@/types/party";

/**
 * The Auction House rate a member pays on a payout hop.
 *
 * The standard rate for everybody: MVP tiers are not tracked any more, so there is nothing to read
 * a 3% off. That is the honest reading of what is stored rather than a claim that nobody is MVP,
 * and it means a split can only under-state what a member nets, never over-state it.
 */
export function memberFee(): number {
  return FEE_STANDARD;
}

/**
 * Whether a drop divides at all.
 *
 * One seat ran it, so there is nobody to split with, nobody else it could have been sold by, and
 * nothing for the share boxes to ask. Read off the seats that RAN rather than off the config: a
 * boss run alone is a run alone whether its pool is a solo one or the party's, which is what the
 * Drop Log records every time. See ranWith on the server.
 */
export function divides(ran: PartyMember[]): boolean {
  return ran.length > 1;
}

export type Share = {
  memberId: string;
  name: string;
  fee: number;
  /** Shares of the pot they take. 1 in an even split. */
  shares: number;
  /** What to send them, before the fee on that transfer. In the sale's own currency. */
  pay: number;
  /** What they end up holding. */
  nets: number;
  paid: boolean;
};

export type LootSplit = {
  /**
   * The seat the shares are measured from: who sold it, or who bought it off the party. `keeps` is
   * mesos on a sale and the value of their own share of the item on a buy. `paysOut` is what
   * leaves their hands, so `keeps` plus `paysOut` is the whole pot.
   */
  seller: { memberId: string; name: string; keeps: number; paysOut: number; shares: number };
  shares: Share[];
  split: Split;
  /**
   * What every figure above is denominated in. Cents when USD, mesos when MESO.
   *
   * Carried ON the split rather than looked up again at each call site. A figure and its unit that
   * travel separately get separated, and a payout of 33334 drawn as mesos is a thousandth of what
   * is owed, stated with the same confidence as the right answer.
   */
  currency: Currency;
};

/**
 * What this drop sold for and in which unit, or null if it has not sold.
 *
 * Dollars first, because a dollar sale stores no meso figure at all and a meso sale stores no cents
 * (V76 makes them exclusive). The order matters only if a row ever carried both, and then the unit
 * that cannot be converted away is the one to believe.
 */
export function saleMoney(loot: Pick<Loot, "saleAmount" | "saleUsdCents">): Money | null {
  const cents = loot.saleUsdCents ?? null;
  if (cents !== null) return { amount: cents, currency: "USD" };
  return loot.saleAmount === null ? null : { amount: loot.saleAmount, currency: "MESO" };
}

/**
 * How to read the stored figure, or null for a basis this build does not know.
 *
 * BOUGHT is a party member buying the drop off the party. Nothing was listed, so no Auction House
 * cut came off the top and the whole figure is the pot, which is `received`'s arithmetic exactly.
 * The payout hops are still taxed, so the split itself is unchanged.
 *
 * Null rather than a default, because defaulting an unknown basis to `received` would silently
 * skip a fee on a row written by a newer build.
 */
function basisOf(stored: string): AmountBasis | null {
  if (stored === "LISTED") return "listed";
  if (stored === "RECEIVED" || stored === "BOUGHT") return "received";
  return null;
}

/**
 * What this sold drop owes each member, or null when it cannot be worked out.
 *
 * Null rather than a partial answer in five cases: the drop is not sold, its basis is one this
 * build cannot read, the seller is no longer a seat we can read a fee from, a payout names a seat
 * that is not in the party, or a share count is not a whole number of at least one. Each would
 * otherwise produce a payout list that looks complete and is short a person or wrong on a rate.
 */
export function splitOf(loot: Loot, members: PartyMember[]): LootSplit | null {
  const money = saleMoney(loot);
  if (
    money === null ||
    loot.sellerMemberId === null ||
    loot.amountBasis === null ||
    loot.splitMethod === null
  ) {
    return null;
  }

  const amountIs = basisOf(loot.amountBasis);
  if (amountIs === null) return null;

  const byId = new Map(members.map((m) => [m.id, m]));
  const seller = byId.get(loot.sellerMemberId);
  if (!seller) return null;

  const owed = loot.payouts.map((payout) => ({ payout, member: byId.get(payout.memberId) }));
  if (owed.some((o) => !o.member)) return null;

  // A count that is not there at all is one share: that is what a sale recorded before shares
  // existed was, and what the column's own backfill said. A count that is there and unreadable is
  // refused, because a split whose figures look ordinary and pay the wrong amounts is worse than
  // one that says nothing.
  const sellerShares = loot.sellerShares ?? 1;
  const memberShares = owed.map((o) => o.payout.shares ?? 1);
  if ([sellerShares, ...memberShares].some((n) => !Number.isInteger(n) || n < 1)) return null;

  // Real money never crossed the Auction House, so there is no cut on a payout hop and no cut off
  // the top either. Cents otherwise divide exactly as mesos do, which is why the split itself did
  // not have to learn about currencies: only its rate did.
  const fee = money.currency === "USD" ? 0 : memberFee();

  const split = splitDrop({
    amount: money.amount,
    amountIs,
    sellerFee: fee,
    memberFees: owed.map(() => fee),
    method: loot.splitMethod === "FAIR" ? "fair" : "lazy",
    sellerShares,
    memberShares,
    // Down in dollars, so $1000 three ways is the $333.33 everybody already worked out, and the
    // holder keeps the odd cent rather than paying it. See SplitInput.rounding.
    rounding: money.currency === "USD" ? "down" : "up",
  });

  return {
    seller: {
      memberId: seller.id,
      name: seller.name,
      keeps: split.sellerKeeps,
      // Read off the split rather than summed from the payouts: same figure, one source.
      paysOut: split.sellerReceives - split.sellerKeeps,
      shares: split.sellerShares,
    },
    shares: owed.map((o, i) => ({
      memberId: o.payout.memberId,
      name: o.member!.name,
      fee: split.members[i]?.fee ?? 0,
      shares: split.members[i]?.shares ?? 1,
      pay: split.members[i]?.pay ?? 0,
      nets: split.members[i]?.nets ?? 0,
      paid: o.payout.paid,
    })),
    split,
    currency: money.currency,
  };
}

export type LootSummary = {
  /** Dropped, not sold yet. */
  pending: number;
  /** Sold, with somebody still unpaid. */
  awaitingPayout: number;
  /** Sold, everybody paid, nothing left to do. */
  settled: number;
};

/**
 * What a pool is up to: what is unsold, what is sold but not settled, and what is done.
 *
 * The third is not busywork. Counting only the first two meant a pool where everything had been
 * paid reported nothing at all, and a party with a season of drops behind it read exactly like one
 * that had never dropped a thing.
 */
export function summarize(loot: Loot[]): LootSummary {
  return {
    pending: loot.filter((l) => l.status === "PENDING").length,
    awaitingPayout: loot.filter((l) => l.status === "SOLD").length,
    // TAKEN is terminal in a Heroic pool the way PAID_OUT is in an Interactive one: somebody has
    // the item and nothing further is owed. Counting only PAID_OUT would report a Heroic party
    // that had settled a season of drops as having done nothing at all.
    settled: loot.filter((l) => l.status === "PAID_OUT" || l.status === "TAKEN").length,
  };
}

export type TakenCount = {
  memberId: string;
  name: string;
  /** Items taken, not rows. A stack of six is six. */
  taken: number;
  /** Nobody has taken fewer. Ties are real, so this can be true of several seats. */
  up: boolean;
};

/**
 * How many items each seat has taken out of this pool.
 *
 * The whole product of a Heroic pool. Nothing there can be sold, so the only lever a party has is
 * who picks what up, and the only thing that makes that fair is a count somebody can point at.
 *
 * Items rather than rows, because a row is not a unit: one row is one hammer or a stack of thirty
 * coupons, and counting rows would call those the same turn. `up` is off the minimum rather than a
 * sorted order, so the seats stay in roster order and a tie stays a tie instead of being broken by
 * whoever happens to sort first.
 *
 * Every seat is listed, zero included. A seat that has taken nothing is exactly the seat this is
 * for, and leaving it out until it has something is the one omission that would make the tally
 * useless.
 */
export function takenTally(loot: Loot[], members: PartyMember[]): TakenCount[] {
  const counts = new Map(members.map((m) => [m.id, 0]));
  for (const drop of loot) {
    if (drop.takenByMemberId === null) continue;
    const held = counts.get(drop.takenByMemberId);
    // A seat that has left the party. Its drops are not added to anybody else's count: attributing
    // them would inflate a seat that never took them, which is the wrong number in miniature.
    if (held === undefined) continue;
    counts.set(drop.takenByMemberId, held + drop.quantity);
  }
  const fewest = Math.min(...counts.values());
  return members.map((m) => ({
    memberId: m.id,
    name: m.name,
    taken: counts.get(m.id) ?? 0,
    up: (counts.get(m.id) ?? 0) === fewest,
  }));
}

/** The three counts a party row reads its badge off. Mirrors PartyResponse's own fields. */
export type PoolCounts = {
  pendingLoot: number;
  awaitingPayout: number;
  settledLoot: number;
};

/**
 * What a party row says about its pool, or null when there is no pool.
 *
 * Outstanding work wins the line: "2 in the pool" and "1 awaiting payout" are things to go and do,
 * and a settled count beside them would just be noise. Only when there is nothing to do does the
 * settled count get the line, quietly, and that case is the whole point. Showing only the first two
 * meant paying the last share erased every trace of the pool from the list, so a party with a
 * season of drops behind it looked identical to one that had never dropped anything.
 */
/**
 * What a party's coupon nights left owed TO you. Zero is nothing to chase.
 *
 * One direction only. Coupons YOU are holding for the rest of the party are said on the drop itself
 * and in the Sale Ledger, and a row of a list is not where somebody goes to be told what to hand
 * over.
 *
 * Declared here rather than in drop-log.ts, which is where it is COUNTED: that file already imports
 * this one, and the type going the other way would close the circle.
 */
export type CouponsOutstanding = { toYou: number };

/** A party with nothing in the wrong hands, for the callers that read a map with gaps in it. */
export const NOTHING_OUTSTANDING: CouponsOutstanding = { toYou: 0 };

export function poolLabel(
  counts: PoolCounts,
  /**
   * Coupons of yours out of this party's piece drops that somebody else is holding.
   *
   * Said in COUPONS because a count of rows cannot: one row is one hammer or 180 coupons, and the
   * row count deliberately leaves out the coupon drops that came out even. Worked out from the
   * pools by lib/drop-log.ts, never counted a second time here.
   */
  coupons: CouponsOutstanding = NOTHING_OUTSTANDING,
): { text: string; done: boolean } | null {
  const outstanding = [
    counts.pendingLoot > 0 ? `${counts.pendingLoot} in the pool` : null,
    counts.awaitingPayout > 0 ? `${counts.awaitingPayout} awaiting payout` : null,
    coupons.toYou > 0 ? `${coupons.toYou} coupons owed` : null,
  ].filter(Boolean);

  if (outstanding.length > 0) return { text: outstanding.join(" \u00b7 "), done: false };
  if (counts.settledLoot > 0) return { text: `${counts.settledLoot} settled`, done: true };
  return null;
}

/** Every drop the pool holds, whatever state it is in. */
export function poolSize(counts: PoolCounts): number {
  return counts.pendingLoot + counts.awaitingPayout + counts.settledLoot;
}

/**
 * A pool narrowed to one week.
 *
 * For a Party View row, which is about the week on screen. The whole pool there was a season of
 * drops under a heading about tonight. What it leaves out is on the party's own page, which the
 * row's heading and its badge both link to.
 *
 * The row's badge does not agree with what this returns and cannot: an unsold drop carries forward
 * into every later week's counts (see LootCounts.kt), so a row can say "1 in the pool" over a week
 * that holds no such drop.
 *
 * `weekStart` is the server's Thursday, and so is every row's, so this is a comparison and never a
 * date calculation. Null is not knowing which week it is, which shows the pool whole: hiding rows
 * against a week we could not name would be the guess this refuses to make.
 *
 * A row dated after the week is kept. Nothing writes one (a drop is stamped with the server's
 * today), and if something ever does, the honest failure is showing it.
 */
export function dropsInWeek(loot: Loot[], weekStart: string | null): Loot[] {
  if (weekStart === null) return loot;
  return loot.filter((drop) => drop.weekStart >= weekStart);
}

/** The status as a short label. Kept beside summarize so the two cannot disagree. */
export function statusLabel(status: string): string {
  if (status === "PENDING") return "In the pool";
  if (status === "SOLD") return "Awaiting payout";
  if (status === "PAID_OUT") return "Settled";
  // Not "Settled": nothing was paid, and a Heroic pool has no payment to have settled.
  if (status === "TAKEN") return "Taken";
  return status;
}

/**
 * The date as written, not as a timezone reads it.
 *
 * new Date("2026-07-20") is UTC midnight, so anyone behind UTC sees the 19th. Same reasoning as
 * formatPeriod in lib/boss-clears.ts.
 */
export function formatDropped(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  // The month range as well as its presence: month 13 indexed past the end and drew "40 undefined".
  // Same guard formatWeekStart carries, for the same reason.
  if (!year || !month || !day || month > months.length) return iso;
  return `${day} ${months[month - 1]}`;
}

/**
 * The same date carrying its year, for a list whose whole content is order in time.
 *
 * Every other reading of a date sits inside something that already fixes the year: the Drop Log
 * groups by month, a pool row is one party's current business. One drop's history is neither, and
 * two acts a year apart drew identically.
 */
export function formatDroppedWithYear(iso: string): string {
  const said = formatDropped(iso);
  const year = iso.slice(0, 4);
  return said === iso || year.length !== 4 ? iso : `${said} ${year}`;
}
