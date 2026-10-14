// Mirrors backend's tokens/PieceSyncRoutes.kt field-for-field. Served at /api/tokens/sync.

export type PieceSyncGapReason = "NO_DIFFICULTY" | "PARTY_LOOT" | "BEFORE_SYNC";

// A boss cleared this week whose pieces are not in the inventory.
export type PieceSyncGap = {
  characterId: string;
  characterName: string;
  bossKey: string;
  bossName: string;
  reason: PieceSyncGapReason;
};

export type PieceSync = {
  enabled: boolean;
  // Empty while the sync is off.
  gaps: PieceSyncGap[];
};

export type SavePieceSyncBody = {
  enabled: boolean;
};
