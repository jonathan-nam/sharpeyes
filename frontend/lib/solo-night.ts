import { runsFromParties, stillToRun, YOU } from "@/lib/boss-night";
import { EMPTY_PLAN, type Plan, planNight, screenRuns } from "@/lib/boss-run-plan";
import { runningThisPeriod } from "@/lib/parties";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";

/**
 * Run Order with nobody on but you, untimed: the home screen's quick version of the page.
 *
 * The same chain the page runs with every other chip off, so the two cannot order one night
 * differently. `total` counts the solo runs before the clear filter, which is what tells "nothing
 * you can run alone" from "all of it cleared".
 */
export function soloNight(
  parties: Party[],
  bosses: Boss[],
  tickedHere: ReadonlySet<string>,
): { plan: Plan; total: number } {
  const running = runningThisPeriod(parties);
  const solo = (list: Party[]) => screenRuns(runsFromParties(list, bosses), [YOU]).eligible;

  const runs = solo(stillToRun(running, tickedHere));
  const { byCount } = planNight(runs, { minutes: Infinity });
  return { plan: byCount[byCount.length - 1] ?? EMPTY_PLAN, total: solo(running).length };
}
