import type { Party, SeatedParty } from "@/types/party";

/**
 * A party somebody else owns, as a row of yours: filed under the character of yours that sits in it,
 * and with your seats marked as yours rather than the owner's.
 *
 * The response is the owner's own row, so its `characterId` and every seat's are the OWNER'S
 * characters, and a roster drawn from it would mark them as yours. Party View files these beside
 * your own parties and onboarding lists them, and both read them through here.
 */
export function asYourRow({ party, mySeatIds, yourCharacterId }: SeatedParty): Party {
  return {
    ...party,
    // The list answer leaves this at its default, which is true. See PartyResponse.yours.
    yours: false,
    characterId: yourCharacterId,
    members: party.members.map((m) => ({
      ...m,
      characterId: mySeatIds.includes(m.id) ? yourCharacterId : null,
    })),
  };
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
