// What actually got picked up, on one night.
//
// The other half of the vestige config, and a DIFFERENT FACT from it. vestige-stacks.ts holds the
// deal (what each member is entitled to, a rate, halves allowed); this holds what happened (who
// bent down for which stack, one night, whole stacks only). The debt is the gap between them, so
// neither one can be worked out from the other and the ledger needs both.
//
// A STACK is the unit and the only unit here. Hard Baldrix gives 120 in 3 stacks of 40, and a stack
// is what one person picked up, so what a member can be handed is a whole number of them and
// nothing finer. Halves belong to the deal, where they mean an average across weeks.
//
// Offered on EVERY night, not only the ones that will not divide. A night whose stacks happen to
// come out even is not a night that divided: one person may still have looted the lot, and until
// somebody says so the ledger assumes they did not. Six of HuskyxKenshi's seven nights had nothing
// recorded and five of them were never even asked about, which is what that assumption costs.
//
// What is written is party_loot_bundle (V41). Every figure anybody is owed follows from it on read.

import { foldSeats, holderKey, holderOf, ranSeats, suggestArrangement } from "./vestige-ledger";
import type { ShareConfig } from "./vestige-stacks";
import type { Loot } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

/** One night's stacks, ready to be handed out. */
export type StackDrop = {
  lootId: string;
  /** What FELL, never a share. See V40. */
  quantity: number;
  /** How many equal stacks it fell in. */
  bundles: number;
  /** Pieces in one stack. Whole by construction: the catalog refuses a total its stacks do not divide. */
  size: number;
  /** The seats that ran the week it fell in, which is who a stack may be handed to. */
  seats: PartyMember[];
  /**
   * An arrangement is already recorded and can be read against those seats.
   *
   * What makes Save a correction rather than a first answer. False when it cannot be read, which
   * happens when the week's roster was edited afterwards and the arrangement names somebody the week
   * no longer has: that has to be said again rather than drawn as an arrangement nobody entered.
   */
  recorded: boolean;
  /** The stacks each seat is recorded as picking up. Empty when nobody has said. */
  counts: Record<string, number>;
  /**
   * Each holder's running position on THIS drop, so the odd stack rotates instead of landing on the
   * same seat every week. See openingCounts.
   */
  behind: Map<string, number>;
};

/** Which drop a night is being handed out for. */
export type PickupDrop = {
  dropKey: string;
  /** See StackDrop.behind. */
  behind: Map<string, number>;
};

/**
 * The nights among these drops that can still be handed out.
 *
 * Takes the rows the panel is ALREADY showing rather than narrowing to a week itself, so the boxes
 * cover exactly what is listed above them. Two narrowings would differ the first time one of them
 * changed, and the gap would be a drop on screen with no way to say who took it. See dropsInWeek.
 *
 * Left out, each for its own reason:
 *
 *  - a drop that is not the one asked for.
 *  - one already sold or taken, whose payouts were pinned from the roster that ran it.
 *  - a night of one stack, which cannot be shared however anybody agreed.
 *  - a night that folds to ONE holder. One person's three characters took three stacks and all
 *    three are still theirs, so there is nothing to hand out and no debt to get wrong.
 */
export function assignableDrops(party: Party, loot: Loot[], drop: PickupDrop): StackDrop[] {
  const drops: StackDrop[] = [];

  for (const row of loot) {
    if (row.dropKey !== drop.dropKey || row.quantity < 1) continue;
    if (row.soldAt !== null || row.takenByMemberId !== null) continue;
    const bundles = row.bundles ?? 0;
    if (bundles < 2) continue;

    const seats = ranSeats(row, party);
    if (foldSeats(seats).length < 2) continue;

    const counts: Record<string, number> = {};
    for (const b of row.bundlesBy) counts[b.memberId] = b.bundles;
    // Readable only when the recorded stacks all belong to seats that ran and add up to what fell.
    const recorded =
      row.bundlesBy.length > 0 &&
      seats.reduce((sum, s) => sum + (counts[s.id] ?? 0), 0) === bundles;

    drops.push({
      lootId: row.id,
      quantity: row.quantity,
      bundles,
      size: row.quantity / bundles,
      seats,
      recorded,
      counts: recorded ? counts : {},
      behind: drop.behind,
    });
  }
  return drops;
}

/**
 * How many stacks each seat's box opens on.
 *
 * The order heldByHolder reads in, so the boxes show what the app already believes rather than a
 * fresh guess laid over the top of it:
 *
 *  - the arrangement recorded, so a wrong one is corrected rather than only added to.
 *  - the party's agreed looter holding the lot, which is what naming one means.
 *  - the balanced split, odd stack to whoever is furthest behind.
 *
 * A suggestion in the last two cases and never a stored one: the balance moves when an earlier week
 * is edited, and a guess written down would rewrite nights already settled. Nothing is saved until
 * somebody presses the button.
 */
export function openingCounts(drop: StackDrop, party: Party): Record<string, number> {
  if (drop.recorded) return { ...drop.counts };

  // Only when that seat actually ran. A looter who sat the week out cannot have picked anything up,
  // and opening on them would suggest a night that did not happen.
  const looter = drop.seats.find((s) => s.id === party.looterMemberId);
  if (looter) return { [looter.id]: drop.bundles };

  const suggested = suggestArrangement(drop.bundles, drop.seats, drop.behind);
  return Object.fromEntries(drop.seats.map((s) => [s.id, suggested.get(s.id) ?? 0]));
}

/** What the boxes come to. Compared against the stacks that fell, which is the only rule there is. */
export function assignedStacks(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/**
 * The arrangement as the server takes it: seat id to stacks, with the empty-handed left out.
 *
 * A seat on zero is ABSENT rather than sent a zero, which the server refuses: somebody who did not
 * bend down is not present with none.
 */
export function stacksToSave(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
}

/** What one person picked up, and what they were owed, both in PIECES. */
export type Tally = {
  /** Pieces the boxes give them: their stacks times the stack size. */
  took: number;
  /** Pieces their share comes to out of what fell. */
  due: number;
};

/**
 * What each holder took and what they were due, in PIECES.
 *
 * Both numbers, not the difference between them. The difference alone said a member was 60 over
 * without ever saying 60 out of WHAT, so a row could not be checked against what actually happened:
 * "he has 120 and he was owed 60" is the sentence somebody says out loud, and neither half of it
 * can be worked out from the other.
 *
 * Measured per HOLDER and reported against every seat of theirs, both halves alike. Two characters
 * of one person net out against each other rather than reading as one owed and one owing, and a
 * person who brings two characters is due twice as much and due it once.
 */
export function pieceTallies(drop: StackDrop, counts: Record<string, number>): Map<string, Tally> {
  const holders = foldSeats(drop.seats);
  const weight = holders.reduce((sum, h) => sum + h.shares, 0);
  const tallies = new Map<string, Tally>();
  if (weight <= 0) return tallies;

  const took = new Map<string, number>();
  for (const seat of drop.seats) {
    const key = holderKey(holderOf(seat));
    took.set(key, (took.get(key) ?? 0) + (counts[seat.id] ?? 0) * drop.size);
  }
  for (const holder of holders) {
    tallies.set(holder.key, {
      took: took.get(holder.key) ?? 0,
      due: (drop.quantity * holder.shares) / weight,
    });
  }
  return tallies;
}

/** A box's value as whole stacks, or null when it is not one. Blank is none: nobody bent down. */
export function parseWholeStacks(value: string): number | null {
  const text = value.trim();
  if (text === "") return 0;
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

/**
 * The night ABOUT to be logged, as a drop the pickup boxes can open on.
 *
 * Not from the pool, because there is no row yet, which is the whole point of it. The stack COUNT is
 * the catalog's for this boss and mode and does not move with the quantity typed, which is how the
 * server derives it too, so a night entered at half the usual haul still falls in the same stacks.
 *
 * Null on the two grounds assignableDrops leaves a night out for: one stack cannot be shared, and a
 * night folding to a single holder has nothing to hand over.
 */
export function draftDrop(
  config: ShareConfig,
  quantity: number,
  behind: Map<string, number>,
): StackDrop | null {
  if (config.bundles < 2 || quantity < 1) return null;
  if (foldSeats(config.seats).length < 2) return null;
  return {
    lootId: "",
    quantity,
    bundles: config.bundles,
    size: quantity / config.bundles,
    seats: config.seats,
    recorded: false,
    counts: {},
    behind,
  };
}

/** Nothing has been said about this night, which is a drop logged exactly as it always was. */
export function draftUnanswered(drop: StackDrop, boxes: Record<string, string>): boolean {
  return drop.seats.every((seat) => (boxes[seat.id] ?? "").trim() === "");
}

/**
 * What a draft's boxes come to, as the server takes it, or null while they do not add up.
 *
 * Empty for boxes nobody has filled in, which sends no arrangement at all and leaves the drop
 * unanswered. That escape hatch is the point: the boxes open on a SUGGESTION, and a suggestion
 * nobody can decline would be the stored guess this file refuses to write. Clearing them is how you
 * say "I do not know yet", exactly as adding a drop has always left it.
 *
 * Null is what keeps a half-filled arrangement from being sent. The server refuses one that does not
 * account for every stack, and a refusal there now takes the DROP down with it, so the form asks
 * this before submitting rather than finding out afterwards.
 */
export function draftStacks(
  drop: StackDrop,
  boxes: Record<string, string>,
): Record<string, number> | null {
  if (draftUnanswered(drop, boxes)) return {};
  const parsed = drop.seats.map((seat) => parseWholeStacks(boxes[seat.id] ?? ""));
  if (parsed.some((value) => value === null)) return null;
  const whole = Object.fromEntries(drop.seats.map((seat, i) => [seat.id, parsed[i] ?? 0]));
  return assignedStacks(whole) === drop.bundles ? stacksToSave(whole) : null;
}

/** The boxes a draft opens on: the same suggestion the recorded boxes open on. See openingCounts. */
export function draftBoxes(drop: StackDrop, party: Party): Record<string, string> {
  return Object.fromEntries(
    Object.entries(openingCounts(drop, party)).map(([id, n]) => [id, String(n)]),
  );
}
