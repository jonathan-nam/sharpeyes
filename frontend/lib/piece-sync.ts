import type { PieceSyncGap, PieceSyncGapReason } from "@/types/piece-sync";

const REASONS: Record<PieceSyncGapReason, string> = {
  NO_DIFFICULTY: "no difficulty set",
  PARTY_OFF: "party off this week",
};

/**
 * The gaps worth a line. Filtered by reason rather than trusted whole: a response cached from before
 * a deploy can carry a reason this build no longer draws.
 */
export function shownGaps(gaps: PieceSyncGap[]): PieceSyncGap[] {
  return gaps.filter((gap) => gap.reason in REASONS);
}

/** One line per cleared boss whose pieces could not be added. */
export function gapLine(gap: PieceSyncGap): string {
  return `${gap.characterName} · ${gap.bossName}: ${REASONS[gap.reason]}`;
}
