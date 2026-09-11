import type { SeatedParty } from "@/types/party";

/** Somebody else's parties, filed under the character of yours that sits in them. */
export type SharedGroup = {
  characterId: string;
  parties: SeatedParty[];
};

/**
 * Shared parties grouped by which character of yours is in them, in your own character order.
 *
 * The same question the owner's list answers about their own configs, asked from the other end:
 * seventeen cards in a row say nothing about which character has a night tonight. Ordered to match
 * that list, so the two read down the page the same way.
 *
 * A party whose character this account cannot place goes last rather than nowhere. Dropping it
 * would be a shorter list that looks complete, which is worse than a heading with no name behind it.
 */
export function bySeatedCharacter(parties: SeatedParty[], characterOrder: string[]): SharedGroup[] {
  const rank = new Map(characterOrder.map((id, i) => [id, i]));
  const groups = new Map<string, SharedGroup>();
  for (const party of parties) {
    const group = groups.get(party.yourCharacterId);
    if (group) group.parties.push(party);
    else
      groups.set(party.yourCharacterId, { characterId: party.yourCharacterId, parties: [party] });
  }
  const last = characterOrder.length;
  return [...groups.values()].sort(
    (a, b) => (rank.get(a.characterId) ?? last) - (rank.get(b.characterId) ?? last),
  );
}
