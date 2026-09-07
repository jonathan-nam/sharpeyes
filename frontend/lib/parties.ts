// Reading a set of party configs.
//
// A config is one of your characters, on one boss, with the people that character runs it with:
// "mechyfechy runs Kalos with CreedBratton". A boss that character solos has a config too, holding
// what fell on it, but it is not a party and is not in any list this file reads: /api/parties leaves
// solo configs out unless asked, which is what keeps the list short enough to read.

import { weekEndExclusive } from "@/lib/boss-clears";
import type { Boss } from "@/types/boss";
import type { BossDrop } from "@/types/drop";
import type { Party } from "@/types/party";

/** Six seats, the game's own party limit. Mirrors MAX_PARTY_SIZE in PartyQueries.kt. */
export const MAX_PARTY = 6;

/** The others: every seat but your own character's, which is the config itself. */
export function otherMembers(party: Party) {
  return party.members.filter((m) => m.characterId !== party.characterId);
}

/**
 * What a roster of text boxes actually states: trimmed, with the boxes nobody filled in dropped.
 *
 * RosterInputs always carries a box, and "+ Member" adds an empty one, so what is on screen is
 * never quite what to send. Blank is not a refusal, it is a seat somebody opened and did not use,
 * and refusing over it would make the add button a trap. The rules that matter are the server's
 * (validateMembers refuses nobody, a blank, and the same character twice) and it states them
 * itself.
 */
export function namedSeats(members: string[]): string[] {
  return members.map((m) => m.trim()).filter((m) => m !== "");
}

/**
 * Your own character's seat, which is the half of a config that can never be edited.
 *
 * `seats` and not `members`, so a week your character sat out still answers: this is the config's
 * own identity rather than one week's roster, and it is what the slug is built from.
 */
export function ownMember(party: Party) {
  return party.seats.find((s) => s.characterId === party.characterId) ?? null;
}

/**
 * The others in the party ITSELF, rather than in the week being shown.
 *
 * What the config editor edits. `members` is one week's roster, and a week that has been written
 * into keeps the party it ran (see pinWeeksAlreadyWritten), so editing off it would offer this
 * week's guest as a standing member and drop the member who sat the week out.
 */
export function standingMembers(party: Party) {
  return party.seats.filter((s) => !s.guest && s.characterId !== party.characterId);
}

/**
 * Every character name the app already knows: your roster, the people list, and whoever is already
 * sitting in a party.
 *
 * Not a nicety. Seats are matched to existing rows by name, so a spelling that misses does not
 * rename a seat, it abandons that one and makes another.
 */
export function knownCharacterNames(
  characters: { name: string }[],
  people: { characters: string[] }[],
  parties: Party[],
): string[] {
  return Array.from(
    new Set([
      ...characters.map((c) => c.name),
      ...people.flatMap((p) => p.characters),
      ...parties.flatMap((p) => p.members.map((m) => m.name)),
    ]),
  ).sort();
}

/**
 * How a party of this size gets said out loud. "Duo" and "trio" are what people call these; four
 * and up have no such word, so they keep the count.
 */
export function partySizeLabel(size: number): string {
  if (size <= 1) return "Solo";
  if (size === 2) return "Duo";
  if (size === 3) return "Trio";
  return `${size}-man`;
}

/**
 * Whether this config is done for the period it is in.
 *
 * Strictly `=== true`. Null is "no capture has said anything about it", which is a row that still
 * needs an answer rather than a finished one, so it counts as outstanding. party-card.tsx draws
 * the same line when it steps a cleared row back.
 */
export function isCleared(party: Party): boolean {
  return party.cleared === true;
}

/**
 * The configs actually being run in the period on screen.
 *
 * A party taken off a period is still a party: the config stands, its pool stands, and it comes
 * back on its own next period. What it is not is work outstanding, so it is out of the list and out
 * of every count beside it. Shared with Run Order so a night cannot be planned around a boss this
 * page has already dropped.
 */
export function runningThisPeriod(parties: Party[]): Party[] {
  return parties.filter((party) => !party.skippedThisPeriod);
}

/** What the party list is narrowed to. "not-cleared" is everything `isCleared` rejects. */
export type ClearFilter = "all" | "not-cleared" | "cleared";

/**
 * The configs a filter admits, in the order they came in.
 *
 * `cleared` is the config's own answer by default. Party View passes its own on a past week, where
 * the clear comes from that week's rows rather than from the config: filtering on party.cleared
 * there would narrow the list by THIS week's state while showing last week's ticks.
 */
export function filterByClear(
  parties: Party[],
  filter: ClearFilter,
  cleared: (party: Party) => boolean = isCleared,
): Party[] {
  if (filter === "all") return parties;
  return parties.filter((party) => cleared(party) === (filter === "cleared"));
}

/**
 * The configs that already existed in the week starting `weekStart`.
 *
 * A config is not history. It says who you run a boss with NOW, so drawing today's list under a past
 * week attributed that week's clears to parties which did not exist then, beside a roster that was
 * not that week's roster. The clear was real, the party around it was imported from this week.
 *
 * Compared as UTC days, not as instants: both sides are already UTC, and comparing the timestamps
 * would turn on how many fractional-second digits Postgres happened to emit.
 */
export function existedInWeek(parties: Party[], weekStart: string): Party[] {
  const end = weekEndExclusive(weekStart);
  return parties.filter((party) => party.createdAt.slice(0, 10) < end);
}

export type PartyGroup<T> = {
  key: T;
  parties: Party[];
};

/**
 * Configs grouped under the character they belong to, in roster order.
 *
 * A character with no configs is absent rather than shown empty: they solo everything, or you have
 * not filled them in, and either way there is nothing to read.
 */
export function byCharacter(parties: Party[], characterOrder: string[]): PartyGroup<string>[] {
  return characterOrder
    .map((characterId) => ({
      key: characterId,
      parties: parties.filter((p) => p.characterId === characterId),
    }))
    .filter((group) => group.parties.length > 0);
}

/**
 * Configs grouped under the boss they are for, in catalog order.
 *
 * The other way to read the same list: "who am I doing Kalos with tonight" rather than "what does
 * this character run".
 */
export function byBoss(parties: Party[], bosses: Boss[]): PartyGroup<Boss>[] {
  return bosses
    .map((boss) => ({ key: boss, parties: parties.filter((p) => p.bossKey === boss.bossKey) }))
    .filter((group) => group.parties.length > 0);
}

export type ConsolidatedParty = {
  key: string;
  characterId: string;
  /** The roster, taken from the first config: they are identical by construction. */
  members: Party["members"];
  /** The configs this arrangement covers, one per boss, in the order they arrived (catalog). */
  parties: Party[];
};

/**
 * Configs with the same roster, merged into one entry per arrangement.
 *
 * A duo with CreedBratton across Kalos, First Adversary and Baldrix is one arrangement and three
 * runs. Per boss is the right shape on the night; per arrangement is the right shape when the
 * question is who you run with rather than what is on tonight.
 *
 * A VIEW, not a merge of the underlying configs. Each boss keeps its own config and its own loot
 * pool, because a drop comes off one boss and a pool that pooled three would be back to the
 * splitting-what-cannot-be-split problem.
 */
export function consolidate(parties: Party[], characterOrder: string[]): ConsolidatedParty[] {
  const groups = new Map<string, ConsolidatedParty>();

  for (const characterId of characterOrder) {
    for (const party of parties.filter((p) => p.characterId === characterId)) {
      // Sorted and lowercased, so the same people in a different order are the same arrangement.
      const roster = otherMembers(party)
        .map((m) => m.name.trim().toLowerCase())
        .sort()
        .join("|");
      const key = `${characterId}::${roster}`;
      const existing = groups.get(key);
      if (existing) {
        existing.parties.push(party);
      } else {
        groups.set(key, { key, characterId, members: party.members, parties: [party] });
      }
    }
  }

  return [...groups.values()];
}

/**
 * The arrangements, without the nights.
 *
 * What the edit page answers for. A one-off is a config too, because the pool and the week it ran are
 * records, but it is not something anybody set up: it was made on Party View for one week and it
 * leaves on its own. Party View is where it is seen and taken off.
 *
 * So a one-off's difficulty and split are set when it is added and not afterwards. Adding it again
 * takes over the same config, pool and all (see takeOverParty), which is both how one is corrected
 * and how a night that keeps happening becomes a standing party.
 *
 * Solo-opened nights arrive this way as well, from a drop logged on a boss with no party. See
 * openSoloParty.
 */
export function standingParties(parties: Party[]): Party[] {
  return parties.filter((p) => !p.oneOff);
}

/**
 * A one-off whose period has passed: one night that is over, still holding the pair's slot.
 *
 * Not a boss this character runs, so nothing that asks "what does this character run" counts it.
 * Mirrors isSpentOneOff in PartySkip.kt.
 */
export function isSpentOneOff(party: Party): boolean {
  return party.oneOff && party.skippedThisPeriod;
}

/**
 * Whether this config keeps a roster of its own, behind whatever a week says.
 *
 * A one-off does not. It is one night, and its people are that week's, so there is nothing under
 * the week to go back to: clearing it would leave the config naming nobody, which is a run alone on
 * the page that lists parties. The server refuses it too (validateRosterClear); this is what keeps
 * the button off the screen rather than the whole of the rule.
 */
export function hasStandingRoster(party: Party): boolean {
  return !party.oneOff;
}

/**
 * The bosses whose routine box cannot be un-ticked, because a party config already says this
 * character runs them.
 *
 * Two kinds of config are not that claim. A solo pool holds what fell on a boss run alone, and a
 * spent one-off holds one night that is over. Locking a row over either would leave nothing to
 * "remove first", so the box would never come back. Same line partiedNames draws on the server.
 */
export function partiedBossKeys(parties: Party[], characterId: string): Set<string> {
  return new Set(
    parties
      .filter((p) => p.characterId === characterId && !p.solo && !isSpentOneOff(p))
      .map((p) => p.bossKey),
  );
}

/**
 * The bosses this character can still be given a party for.
 *
 * Everything with no config, plus the one-offs whose period has passed. Those still hold the pair's
 * slot (idx_party_character_boss), and the server takes the config over rather than making a second
 * one, so offering them offers something that works.
 *
 * A STANDING party taken off the period is not here. It has a config, it is on again next period,
 * and adding over it would overwrite the roster and difficulty it already carries. Nothing puts it
 * back sooner, which is what taking it off means.
 *
 * A RETIRED one is offered, and has to be: it holds the pair's slot too, so the boss would
 * otherwise be unaddable forever. Adding it revives that config, pool and all. See takeOverParty.
 */
export function bossesWithoutConfig(parties: Party[], bosses: Boss[], characterId: string): Boss[] {
  const taken = new Set(
    parties.filter((p) => p.characterId === characterId && !isSpentOneOff(p)).map((p) => p.bossKey),
  );
  return bosses.filter((boss) => !taken.has(boss.bossKey));
}

/**
 * The config a drop on this character and boss will land in, or undefined.
 *
 * The same lookup the server makes for a drop that names a character and a boss rather than a pool,
 * and one config per pair is what makes it a lookup rather than a choice. `standing` is no part of
 * it there, so a retired config answers here exactly as it does there. See partyIdFor.
 *
 * Only ever as complete as the list it is handed. Given the standing configs alone it answers
 * undefined for a retired one, which is not distinguishable from a boss with no config at all, and
 * those two file a drop very differently.
 */
export function configFor(
  parties: Party[],
  characterId: string,
  bossKey: string,
): Party | undefined {
  return parties.find((p) => p.characterId === characterId && p.bossKey === bossKey);
}

/**
 * The drop this boss gives for certain at the mode a party runs, or null.
 *
 * Read off the boss's own table, so it is a fact about the boss rather than about anything that has
 * happened: vestige coupons drop every time it dies, and the amount is per (boss, difficulty, world).
 * Null when nobody has said which difficulty, since a boss that drops them at Extreme drops none at
 * Chaos, and read against the party's own world, since a mode can give a pile in one and nothing in
 * the other.
 */
export function guaranteedDrop(
  table: BossDrop[] | undefined,
  difficulty: string | null,
  world: string,
): BossDrop | null {
  if (!table || difficulty === null) return null;
  return table.find((drop) => (drop.pieces?.[world]?.[difficulty] ?? 0) > 0) ?? null;
}

/**
 * Whether a clear on this boss can say anything about what fell, at any mode.
 *
 * What decides whether the mode is worth asking for. A clear on a boss run ALONE files what the
 * catalog guarantees, and a party's mode fills the count when the drop is typed, so on a boss with no
 * amount at any of its modes there is nothing for a mode to unlock and a select beside it would be a
 * control that does nothing. Eight bosses of the catalog have one.
 */
export function hasGuaranteedDrop(table: BossDrop[] | undefined): boolean {
  return (table ?? []).some((drop) => Object.keys(drop.pieces ?? {}).length > 0);
}
