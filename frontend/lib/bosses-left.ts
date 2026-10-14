import {
  cellState,
  type ClearProgress,
  clearProgress,
  indexClears,
  indexSkips,
} from "@/lib/boss-clears";
import { WEEKLY_CADENCE } from "@/lib/reset-countdown";
import type { Boss, BossClearsView } from "@/types/boss";
import type { Character } from "@/types/character";

export type CharacterLeft = { character: Character; progress: ClearProgress; left: Boss[] };

/**
 * Each character's weekly bosses still to clear, in roster order: the Individual View's column
 * counts, with the names behind them.
 *
 * An unseen boss is left, as it is in the matrix's count. A character with nothing to run is
 * dropped rather than shown as done.
 */
export function weeklyLeft(
  bosses: Boss[],
  characters: Character[],
  view: Pick<BossClearsView, "clearsByCharacter" | "skipsByCharacter">,
): CharacterLeft[] {
  const weekly = bosses.filter((boss) => boss.reset === WEEKLY_CADENCE);
  const skips = indexSkips(view.skipsByCharacter);
  return characters.flatMap((character) => {
    const clears = indexClears(view.clearsByCharacter[character.id]);
    const states = weekly.map((boss) => cellState(clears, boss.bossKey, skips.get(character.id)));
    const progress = clearProgress(states, true);
    if (progress.total === 0) return [];
    const left = weekly.filter((_, i) => states[i] === "pending" || states[i] === "unseen");
    return [{ character, progress, left }];
  });
}
