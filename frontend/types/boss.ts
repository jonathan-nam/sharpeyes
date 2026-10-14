// Mirrors backend's bosses/BossDtos.kt field-for-field.

export type Boss = {
  bossKey: string;
  name: string;
  // WEEKLY / DAILY / MONTHLY. Two bosses in the same matrix are not counting the same span of
  // time, so the cadence has to be visible rather than implied by column position.
  reset: string;
  // The boss's own planner portrait, backend-relative. Resolve with apiAssetUrl().
  iconUrl: string | null;
  // The modes it can be fought at, lowest first: what a party config picks from. CHAOS is the
  // third rung's name for the bosses that are monsters, so a boss has HARD or CHAOS, never both.
  difficulties: string[];
  // What one clear puts in one inventory, per mode and world. Optional: a cached boss list from
  // before this field read as having none.
  pieces?: BossPiece[];
};

export type BossPiece = {
  difficulty: string;
  world: string;
  tokenName: string;
  iconUrl: string | null;
  quantity: number;
  stackSize: number;
  // One pile for the whole party, divided by the config's piece ratio.
  pooled: boolean;
};

export type BossClear = {
  bossKey: string;
  cleared: boolean;
  // The period this row answers for, so nothing here has to recompute a reset boundary.
  periodStart: string;
  capturedAt: string;
};

// Keyed by character id, as /api/bosses/clears returns it.
export type BossClearsByCharacter = Record<string, BossClear[]>;

// Character id -> the boss keys that character does not run. A standing fact with no period, which
// is what separates it from a clear: see V25__character_boss_skip.sql.
export type BossSkipsByCharacter = Record<string, string[]>;

// One view of the matrix, as /api/bosses/clears returns it. The navigation and the reset instants
// are served, not computed here, so the reset boundary keeps its single implementation in
// bosses/BossPeriod.kt. See BossClearsViewResponse.
export type BossClearsView = {
  clearsByCharacter: BossClearsByCharacter;
  // Empty on a past week. The marks say what is true now, so they are not painted over old weeks.
  skipsByCharacter: BossSkipsByCharacter;
  // Null when showing the current period, which spans all three cadences.
  weekStart: string | null;
  // Null at either end of the stored history.
  previousWeekStart: string | null;
  nextWeekStart: string | null;
  // The week now in progress. Stepping forward onto it means returning to the live view.
  currentWeekStart: string;
  // Cadence -> ISO instant of the next rollover. Always about now, even in a history view.
  nextResets: Record<string, string>;
  // The server's clock when it answered, so the countdown does not trust the browser's.
  now: string;
};
