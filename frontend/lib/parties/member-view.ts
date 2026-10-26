import type { Party, PartyMember, SeatedParty } from "@/types/party";

// What a member sees of a party somebody else owns, and from whose side. Every screen that draws one
// reads it through here, so no two can disagree about which seats are yours. The server's half,
// which drops a member reads, is backend parties/MemberReads.kt.

/**
 * A party somebody else owns, from your side: filed under the character of yours that sits in it,
 * and with your seats marked as yours rather than the owner's.
 *
 * The response is the owner's own row, so its `characterId` and every seat's are the OWNER'S
 * characters. Anything that asks "is this seat mine" (isMine, the Drop Log, a row's Mark Paid) would
 * answer for the owner. Both `members` and `seats` are re-marked, since each is read by something.
 */
export function fromYourSide(party: Party, mySeatIds: string[], yourCharacterId: string): Party {
  const mark = (seat: PartyMember): PartyMember => ({
    ...seat,
    characterId: mySeatIds.includes(seat.id) ? yourCharacterId : null,
  });
  return {
    ...party,
    // The seated list leaves this at its default, which is true. See PartyResponse.yours.
    yours: false,
    // The seats a member's pool controls act as. See memberSeats.
    yourSeats: mySeatIds,
    characterId: yourCharacterId,
    members: party.members.map(mark),
    seats: party.seats.map(mark),
  };
}

/** A row of Party View, Run Order or onboarding for a party you sit in. */
export function asYourRow({ party, mySeatIds, yourCharacterId }: SeatedParty): Party {
  return fromYourSide(party, mySeatIds, yourCharacterId);
}

/**
 * The party page's party, from your side when it is somebody else's. Your character is the one your
 * own seat links to; a payload cached before `yourSeats` existed names none, and reads as nobody's.
 */
export function asSeenBy(party: Party): Party {
  if (party.yours !== false) return party;
  const mine = party.yourSeats ?? [];
  const yours = party.seats.find((seat) => mine.includes(seat.id))?.linkedCharacterId;
  return fromYourSide(party, yours ? mine : [], yours ?? "");
}

/** The seats a member acts as in a party they do not own, or null when it is their own. */
export function memberSeats(party: Party): Set<string> | null {
  return party.yours === false ? new Set(party.yourSeats ?? []) : null;
}

/**
 * A week's roster typed on your row of a party somebody else owns, as the owner's save takes it.
 *
 * Your row lists the owner's seat among the others and leaves yours out (see asYourRow), and the
 * server reads `members` as everybody but the owner. Sent as typed, it would drop you from the week.
 */
export function ownersRoster({ party, mySeatIds }: SeatedParty, others: string[]): string[] {
  const owner = party.members.find((m) => m.characterId === party.characterId)?.name.toLowerCase();
  const mine = party.members.filter((m) => mySeatIds.includes(m.id)).map((m) => m.name);
  return [...mine, ...others].filter((name) => name.toLowerCase() !== owner);
}
