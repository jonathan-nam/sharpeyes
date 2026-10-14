import type { PieceSyncGap, PieceSyncGapReason } from "@/types/piece-sync";

const REASONS: Record<PieceSyncGapReason, string> = {
  NO_DIFFICULTY: "no difficulty set",
  PARTY_LOOT: "party loot",
  BEFORE_SYNC: "cleared before sync",
};

/** One line per cleared boss whose pieces were not added. */
export function gapLine(gap: PieceSyncGap): string {
  return `${gap.characterName} · ${gap.bossName}: ${REASONS[gap.reason]}`;
}
