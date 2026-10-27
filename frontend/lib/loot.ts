// Turning a recorded sale into what each member is owed.
//
// The arithmetic is splitDrop() in lib/drop-split.ts; this file only feeds it. Do not grow a
// second implementation of the split.

import { type AmountBasis, FEE_STANDARD, type Split, splitDrop } from "./drop-split";
import type { Currency, Money } from "./money";
import type { Loot, SellLootBody } from "@/types/loot";
import type { PartyMember } from "@/types/party";

/**
 * The Auction House rate a member pays on a payout hop.
 *
 * The standard rate for everybody, since MVP tiers are not tracked. A split can therefore only
 * under-state what a member nets, never over-state it.
 */
export function memberFee(): number {
  return FEE_STANDARD;
}

/**
 * Whether a drop divides at all.
 *
 * Read off the seats that RAN rather than off the config: a boss run alone is a run alone whether
 * its pool is a solo one or the party's. See ranWith on the server.
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
   * What every figure above is denominated in. Cents when USD, mesos when MESO. Carried on the
   * split so a figure cannot travel without its unit.
   */
  currency: Currency;
};

/**
 * What this drop sold for and in which unit, or null if it has not sold.
 *
 * V76 makes the two exclusive. Dollars win if a row ever carried both.
 */
export function saleMoney(loot: Pick<Loot, "saleAmount" | "saleUsdCents">): Money | null {
  const cents = loot.saleUsdCents ?? null;
  if (cents !== null) return { amount: cents, currency: "USD" };
  return loot.saleAmount === null ? null : { amount: loot.saleAmount, currency: "MESO" };
}

/**
 * A sold drop's sale as the sale form sends it, so a correction opens on what was entered. Null
 * when it has not sold.
 *
 * A seat that ran with no payout row was on no share (sellLoot writes none for zero), so it reads 0
 * here. Left out, the form would open it on one and a correction would hand it a share.
 */
export function saleBodyOf(loot: Loot): SellLootBody | null {
  const { sellerMemberId, amountBasis, splitMethod } = loot;
  const money = saleMoney(loot);
  if (money === null || sellerMemberId === null || amountBasis === null || splitMethod === null) {
    return null;
  }
  const owed = new Map(loot.payouts.map((p) => [p.memberId, p.shares]));
  const shares = Object.fromEntries(
    loot.ranThatWeek.map((id) => [
      id,
      id === sellerMemberId ? (loot.sellerShares ?? 1) : (owed.get(id) ?? 0),
    ]),
  );
  return {
    amount: money.currency === "MESO" ? money.amount : 0,
    usdCents: money.currency === "USD" ? money.amount : undefined,
    amountBasis,
    splitMethod,
    sellerMemberId,
    shares,
  };
}

/**
 * How to read the stored figure, or null for a basis this build does not know.
 *
 * BOUGHT is a member buying the drop off the party: nothing was listed, so it reads as `received`.
 *
 * Null rather than a default, because defaulting to `received` would silently skip a fee on a row
 * written by a newer build.
 */
function basisOf(stored: string): AmountBasis | null {
  if (stored === "LISTED") return "listed";
  if (stored === "RECEIVED" || stored === "BOUGHT") return "received";
  return null;
}

/**
 * What this sold drop owes each member, or null when it cannot be worked out.
 *
 * Null rather than a partial answer when the drop is not sold, its basis is unknown, the seller or
 * a payout's seat is not in the party, or a share count is not a whole number of at least one.
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

  // An absent count is one share (the column's backfill). A present but unreadable one is refused.
  const sellerShares = loot.sellerShares ?? 1;
  const memberShares = owed.map((o) => o.payout.shares ?? 1);
  if ([sellerShares, ...memberShares].some((n) => !Number.isInteger(n) || n < 1)) return null;

  // Real money never crosses the Auction House, so no fee on either hop.
  const fee = money.currency === "USD" ? 0 : memberFee();

  const split = splitDrop({
    amount: money.amount,
    amountIs,
    sellerFee: fee,
    memberFees: owed.map(() => fee),
    method: loot.splitMethod === "FAIR" ? "fair" : "lazy",
    sellerShares,
    memberShares,
    // See SplitInput.rounding.
    rounding: money.currency === "USD" ? "down" : "up",
  });

  return {
    seller: {
      memberId: seller.id,
      name: seller.name,
      keeps: split.sellerKeeps,
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
 * Items rather than rows, since one row can be a stack. `up` is off the minimum rather than a sort,
 * so seats stay in roster order and ties stay ties. Every seat is listed, zero included.
 */
export function takenTally(loot: Loot[], members: PartyMember[]): TakenCount[] {
  const counts = new Map(members.map((m) => [m.id, 0]));
  for (const drop of loot) {
    if (drop.takenByMemberId === null) continue;
    const held = counts.get(drop.takenByMemberId);
    // A seat that has left the party. Never attribute its drops to anybody else.
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

/** A party's pool counts. Mirrors PartyResponse's own fields. */
export type PoolCounts = {
  pendingLoot: number;
  awaitingPayout: number;
  settledLoot: number;
};

/** Every drop the pool holds, whatever state it is in. */
export function poolSize(counts: PoolCounts): number {
  return counts.pendingLoot + counts.awaitingPayout + counts.settledLoot;
}

/**
 * A pool narrowed to one week, for a Party View row.
 *
 * The row's badge cannot agree with this: an unsold drop carries forward into every later week's
 * counts (see LootCounts.kt).
 *
 * `weekStart` is the server's Thursday, as is every row's, so this is a string comparison. Null
 * shows the pool whole rather than guess a week. A row dated after the week is kept.
 */
export function dropsInWeek(loot: Loot[], weekStart: string | null): Loot[] {
  if (weekStart === null) return loot;
  return loot.filter((drop) => drop.weekStart >= weekStart);
}

/** The status as a short label. */
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
  // Range-check the month too, or month 13 renders "undefined".
  if (!year || !month || !day || month > months.length) return iso;
  return `${day} ${months[month - 1]}`;
}

/**
 * The same date carrying its year, for a list whose context does not already fix the year (one
 * drop's history).
 */
export function formatDroppedWithYear(iso: string): string {
  const said = formatDropped(iso);
  const year = iso.slice(0, 4);
  return said === iso || year.length !== 4 ? iso : `${said} ${year}`;
}
