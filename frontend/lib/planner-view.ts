// How the Party Planner lays out the parties it proposes: under each character, or under each boss.

import type { PlannedParty } from "@/lib/party-planner";

export type PlanGrouping = "character" | "boss";

export type PlanGroup = { key: string; parties: PlannedParty[] };

/**
 * One group per character, in the order given, holding every party it sits in.
 *
 * A party appears under each of its members, which is the point of this view: what each character
 * runs, and with whom. A character in no party has no group.
 */
export function byCharacter(parties: PlannedParty[], order: string[]): PlanGroup[] {
  return order
    .map((name) => ({
      key: name,
      parties: parties.filter((p) => p.seats.some((s) => s.character === name)),
    }))
    .filter((group) => group.parties.length > 0);
}

/**
 * One group per boss and difficulty, in the catalog's boss order and each boss's own mode order.
 * Keyed `bossKey|DIFFICULTY`.
 */
export function byBoss(
  parties: PlannedParty[],
  bosses: { bossKey: string; difficulties: string[] }[],
): PlanGroup[] {
  const rank = (p: PlannedParty) => {
    const at = bosses.findIndex((b) => b.bossKey === p.bossKey);
    const mode = at < 0 ? 0 : (bosses[at]?.difficulties.indexOf(p.difficulty) ?? 0);
    return (at < 0 ? bosses.length : at) * 10 + mode;
  };
  const groups = new Map<string, PlannedParty[]>();
  for (const p of [...parties].sort((a, b) => rank(a) - rank(b))) {
    const key = `${p.bossKey}|${p.difficulty}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups].map(([key, list]) => ({ key, parties: list }));
}
