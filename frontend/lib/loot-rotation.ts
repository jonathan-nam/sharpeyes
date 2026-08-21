// Whose turn it is to bend down, for a drop that cannot change hands.
//
// A vestige night that does not divide leaves a DEBT, and a debt gets settled: the holder hands
// over coupons, or the mesos they made on them, and the tranche ledger closes the pair. An Eternal
// piece cannot move once it is looted. Nobody can pay it, nobody can trade it, and there is no
// ledger to close, so the only thing that squares a member who came up short is looting more next
// time. That makes the running balance a SCHEDULE rather than a debt, and this file reads it.
//
// Which is why none of vestige-ledger's queue is reused here. That one is built around a debt worth
// settling: it drops the nights that came out square, it drops a party of one holder, and it stops
// counting a pile whose books were closed. Every one of those is wrong for a rotation, where a
// closed book does not exist and a square night is the ordinary case.
//
// Nothing is stored. The balance is derived from the arrangements already recorded on each week's
// row, for the same reason no share is stored: who ran and what they were on are both edited long
// after a night is filed, and a stored number does not follow them.

import {
  dividesEvenly,
  foldSeats,
  holderKey,
  holderOf,
  ranSeats,
  suggestArrangement,
} from "./vestige-ledger";
import { isPerMember } from "./world";
import type { WorldType } from "./world";
import type { BossDrop, DropTables } from "@/types/drop";
import type { Loot } from "@/types/loot";
import type { Party } from "@/types/party";

/** One person's place in the rotation. A person, never a character: see foldSeats. */
export type RotationHolder = {
  key: string;
  name: string;
  /**
   * Pieces they are behind by, over every week somebody answered for.
   *
   * Positive is short, negative is holding more than their share. It is never settled and never
   * written off, because there is nothing to settle it with. It is worked off by looting.
   *
   * FRACTIONAL, and that is not a rounding error. A week's exact share of five pieces between six
   * people is five sixths, and the point of carrying the fraction is that it is what makes the next
   * week turn: see the note in rotationFor. Round it for display, never for the ordering.
   */
  behind: number;
  /**
   * What they should pick up this week.
   *
   * Zero is an ANSWER, not an absence: five pieces across six people means somebody's turn is to
   * miss one, and that is the most useful line on the screen for whoever it is.
   */
  takes: number;
};

export type Rotation = {
  dropKey: string;
  name: string;
  /** Backend-relative, resolved by apiAssetUrl(). Null for a piece the mirror has no sprite for. */
  iconUrl: string | null;
  /** What falls each week at this party's mode and world. */
  quantity: number;
  /** One row per person, in the party's own seat order. */
  holders: RotationHolder[];
  /**
   * Whether it divides with nobody carried over.
   *
   * A fact about the ROSTER and its shares, not about the boss: 18 pieces divides for six people and
   * for three, and does not for four. An even one still gets a rotation drawn, because that is what
   * says nobody is behind.
   */
  even: boolean;
  /** Weeks the balance is built from. Zero is a rotation nobody has answered for yet. */
  weeks: number;
};

/**
 * The drops on this party's boss that a rotation applies to, which is a short list.
 *
 * Three things have to be true at once, and the middle one rules out most of the catalog:
 *
 *  - UNTRADEABLE, so a shortfall cannot be handed over and has to be looted instead. A vestige
 *    coupon is not: it settles in the tranche ledger and already has its own suggestion.
 *  - POOLED in this party's world. Limbo, Baldrix and Jupiter give every member their own in both
 *    worlds, and all seven bosses do on Heroic, and there is nothing to divide in either case.
 *  - dropped at all at the mode this party runs.
 *
 * A list rather than one, though the catalog gives at most one today: a boss's token modes and its
 * fragment modes do not overlap, so a party running Chaos Kalos sees the token and never the
 * fragment. Returning one would have to pick, and picking would hide the other the day that changes.
 */
export function rotatingDrops(party: Party, dropTables: DropTables): BossDrop[] {
  return rotatingDropsAt(dropTables[party.bossKey] ?? [], party.difficulty ?? "", party.worldType);
}

/**
 * The same question asked of a mode nobody is running yet.
 *
 * What the config editor needs: it is asking about the difficulty being TYPED, which is not the one
 * the party is saved on. An empty mode is nobody having said, and rotates nothing.
 */
export function rotatingDropsAt(drops: BossDrop[], difficulty: string, world: string): BossDrop[] {
  if (difficulty === "") return [];
  return drops.filter(
    (drop) =>
      drop.untradeable &&
      !isPerMember(drop.perMember, world as WorldType) &&
      (drop.pieces?.[world]?.[difficulty] ?? 0) > 0,
  );
}

/**
 * How many pieces each seat actually bent down for, folded to the people behind them.
 *
 * `bundlesBy` counts STACKS, and a stack is only one piece on a drop where the catalog says one
 * token is one bundle. It is converted through the row's own bundle count rather than assumed,
 * so this stays right if it is ever read against a drop that falls in real stacks.
 *
 * Null where the row cannot be read: no bundle count, or a count that does not divide what fell.
 * Refused rather than approximated, since an arrangement read wrong moves the rotation the wrong way
 * and then compounds it every week after.
 */
function lootedByHolder(loot: Loot, party: Party): Map<string, number> | null {
  const bundles = loot.bundles;
  if (bundles === null || bundles <= 0 || loot.quantity % bundles !== 0) return null;
  const size = loot.quantity / bundles;

  const seatById = new Map(party.seats.map((seat) => [seat.id, seat]));
  const out = new Map<string, number>();
  for (const row of loot.bundlesBy) {
    const seat = seatById.get(row.memberId);
    // A seat that has left the party still picked the pieces up, and its row is kept for exactly
    // that. One we cannot resolve at all would silently shrink what was looted, so refuse instead.
    if (!seat) return null;
    const key = holderKey(holderOf(seat));
    out.set(key, (out.get(key) ?? 0) + row.bundles * size);
  }
  return out;
}

/**
 * Everyone's running position on one drop, and what it says to do this week.
 *
 * Null when there is nothing to rotate: no roster to divide between, or a mode this boss drops none
 * of. Not null merely because nobody has answered a week yet, which is a rotation that has not
 * started rather than one that does not apply, and it still says what an even week looks like.
 */
export function rotationFor(
  party: Party,
  loot: Loot[],
  drop: BossDrop,
  quantity: number,
  bundles: number,
): Rotation | null {
  const folded = foldSeats(party.members);
  if (folded.length === 0 || quantity <= 0) return null;
  // A stack is the smallest thing anybody can hand over, so the rotation deals in STACKS and reports
  // pieces. Usually the two are the same, since a token falls one to a stack. Hard Malefic Star does
  // not: 18 in 6 stacks of 3, and telling four people to take 5, 5, 4 and 4 pieces of it would be an
  // instruction nobody can carry out.
  if (bundles <= 0 || quantity % bundles !== 0) return null;
  const size = quantity / bundles;

  // Only the weeks somebody answered for. A week with no arrangement recorded contributes nothing
  // rather than an assumed even split: the party can see its own empty boxes, and guessing there
  // would put a confident wrong turn on screen and carry it forward for ever.
  const behind = new Map<string, number>();
  let weeks = 0;
  for (const row of loot) {
    if (row.dropKey !== drop.dropKey || row.bundlesBy.length === 0) continue;
    const ran = foldSeats(ranSeats(row, party));
    if (ran.length === 0) continue;
    const looted = lootedByHolder(row, party);
    if (looted === null) continue;

    // The EXACT share, deliberately, not the whole-piece entitlement that entitlements() gives.
    //
    // This is the whole mechanism. Five pieces across six people has no whole-number entitlement:
    // largestRemainder has to break the tie somehow, and it breaks it by POSITION, so the same five
    // seats would be "entitled" to one every single week and the sixth would be entitled to none.
    // Measured that way nobody is ever behind, the balance stays flat, and the rotation never turns.
    //
    // Against 5/6 of a piece each, the five who looted one are a sixth ahead and the one who got
    // none is five sixths behind, which is exactly the fact that has to survive to next week. So the
    // balance is fractional on purpose. It is a position in a queue, not a debt anybody can pay.
    const weight = ran.reduce((sum, f) => sum + f.shares, 0);
    if (weight <= 0) continue;
    for (const f of ran) {
      const exact = (row.quantity * f.shares) / weight;
      behind.set(f.key, (behind.get(f.key) ?? 0) + exact - (looted.get(f.key) ?? 0));
    }
    // A holder who looted some of it without having run that week is over by that much, and walking
    // the roster alone would miss them.
    const ranKeys = new Set(ran.map((f) => f.key));
    for (const [key, took] of looted) {
      if (!ranKeys.has(key)) behind.set(key, (behind.get(key) ?? 0) - took);
    }
    weeks += 1;
  }

  // The same suggestion the coupons get: floor of each share, and the spare STACKS to whoever is
  // furthest behind, so the odd one rotates on its own instead of landing on one person every week.
  const suggested = suggestArrangement(bundles, party.members, behind);
  const takesByHolder = new Map<string, number>();
  for (const seat of party.members) {
    const key = holderKey(holderOf(seat));
    // Reported in PIECES, which is the unit somebody counts in their inventory. Stacks are what the
    // rotation moves; pieces are what it is moving.
    takesByHolder.set(key, (takesByHolder.get(key) ?? 0) + (suggested.get(seat.id) ?? 0) * size);
  }

  return {
    dropKey: drop.dropKey,
    name: drop.name,
    iconUrl: drop.iconUrl,
    quantity,
    // Against the STACKS, which is what has to divide. 18 pieces between three people is six each
    // and looks fine on the pieces alone; it is the six stacks that decide whether they can.
    even: dividesEvenly(bundles, folded),
    weeks,
    holders: folded.map((f) => ({
      key: f.key,
      name: f.name,
      behind: behind.get(f.key) ?? 0,
      takes: takesByHolder.get(f.key) ?? 0,
    })),
  };
}
