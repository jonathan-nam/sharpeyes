import type { PartyLootPool } from "@/types/loot";
import type { Party } from "@/types/party";

/**
 * Drops in YOUR OWN parties that a shared party already records: a character of yours seated in both,
 * same boss, same week. A character clears a boss once a week, so both books are describing one run, and the owner's
 * copy is the one that counts (decided 2026-10-21). Keyed by loot id, naming whose party has it.
 *
 * Only weeks the shared party logged something in. A week only your copy has is the only record of
 * it, and dropping that would lose a drop rather than a duplicate.
 */
export function loggedTwice(
  own: { parties: Party[]; pools: PartyLootPool[] },
  /** Shared parties from your side (lib/shared-history.ts), each with the name of whose it is. */
  shared: { parties: Party[]; pools: PartyLootPool[]; ownerOf: Map<string, string> },
): Map<string, string> {
  // Your characters in a party: seats with a character id, after fromYourSide's swap for a shared one.
  const keys = (party: Party) =>
    [...new Set([party.characterId, ...(party.seats ?? []).map((m) => m.characterId)])]
      .filter((id): id is string => id != null)
      .map((id) => `${id}|${party.bossKey}`);
  const sharedById = new Map(shared.parties.map((p) => [p.id, p]));
  // Per character and boss: the weeks a shared party logged, and whose party it was.
  const recorded = new Map<string, Map<string, string>>();
  for (const pool of shared.pools) {
    const party = sharedById.get(pool.partyId);
    if (!party) continue;
    for (const key of keys(party)) {
      const weeks = recorded.get(key) ?? new Map<string, string>();
      for (const loot of pool.loot) weeks.set(loot.weekStart, shared.ownerOf.get(party.id) ?? "");
      recorded.set(key, weeks);
    }
  }

  const ownById = new Map(own.parties.map((p) => [p.id, p]));
  const twice = new Map<string, string>();
  for (const pool of own.pools) {
    const party = ownById.get(pool.partyId);
    const weeks = party ? keys(party).flatMap((k) => recorded.get(k) ?? []) : [];
    for (const loot of pool.loot) {
      const owner = weeks.find((w) => w.has(loot.weekStart))?.get(loot.weekStart);
      if (owner !== undefined) twice.set(loot.id, owner);
    }
  }
  return twice;
}

/** [pools] without the drops in [drop]. */
export function withoutLoot(pools: PartyLootPool[], drop: Map<string, unknown>): PartyLootPool[] {
  if (drop.size === 0) return pools;
  return pools.map((pool) => ({ ...pool, loot: pool.loot.filter((l) => !drop.has(l.id)) }));
}
