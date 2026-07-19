// Mirrors backend's screenshots/ScreenshotDtos.kt field-for-field.
export type ScreenshotOutcome =
  | "MATCHED"
  | "MISMATCH"
  | "NEW_CHARACTER_DETECTED"
  | "UNRESOLVABLE"
  | "UNRECOGNIZED_SCREENSHOT"
  | "FAILED";

export type DetectedToken = {
  // The parser's key, e.g. "kalos-token".
  tokenName: string;
  // The human name, e.g. "Kalos's Residual Determination". Resolved server-side
  // from the catalog, it is NOT derivable from tokenName, and assuming it was
  // is exactly what silently broke token persistence.
  displayName: string;
  // The catalog row's id. Lets the preview line this count up against what is already stored
  // and show the difference, without matching on a display name.
  tokenCatalogId: string | null;
  // Which section of the inventory this belongs in.
  itemGroup: string | null;
  iconUrl: string | null;
  quantity: number;
};

export type DetectedBossClear = {
  // The catalog key, e.g. "chosen-seren".
  bossKey: string;
  // Resolved server-side from boss_catalog, for the reason DetectedToken carries one: the prose
  // name is not derivable from the key.
  displayName: string;
  cleared: boolean;
};

export type ScreenshotResult = {
  screenshotId: string;
  outcome: ScreenshotOutcome;
  detectedCharacterName: string | null;
  detectedLevel: number | null;
  pinnedCharacterName: string | null;
  failureReason: string | null;
  // Sent on every outcome, not just the successful one: a screenshot that needs
  // review has still been fully parsed, and showing what we read turns a blank,
  // baffling row into a one-click confirmation.
  tokenCounts: DetectedToken[];
  // Same rule as tokenCounts. One capture can hold the inventory and the Maple Planner at once, so
  // these are additional to the tokens above, not instead of them.
  bossClears: DetectedBossClear[];
  // Re-capture signals, not data. See lib/boss-capture.ts for what they mean and why they have to
  // reach the screen.
  unreadableBossRows: number | null;
  reachedBossListEnd: boolean | null;
};
