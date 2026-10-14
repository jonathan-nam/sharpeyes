import type { ScreenshotResult } from "@/types/screenshot";

// A planner capture is trustworthy only if it read the whole list. Two things break that, and
// neither is visible in the clears themselves: a row the reader could not name is simply absent,
// and an absent row is indistinguishable from a boss that was not cleared; a capture that stopped
// short of the bottom looks exactly like a shorter list. So both are surfaced as caveats on the
// capture rather than left for the matrix to imply.
export type PlannerCaveat = "unreadable-rows" | "truncated";

export function plannerCaveats(result: {
  unreadableBossRows: number | null;
  reachedBossListEnd: boolean | null;
}): PlannerCaveat[] {
  const caveats: PlannerCaveat[] = [];
  if ((result.unreadableBossRows ?? 0) > 0) caveats.push("unreadable-rows");
  // Only false is a problem. Null means the capture held no planner, so there was no list to reach
  // the end of, and saying "truncated" there would be a warning about nothing.
  if (result.reachedBossListEnd === false) caveats.push("truncated");
  return caveats;
}

export function describeCaveat(caveat: PlannerCaveat, unreadableRows: number): string {
  if (caveat === "unreadable-rows") {
    const n = `${unreadableRows} ${unreadableRows === 1 ? "row" : "rows"}`;
    return `${n} unreadable. Upload a clearer capture.`;
  }
  return "The list is cut off. Scroll down and add another.";
}

// Whether a result carries a planner at all. A capture can hold the inventory, the planner, or
// both, and the dock on the Individual View page should stay quiet about the inventory half.
export function hasPlanner(result: Pick<ScreenshotResult, "bossClears" | "reachedBossListEnd">) {
  return result.bossClears.length > 0 || result.reachedBossListEnd !== null;
}

export function clearedCount(result: Pick<ScreenshotResult, "bossClears">) {
  return result.bossClears.filter((c) => c.cleared).length;
}
