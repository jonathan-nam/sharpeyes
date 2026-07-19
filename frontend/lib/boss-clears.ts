import type { BossClear } from "@/types/boss";

// Three states, not two, and the third is the point.
//
// A boss with no row has not been reported for this period: no capture has said anything about it.
// That is NOT "not cleared". Collapsing the two would turn a character whose planner was never
// captured into a character who cleared nothing, which is a confident wrong answer of exactly the
// kind this project exists to avoid.
export type CellState = "cleared" | "pending" | "unseen";

/** Index one character's clears for lookup. 16 bosses by N characters is a lot of find() scans. */
export function indexClears(clears: BossClear[] | undefined): Map<string, boolean> {
  return new Map((clears ?? []).map((c) => [c.bossKey, c.cleared]));
}

export function cellState(clears: Map<string, boolean> | undefined, bossKey: string): CellState {
  if (!clears || !clears.has(bossKey)) return "unseen";
  return clears.get(bossKey) ? "cleared" : "pending";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-07-16" -> "16 Jul".
 *
 * Parsed by hand rather than through Date on purpose: `new Date("2026-07-16")` is UTC midnight,
 * which renders as the 15th for every viewer behind UTC. The whole job of this label is to say
 * which period you are looking at, so being a day out defeats it.
 */
export function formatPeriod(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  if (!month || !day || month < 1 || month > MONTHS.length) return iso;
  return `${day} ${MONTHS[month - 1]}`;
}
