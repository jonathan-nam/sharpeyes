import { BOSS_HP } from "@/lib/boss-hp";
import type { Party } from "@/types/party";

/** The party's boss at the mode it runs, as total HP in trillions. 0 when nobody has said a mode. */
export function partyHp(party: Pick<Party, "bossKey" | "difficulty" | "weekDifficulty">): number {
  const mode = party.weekDifficulty ?? party.difficulty;
  return (mode && BOSS_HP[party.bossKey]?.[mode]) || 0;
}

/** The main's parties first, and within each half the hardest boss first. See `hp` in bosses.yaml. */
export function hardestFirst<P extends Pick<Party, "bossKey" | "difficulty" | "weekDifficulty">>(
  rows: { party: P; main: boolean }[],
): P[] {
  return [...rows]
    .sort((x, y) => Number(y.main) - Number(x.main) || partyHp(y.party) - partyHp(x.party))
    .map(({ party }) => party);
}
