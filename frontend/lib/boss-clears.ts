import type {
  Boss,
  BossClear,
  BossClearsByCharacter,
  BossClearsView,
  BossSkipsByCharacter,
} from "@/types/boss";
import type { Character } from "@/types/character";

// Four states, and the last two are both kinds of empty.
//
// A boss with no row has not been reported for this period: no capture has said anything about it.
// That is NOT "not cleared". Collapsing the two would turn a character whose planner was never
// captured into a character who cleared nothing, which is a confident wrong answer of exactly the
// kind this project exists to avoid.
//
// `skipped` splits that silence in two. "Nobody has said anything about Jupiter this week" and
// "this character never runs Jupiter" were one dash before, so a roster where one character runs a
// boss read as fifteen characters who were behind on it. Unlike the other three it carries no
// period: see V25__character_boss_skip.sql.
export type CellState = "cleared" | "pending" | "unseen" | "skipped";

/**
 * What a clear state is called, everywhere one is named out loud.
 *
 * One function because the wording had already split: the party grouping said "done" and "still to
 * do" for the states the filter tabs called "Cleared" and "Not Cleared", so one
 * tick answered to two vocabularies on the same screen.
 */
export function clearStateLabel(cleared: boolean | null): string {
  if (cleared === null) return "not reported";
  return cleared ? "cleared" : "not cleared";
}

/**
 * Which of the three the `.party-clear` pill is drawn in.
 *
 * Named once so the party row's button and its read-only span cannot colour the states apart, the
 * same reason clearStateLabel above exists for the wording. Run Order draws a tick and a gap
 * instead of the pill, so it has no use for this.
 */
export function clearClass(cleared: boolean | null): string {
  return cleared === null ? "unseen" : cleared ? "cleared" : "pending";
}

/**
 * A cell state as the boolean-or-null the rest of the app keeps a clear in.
 *
 * `skipped` is null, the same as never reported: it is not an answer about whether the boss died,
 * it is a statement that the question does not apply.
 */
export function clearOfCell(state: CellState): boolean | null {
  return state === "cleared" ? true : state === "pending" ? false : null;
}

/** The same names, for the matrix, which holds the four states as a CellState. */
export function cellStateLabel(state: CellState): string {
  if (state === "skipped") return "doesn't run";
  return clearStateLabel(clearOfCell(state));
}

/**
 * What a click on a clear in this state should write.
 *
 * One function for the matrix cell and the party card, so the two cannot end up disagreeing about
 * what un-ticking means. Two answers out of the three a clear has: "not reported" and "not cleared"
 * both tick to cleared, and cleared un-ticks to not-cleared. There is deliberately no way back to
 * "not reported" from a click, so a mark a click leaves is always an answer rather than a return to
 * silence. Only a capture, or a new period, puts a cell back to having said nothing.
 *
 * `skipped` never reaches here: it is not an answer about clearing, and the matrix does not offer
 * those cells as clear targets. Marking one is its own click, in routine mode.
 */
export function nextClear(cleared: boolean | null): boolean {
  return cleared !== true;
}

/** Index one character's clears for lookup. 16 bosses by N characters is a lot of find() scans. */
export function indexClears(clears: BossClear[] | undefined): Map<string, boolean> {
  return new Map((clears ?? []).map((c) => [c.bossKey, c.cleared]));
}

/**
 * Which of the four a cell is.
 *
 * A clear outranks "doesn't run", and that ordering is load-bearing rather than defensive. It is
 * how a one-off works: a character who does not normally run Jupiter but did this week shows the
 * tick, and is back to "doesn't run" next period with the routine never touched. Nothing rewrites
 * the routine on their behalf, which is what a clear silently dropping the mark would amount to.
 */
export function cellState(
  clears: Map<string, boolean> | undefined,
  bossKey: string,
  skips?: Set<string>,
): CellState {
  const cleared = clears?.get(bossKey);
  if (cleared) return "cleared";
  if (skips?.has(bossKey)) return "skipped";
  if (cleared === undefined) return "unseen";
  return "pending";
}

/**
 * Is this boss done for every character who runs it?
 *
 * The matrix dims a whole row on this answer, which is the row saying "nothing left to do here".
 * So `unseen` must not count: a character whose planner was not captured this period has not
 * answered, and treating silence as a clear is the same collapse `cellState` exists to prevent,
 * one step further along where it is harder to spot. An empty roster is not done either, it is a
 * roster with nothing to say.
 *
 * `skipped` is excluded rather than counted either way, and that is the whole gain from marking
 * one: a boss only your main runs now dims when your main clears it, instead of never dimming
 * because fifteen characters who never touch it are stuck on a dash. A row nobody runs is not
 * "done" here, it is `rowNobodyRuns`.
 */
export function rowFullyCleared(
  byCharacter: Map<string, Map<string, boolean>>,
  characterIds: string[],
  bossKey: string,
  skipsByCharacter?: Map<string, Set<string>>,
): boolean {
  const runners = characterIds.filter(
    (id) => cellState(byCharacter.get(id), bossKey, skipsByCharacter?.get(id)) !== "skipped",
  );
  if (runners.length === 0) return false;
  return runners.every((id) => cellState(byCharacter.get(id), bossKey) === "cleared");
}

/**
 * Does nobody on the roster run this boss?
 *
 * Its own answer rather than a `rowFullyCleared` that happens to be vacuously true. Both rows step
 * back, but "everyone who runs it is done" and "nobody runs it" are different facts, and the second
 * one dimmed as the first would read as a week's work that was never done getting ticked off.
 */
export function rowNobodyRuns(
  characterIds: string[],
  bossKey: string,
  skipsByCharacter?: Map<string, Set<string>>,
): boolean {
  if (characterIds.length === 0) return false;
  return characterIds.every((id) => skipsByCharacter?.get(id)?.has(bossKey) ?? false);
}

/**
 * Is this character done with every boss they run?
 *
 * The column head dims on this answer, the way a row dims on rowFullyCleared, and it holds to the
 * same rule: `unseen` is not a clear. A character whose planner was not captured this period has
 * not answered, and greying their sprite would call the week finished on the strength of silence.
 *
 * Read over every cadence on the table, not the weekly band alone. The sprite is one figure, so it
 * cannot go quiet for a finished week while a daily underneath it is still outstanding.
 *
 * A character who runs nothing is false, not vacuously true: that is a roster entry with nothing
 * to say rather than a week's work finished, the distinction rowNobodyRuns draws for a row.
 */
export function columnFullyCleared(
  clears: Map<string, boolean> | undefined,
  bosses: Boss[],
  skips?: Set<string>,
): boolean {
  const states = bosses
    .map((boss) => cellState(clears, boss.bossKey, skips))
    .filter((state) => state !== "skipped");
  if (states.length === 0) return false;
  return states.every((state) => state === "cleared");
}

/** One character's skipped boss keys, for lookup, the way indexClears does for clears. */
export function indexSkips(skips: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(skips).map(([characterId, keys]) => [characterId, new Set(keys)]));
}

/**
 * How far through a set of bosses a period is.
 *
 * `total` is null for "not known", which is not the same as zero: the count is then shown without a
 * denominator rather than against one nobody gave. No view reaches that now. A past week used to,
 * being served without routine marks, and is served with them again as of bossSkipsFor's asOf. The
 * branch stays because the distinction is the reason this returns a nullable at all, and a caller
 * that genuinely does not know must not be able to fall into counting every boss.
 */
export type ClearProgress = { cleared: number; total: number | null };

/**
 * Cleared, against the number to run.
 *
 * `skipped` leaves the denominator, which is the whole return on marking a routine: a character who
 * runs four of sixteen bosses reads 4/4 and stops looking behind.
 *
 * `unseen` stays IN it, and that asymmetry is the load-bearing part. A boss nobody has captured is
 * still one to run until someone says otherwise, and dropping it would shrink the denominator to
 * nothing every Thursday, when no capture has landed yet and every cell is unseen. 0/0 reads as a
 * week with no work left in it, which is the flattering direction to be wrong in and the one this
 * project exists to refuse. Counting it can only ever overstate the work remaining.
 *
 * `routineKnown` is passed rather than inferred from the absence of skips. An empty routine is a
 * real answer, "this character runs everything", and it arrives looking exactly like a view that
 * was told nothing: inferring would state the second as confidently as the first.
 */
export function clearProgress(states: CellState[], routineKnown: boolean): ClearProgress {
  const cleared = states.filter((s) => s === "cleared").length;
  if (!routineKnown) return { cleared, total: null };
  return { cleared, total: states.filter((s) => s !== "skipped").length };
}

/** "8/12 cleared", said in full, where there is room for the word. */
export function progressLabel(p: ClearProgress): string {
  if (p.total === null) return `${p.cleared} cleared`;
  if (p.total === 0) return "none to run";
  return `${p.cleared}/${p.total} cleared`;
}

/**
 * "8/12" for a band, which has its bar for the reading and its name on the line above.
 *
 * An empty band keeps its words. `·` is a cell's glyph, read against a column head that a band
 * total does not have.
 */
export function bandCount(p: ClearProgress): string {
  return p.total === 0 ? progressLabel(p) : progressMark(p);
}

/**
 * The band bar's fill: how wide, and whether it may take the floor that stops a small one drawing
 * as a dot (see .boss-progress-bar in globals.css).
 *
 * Nothing cleared never may. A floor on zero would paint a bar for a band with no clears in it,
 * which is the count's own figure contradicted by the picture beside it.
 */
export function bandFill(p: ClearProgress): { width: string; nonzero: boolean } {
  if (!p.total) return { width: "0%", nonzero: false };
  return { width: `${(p.cleared / p.total) * 100}%`, nonzero: p.cleared > 0 };
}

/**
 * The same answer for a cell, where the row already says "cleared".
 *
 * A character with nothing to run gets the matrix's own "doesn't run" glyph rather than 0/0, which
 * reads as a target of zero that has been met.
 */
export function progressMark(p: ClearProgress): string {
  if (p.total === null) return `${p.cleared}`;
  if (p.total === 0) return "·";
  return `${p.cleared}/${p.total}`;
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

/** MONTHLY -> Monthly. The cadence is the backend's enum, and the screen is not shouting it. */
export function cadenceLabel(cadence: string): string {
  return cadence.charAt(0) + cadence.slice(1).toLowerCase();
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "2026-07-16" -> "July 16", the day the week reset.
 *
 * The date is UTC (midnight Thursday, see BossPeriod.kt) and is shown unconverted, so a viewer
 * behind UTC reads the week's real start rather than their own local one. Hand-parsed for the same
 * reason as formatPeriod.
 */
export function formatWeekStart(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  if (!month || !day || month < 1 || month > MONTH_NAMES.length) return iso;
  return `${MONTH_NAMES[month - 1]} ${day}`;
}

/**
 * The reset day that ends a week, exclusive: "2026-07-16" -> "2026-07-23".
 *
 * Stepped in UTC. The boundary is midnight Thursday UTC (see BossPeriod.kt), so walking it through
 * local time would land a day out for every viewer who is not on it, which is the same trap
 * formatPeriod avoids.
 */
export function weekEndExclusive(weekStart: string): string {
  const [year, month, day] = weekStart.split("-").map(Number);
  if (!year || !month || !day) return weekStart;
  return new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10);
}

/**
 * Which week a view is showing: "Week of July 16".
 *
 * Shared by the stepper on the Individual View and the standing label on Party View, so the two
 * cannot end up wording the same week differently. `weekStart` is null on the live view, and then
 * the week in progress is the one being shown.
 */
export function weekLabel(view: Pick<BossClearsView, "weekStart" | "currentWeekStart">): string {
  return `Week of ${formatWeekStart(view.weekStart ?? view.currentWeekStart)}`;
}

/**
 * The skip set one tick should send, given what has already been asked for.
 *
 * The routine PUT carries the WHOLE set, so a tick has to be built on top of any tick still in
 * flight rather than on the set the page was rendered with: two quick ticks derived from the same
 * render would have the second silently undo the first. `asked` is null when nothing is outstanding,
 * when a save was refused, and when the character changed, which are the three times the server's
 * set is the one to build on.
 */
export function nextSkips(
  asked: Set<string> | null,
  onScreen: Set<string>,
  bossKey: string,
  runs: boolean,
): Set<string> {
  const next = new Set(asked ?? onScreen);
  if (runs) next.delete(bossKey);
  else next.add(bossKey);
  return next;
}

// The planner itself groups by cadence (MONTHLY / WEEKLY / DAILY, see test-fixtures/occluded/boss
// planner.png), and the grouping is load-bearing here rather than decorative: two bosses in one
// matrix are not counting the same span of time, and a check under MONTHLY means something quite
// different from a check under WEEKLY. DAILY stays in the order though the tracker no longer keeps
// dailies: the list is filtered to the cadences actually present, so it costs nothing and is what
// this would need if they ever come back.
const CADENCE_ORDER = ["MONTHLY", "WEEKLY", "DAILY"];

// Four characters on screen at once, and the rest are scrolled to. A roster of ten split a 730px
// column into 53px slices, which is narrower than the sprite that has to sit in one.
export const VISIBLE_COLUMNS = 4;

// On a cold load neither the catalog nor the roster has arrived, so the loading state has nothing
// real to lay out. These stand in: the shape is right (one monthly and a run of weeklies, which is
// what the catalog actually looks like) even though the exact counts are not known client side
// until /api/bosses answers. Being a row or two out for one round-trip is a cosmetic difference;
// rendering an empty table is not.
const SKELETON_BOSSES: Boss[] = [
  { bossKey: "sk-monthly", name: "", reset: "MONTHLY", iconUrl: null, difficulties: [] },
  ...Array.from({ length: 8 }, (_, i) => ({
    bossKey: `sk-weekly-${i}`,
    name: "",
    reset: "WEEKLY",
    iconUrl: null,
    difficulties: [],
  })),
];

const SKELETON_CHARACTERS = Array.from({ length: VISIBLE_COLUMNS }, (_, i) => ({
  id: `sk-char-${i}`,
  name: "",
  spriteImgUrl: null,
}));

export type BossBand = { cadence: string; inCadence: Boss[]; progress: ClearProgress };

/**
 * The rows, the columns, and each cadence's figure, worked out once.
 *
 * The totals in the gutter and the marks inside the table are two readings of the same numbers,
 * and two components draw them now, so neither may work them out for itself.
 */
export function bossBands({
  bosses,
  characters,
  clearsByCharacter,
  skipsByCharacter,
  historyWeek,
  loading,
}: {
  bosses: Boss[];
  characters: Pick<Character, "id" | "name" | "spriteImgUrl">[];
  clearsByCharacter: BossClearsByCharacter;
  skipsByCharacter?: BossSkipsByCharacter;
  historyWeek?: string | null;
  loading?: boolean;
}): {
  rows: Boss[];
  columns: Pick<Character, "id" | "name" | "spriteImgUrl">[];
  bands: BossBand[];
} {
  // Same table either way, so the loading and loaded layouts cannot drift apart.
  const rows = loading && bosses.length === 0 ? SKELETON_BOSSES : bosses;
  const columns = loading && characters.length === 0 ? SKELETON_CHARACTERS : characters;

  // Indexed per character; see cellState for why the four cell states are four.
  const byCharacter = new Map<string, Map<string, boolean>>();
  for (const [characterId, clears] of Object.entries(clearsByCharacter)) {
    byCharacter.set(characterId, indexClears(clears));
  }
  const skipsBy = indexSkips(skipsByCharacter ?? {});

  // A past week can only answer for weekly bosses. Seven daily periods sit inside one week, so
  // there is no single "was Zakum cleared that week" to put in a cell, and a week can straddle two
  // months. Drawing one of several true answers as if it were the only one is the confident wrong
  // number this project exists to avoid, so the other two cadences are absent instead. The backend
  // returns weekly rows only for these views (see weeklyClearsFor); this keeps the empty MONTHLY
  // and DAILY bands off the table to match.
  const shown = historyWeek ? CADENCE_ORDER.filter((c) => c === "WEEKLY") : CADENCE_ORDER;
  const cadences = shown.filter((c) => rows.some((b) => b.reset === c));

  // Every view brings routine marks now, a past week's being the routine as it stood at the end of
  // it (see bossSkipsFor). So there is always a target to measure the clears against, and the two
  // readings of it agree: the same skips that leave the denominator also draw the cells that are
  // not counted.
  const routineKnown = true;

  // Counted per cadence and never pooled across them, for the reason the bands exist at all: a
  // monthly and a weekly are not counting the same span of time, so one figure over both would be
  // a total of two different things.
  const bands = cadences.map((cadence) => {
    const inCadence = rows.filter((boss) => boss.reset === cadence);
    return {
      cadence,
      inCadence,
      // Summed over the roster, so the denominator is one per character per boss they run and not
      // the number of bosses. The week's work is a run, and a boss six characters run is six of
      // them.
      progress: clearProgress(
        columns.flatMap((character) =>
          inCadence.map((boss) =>
            cellState(byCharacter.get(character.id), boss.bossKey, skipsBy.get(character.id)),
          ),
        ),
        routineKnown,
      ),
    };
  });

  return { rows, columns, bands };
}
