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
    characterId: yourCharacterId,
    members: party.members.map((m) => ({
      ...m,
      characterId: mySeatIds.includes(m.id) ? yourCharacterId : null,
    })),
  };
}
