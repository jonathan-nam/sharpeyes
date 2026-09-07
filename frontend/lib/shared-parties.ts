import { cellState, clearOfCell } from "./boss-clears";
import { splitOf } from "./loot";
import type { Currency } from "./money";
import type { Loot } from "@/types/loot";
import type { PartyMember, SeatedParty } from "@/types/party";

/**
 * The seat in somebody else's party that a character of YOURS holds.
 *
 * There is always one, or the party would not be in this list at all: reaching it is owning a
 * character with a seat bound to it (backend partiesSeatedIn). Null is still the answer where a
 * response and the seats in it have come apart, because a guess about whose seat it is is a guess
 * about whose share it is.
 */
export function yourSeat(party: SeatedParty): PartyMember | null {
  return party.seats.find((seat) => party.mySeatIds.includes(seat.id)) ?? null;
}

/** Somebody else's parties, filed under the character of yours that sits in them. */
export type SharedGroup = {
  /** The character of yours these are seated on, or null where the seat named none. */
  characterId: string | null;
  /**
   * What that seat is called.
   *
   * The SENDER'S spelling, because accepting binds a seat without renaming it (backend bindSeats).
   * That is the name every roster line on these cards already shows, so taking your own spelling
   * here instead would make the heading the one thing on the screen that disagrees.
   */
  name: string;
  parties: SeatedParty[];
};

/**
 * Shared parties grouped by which character of yours is in them, in your own character order.
 *
 * The same question the owner's list answers about their own configs, asked from the other end:
 * seventeen cards in a row say nothing about which character has a night tonight. Ordered to match
 * that list, so the two read down the page the same way.
 *
 * A party whose seat this account cannot place goes last rather than nowhere. Dropping it would be
 * a shorter list that looks complete, which is worse than a heading with no name behind it.
 */
export function bySeatedCharacter(parties: SeatedParty[], characterOrder: string[]): SharedGroup[] {
  const rank = new Map(characterOrder.map((id, i) => [id, i]));
  const groups = new Map<string, SharedGroup>();
  for (const party of parties) {
    const seat = yourSeat(party);
    const characterId = seat?.linkedCharacterId ?? null;
    const key = characterId ?? `seat:${seat?.name ?? party.id}`;
    const group = groups.get(key);
    if (group) group.parties.push(party);
    else groups.set(key, { characterId, name: seat?.name ?? "", parties: [party] });
  }
  const last = characterOrder.length;
  const at = (group: SharedGroup) =>
    group.characterId === null ? last + 1 : (rank.get(group.characterId) ?? last);
  return [...groups.values()].sort((a, b) => at(a) - at(b));
}

/**
 * Whether YOUR character has cleared a shared party's boss, for the period being shown.
 *
 * Your own account's answer, not the owner's. `boss_clear` is keyed on a CHARACTER, so the tick a
 * party carries is about the owner's character and answers "have they run it", where the question
 * on a shared card is "have I". Both accounts record the same night, once each, because the run is
 * one run and each captures their own planner.
 *
 * Read through cellState and clearOfCell, which is the same reading Party View and the Boss Clears
 * table use. A second way to read a tick is how two screens come to disagree about it.
 *
 * Null where this account cannot answer: your seat has no character bound to it, which is every
 * seat until an invite is accepted. Null is also what "no capture has mentioned it" reads as, and
 * the two are the same thing to a reader, which is nothing claimed either way.
 */
export function yourClear(
  party: SeatedParty,
  clearsByCharacter: Map<string, Map<string, boolean>>,
): boolean | null {
  const mine = yourSeat(party);
  if (!mine?.linkedCharacterId) return null;
  return clearOfCell(cellState(clearsByCharacter.get(mine.linkedCharacterId), party.bossKey));
}

/** What one night leaves in YOUR hands, and whether it has arrived. */
export type YourShare = {
  /** What you end up holding, after the fee on the transfer to you. In `currency`. */
  nets: number;
  paid: boolean;
  /** The unit `nets` is in, off the night's own sale. Cents when USD. */
  currency: Currency;
};

/**
 * Your own share of a night, or null while there is nothing to be owed.
 *
 * Through splitOf, which is the split the OWNER's screens show, so a member reading what they are
 * owed and an owner reading what they owe cannot come to different figures. splitOf wants the seats
 * and not a whole party, which is the reason this works from a SeatedParty at all: those seats are
 * already in hand and no second read of somebody else's pool is needed.
 *
 * Null covers everything that is not an answer: a drop still in the pool, a sale this build cannot
 * read the basis of, and a night whose seats do not include one of yours. A missing figure beats a
 * wrong one, and zero would be a claim that you are owed nothing.
 *
 * The seller is a case of its own. They are not paid, they are the one paying out, so what they
 * hold is `keeps` and it is already in their hands. In an Interactive party the looter sells, and
 * the looter can be the member rather than the owner.
 */
export function yourShare(night: Loot, party: SeatedParty): YourShare | null {
  const split = splitOf(night, party.seats);
  if (!split) return null;
  // Carried out with the figure, never looked up beside it: a share of a dollar sale is cents, and
  // cents drawn through the meso formatter are a thousandth of the debt. See lib/money.ts.
  const currency = split.currency;
  if (party.mySeatIds.includes(split.seller.memberId)) {
    return { nets: split.seller.keeps, paid: true, currency };
  }
  const mine = split.shares.find((share) => party.mySeatIds.includes(share.memberId));
  return mine ? { nets: mine.nets, paid: mine.paid, currency } : null;
}
