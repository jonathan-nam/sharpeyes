import type { PieceSyncGap, PieceSyncGapReason } from "@/types/piece-sync";

const REASONS: Record<PieceSyncGapReason, string> = {
  NO_DIFFICULTY: "no difficulty set",
  PARTY_LOOT: "pieces not added on Party View",
  BEFORE_SYNC: "cleared before sync",
};

/** One line per cleared boss whose pieces were not added. */
export function gapLine(gap: PieceSyncGap): string {
  return `${gap.characterName} · ${gap.bossName}: ${REASONS[gap.reason]}`;
}
