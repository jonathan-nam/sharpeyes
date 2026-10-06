// Turning what the account knows into a night the planner can order.
//
// Two ways in, one shape out. Signed in, the runs come from your party configs: a config already
// IS "this character, this boss, with these people", which is exactly a candidate run. Signed out,
// you type the same thing by hand. Both land on CandidateRun, so the ordering has one
// implementation and the standalone tool is not a lesser copy of the real one.
//
// See boss-run-plan.ts for what is then done with them.

import type { Boss } from "@/types/boss";
import type { Party, PartyMember } from "@/types/party";

import { BOSS_SHORT_NAMES } from "./boss-art";
import { bossLabel } from "./boss-difficulty";
import { runMinutes } from "./boss-minutes";
import { isCleared } from "./parties";

import type { CandidateRun, Plan, PlannedRun } from "./boss-run-plan";

/**
 * You, as a person the schedule has to keep on one character.
 *
 * The people list holds the OTHERS, so the account owner has no row in it and needs an id from
 * somewhere. A literal is safe against collision because every real person id is a UUID.
 */
export const YOU = "you";

export type NightPerson = { id: string; name: string };

/**
 * Whose character a seat is, or null when nobody has said.
 *
 * `characterId` wins over `personId`: it is set by the backend only when the seat IS one of your
 * roster characters, which is proof, where the person link is a name match that a stray entry on
 * the People page could have made.
 */
export function ownerOf(member: PartyMember): string | null {
  if (member.characterId !== null) return YOU;
  return member.personId;
}

/**
 * Everyone who could be on tonight, you first and the rest by name.
 *
 * Drawn from the configs rather than from /api/people, so it lists the people you actually run
 * with instead of everyone you have ever named. Seats nobody has been attributed to contribute
 * nobody, which is why their runs cannot be scheduled and now simply do not appear. See
 * RejectionReason.
 */
export function rosterFrom(parties: Party[]): NightPerson[] {
  const others = new Map<string, string>();
  let includesYou = false;

  for (const party of parties) {
    for (const member of party.members) {
      const owner = ownerOf(member);
      if (owner === YOU) includesYou = true;
      else if (owner !== null) others.set(owner, member.personName ?? member.name);
    }
  }

  const sorted = [...others.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return includesYou ? [{ id: YOU, name: "You" }, ...sorted] : sorted;
}

/**
 * Your configs as candidate runs.
 *
 * Every config becomes one, including the ones that turn out to be unschedulable. Screening is
 * what decides that, and a config that never reached screening could not be refused for a reason
 * at all. The reason is no longer shown, see RejectionReason.
 *
 * The run time comes off the config rather than the boss: two of your characters can run the same
 * Hard Lucid at different speeds, so there is no per-boss answer to take.
 */
export function runsFromParties(parties: Party[], bosses: Boss[]): CandidateRun[] {
  const nameFor = new Map(bosses.map((boss) => [boss.bossKey, boss.name]));

  return parties.map((party) => ({
    id: party.id,
    bossKey: party.bossKey,
    bossName: nameFor.get(party.bossKey) ?? party.bossKey,
    difficulty: party.difficulty,
    // The config's own time, or the flat fallback said out loud. A party that has been timed and
    // one that happens to fall on thirty minutes are not the same claim, so the night marks which
    // is which rather than presenting both as measured.
    minutes: runMinutes(party.minutes),
    assumed: party.minutes === null,
    seats: party.members.map((member) => ({
      character: member.name,
      personId: ownerOf(member),
    })),
  }));
}

/**
 * The configs still to run, keeping the ones ticked off from this page.
 *
 * A boss already cleared when the page opened is not part of tonight. One ticked WHILE the plan is
 * on screen has to stay in the candidate set: planNight is a beam search, so dropping a run
 * re-orders everything after it, and the party is following the order that was pasted to them.
 * It stays where it was, drawn as done.
 */
export function stillToRun(parties: Party[], tickedHere: ReadonlySet<string>): Party[] {
  return parties.filter((party) => !isCleared(party) || tickedHere.has(party.id));
}

// --- The standalone side -------------------------------------------------------------------

/** A run typed in by hand. People are identified by the name you type, because there is no account. */
export type DraftRun = {
  id: string;
  bossKey: string;
  bossName: string;
  minutes: number;
  seats: { character: string; person: string }[];
};

/** Case and padding are typing, not identity: "Chris" and "chris " are one person. */
export function personKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Hand-typed runs as candidates.
 *
 * A seat with no person named is left unattributed rather than guessed at, so it is refused for
 * the same reason a real unattributed seat is. A seat with no character named is dropped:
 * it is a half-filled row of a form, not a claim about the night.
 */
export function runsFromDrafts(drafts: DraftRun[]): CandidateRun[] {
  return drafts.map((draft) => ({
    id: draft.id,
    bossKey: draft.bossKey,
    bossName: draft.bossName,
    // A hand-typed run has no config behind it, so there is nothing to say. Not guessed at.
    difficulty: null,
    minutes: draft.minutes,
    seats: draft.seats
      .filter((seat) => seat.character.trim() !== "")
      .map((seat) => ({
        character: seat.character.trim(),
        personId: seat.person.trim() === "" ? null : personKey(seat.person),
      })),
  }));
}

/** Everyone named across hand-typed runs, in the spelling they were first given. */
export function rosterFromDrafts(drafts: DraftRun[]): NightPerson[] {
  const people = new Map<string, string>();
  for (const draft of drafts) {
    for (const seat of draft.seats) {
      const name = seat.person.trim();
      if (name !== "" && !people.has(personKey(name))) people.set(personKey(name), name);
    }
  }
  return [...people.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- Saying it out loud --------------------------------------------------------------------

/** Minutes as a person would say them: "45m", "1h", "2h 15m". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

// --- The reset clock -----------------------------------------------------------------------
//
// A party arranges itself against daily reset, which is 00:00 UTC. "+3.5" is half past three in
// the morning UTC and everybody in the chat knows what that means without knowing where anybody
// lives, so the night is anchored to one of those and every time on the page is one.
//
// SIGNED, and the half day either side of reset rather than a ray counting up from it. Reset is
// the thing people arrange around, so half of what gets said is before it, and the hours before it
// are said as "-2" and not as "+22". The first version counted up: at 23:45 UTC it offered a night
// starting at "+24:00" and finishing at "+28:00", which is fifteen minutes away written as a day
// and a night written as tomorrow.
//
// A night crossing reset therefore reads -1:00, -0:30, +0:00, +0:30 and needs no special case,
// where counting up it either wrapped to zero halfway down the table or ran off to +25:30.
//
// TWO spellings, because there are two kinds of time here and only one of them can be a decimal.
//
// A time a person TYPED is exact by construction: "+4.5" is 270 minutes and nothing rounds. A time
// the plan DERIVED is 15, 20 and 45 minute runs stacked, so it lands on +4:55, and a decimal there
// would have to round. formatOffsetShort draws the decimal only where the time is already on the
// half hour and falls back to +H:MM where it is not, so the short spelling is never a rounded one.
// formatOffset is the long one, kept for the paste, which is read cold hours later.
//
// Decimals have always parsed, because that is what gets typed.

const HALF_DAY = 12 * 60;
const DAY = 24 * 60;

const OFFSET = /^([+-]?)(\d{1,2})(?::([0-5]\d)|\.(\d+))?$/;

/**
 * Into the half day either side of reset.
 *
 * Every instant has one spelling here, and -12:00 is it for noon UTC. "+12:00" parses to the same
 * instant and is written back as -12:00, which is the only place the round trip changes the text.
 */
function wrapToReset(minutes: number): number {
  return ((((minutes + HALF_DAY) % DAY) + DAY) % DAY) - HALF_DAY;
}

/** A time against reset as the page draws it: "+3:30", "-0:15". */
export function formatOffset(minutes: number): string {
  const wrapped = wrapToReset(Math.round(minutes));
  const size = Math.abs(wrapped);
  return `${wrapped < 0 ? "-" : "+"}${Math.floor(size / 60)}:${String(size % 60).padStart(2, "0")}`;
}

/** How long a block of the timeline is. The unit a party actually arranges itself in. */
export const HALF_HOUR = 30;

/**
 * A time against reset as a player says it: "+4", "+4.5", "-1.5".
 *
 * Only where the time IS the half hour. A derived time that landed on +4:55 is drawn "+4:55" and
 * not rounded to "+5", so a short time on screen is always exact and never a tidied-up one.
 */
export function formatOffsetShort(minutes: number): string {
  const wrapped = wrapToReset(Math.round(minutes));
  if (wrapped % HALF_HOUR !== 0) return formatOffset(wrapped);
  const size = Math.abs(wrapped);
  return `${wrapped < 0 ? "-" : "+"}${Math.floor(size / 60)}${size % 60 === 30 ? ".5" : ""}`;
}

/**
 * "3.5", "+3.5", "3:30", "+3:30" and "-0:30" as minutes against reset. Null when it is not one.
 *
 * Every one of those spellings gets typed, and a box that took only its own is a box people would
 * get wrong while holding a Discord message that says 3.5.
 */
export function parseOffset(text: string): number | null {
  const match = OFFSET.exec(text.trim());
  if (match === null) return null;

  const hours = Number(match[2]);
  const clock = match[3];
  const decimal = match[4];
  const rest =
    clock !== undefined
      ? Number(clock)
      : decimal !== undefined
        ? Math.round(Number(`0.${decimal}`) * 60)
        : 0;

  // Past twelve either way is the other side of reset said the long way round, and far more often
  // it is a typo. Refused rather than wrapped, so "+25" is a question and not a silent "+1".
  const size = hours * 60 + rest;
  if (size > HALF_DAY) return null;
  return match[1] === "-" ? -size : size;
}

/** Where now sits against reset. Quantised, so it is stable within the minute it is read in. */
export function offsetNow(at: number): number {
  return wrapToReset(Math.floor(at / 60_000));
}

/**
 * The next half hour, which is when a night arranged now would start.
 *
 * Rounding up rather than to nearest, because a night is arranged for a time that has not happened
 * yet. It lives here rather than on the page so the thing that went wrong has a test: at 23:45 UTC
 * this used to round 1425 up to 1440 and the page offered to start the night at "+24:00".
 */
export function nextHalfHour(offset: number): number {
  return Math.ceil(offset / 30) * 30;
}

/**
 * How long a night from one time to another runs, in minutes. Zero when that is not a night.
 *
 * Forwards through reset, because the times wrap and subtracting them does not: a night from
 * +11:00 to -9:00 is four hours, and the page DRAWS that end itself, so reading its own output
 * back as a night of minus twenty hours was a real way to get a zero-length night on screen.
 *
 * Past half a day is where it stops being a wrap and starts being an end typed before the start.
 * Nobody bosses for thirteen hours, so that is refused as zero rather than believed.
 */
export function spanBetween(from: number, to: number): number {
  const span = to - from;
  const forwards = span < 0 ? span + DAY : span;
  return forwards > HALF_DAY ? 0 : forwards;
}

/** Where one run sits on the reset clock. */
export type RunTime = {
  /** "+2:30". */
  at: string;
  /** The same time in minutes against reset, for the half-hour rules the page draws it against. */
  startsAt: number;
  /**
   * The clock reached this by adding up a duration nobody timed, so the time is not one either.
   * Drawn with the same tilde the run's own length carries, for the same reason.
   */
  approx: boolean;
  /** Who the night is waiting for to start this one, when it starts late. Usually nobody. */
  waitingFor: NightPerson[];
};

/**
 * Every run's place on the clock, for the grid and the paste both.
 *
 * One implementation because two would drift, and the times are the half of the plan somebody acts
 * on hours later. Same rule planAsText follows about building from the Plan it is handed.
 *
 * A wait CLEARS the approximation rather than inheriting it: the night sitting until somebody is
 * free lands on a time that was stated out loud, so nothing guessed before it moves that time.
 */
export function runTimes(plan: Plan, roster: NightPerson[], startAt: number): RunTime[] {
  const personAt = new Map(roster.map((person) => [person.id, person]));
  let guessed = false;

  return plan.runs.map((planned) => {
    if (planned.waitingFor.length > 0) guessed = false;
    const time: RunTime = {
      at: formatOffset(startAt + planned.startsAt),
      startsAt: startAt + planned.startsAt,
      approx: guessed,
      waitingFor: planned.waitingFor
        .map((id) => personAt.get(id))
        .filter((person): person is NightPerson => person !== undefined),
    };
    if (planned.run.assumed) guessed = true;
    return time;
  });
}

/**
 * The half-hour rule that opens above each run, or null where the run sits under the one above.
 *
 * The label is the FLOOR of the half hour the run starts in, so a run at +4:55 is drawn under +4.5
 * rather than beside a rounded "+5". A rule is a gridline, not a claim about the run: what the run
 * costs is its own length, which the row carries.
 *
 * A block nobody starts in gets no rule, which is why the labels skip. A long run or a wait ate it,
 * and both of those already say so on the row and in the wait line. Drawing an empty rule for it
 * would be a line with nothing under it.
 *
 * The tilde carries over from the time: a rule reached by adding up guessed lengths is a guess.
 */
export function runTicks(times: RunTime[]): (string | null)[] {
  let open: number | null = null;
  return times.map((time) => {
    const block = Math.floor(time.startsAt / HALF_HOUR) * HALF_HOUR;
    if (block === open) return null;
    open = block;
    return `${time.approx ? "~" : ""}${formatOffsetShort(block)}`;
  });
}

// The marks the pasted table uses. ASCII on purpose: the screen draws these as glyphs, and a
// glyph in a code fence is a monospace font's guess at how wide it is, which is how a lined-up
// table arrives crooked.
const SITTING_OUT = "X";
const SWITCH_MARK = "*";

/** One person's place in one run. */
export type GridCell = {
  /** The character they bring, or null when they sit this one out. */
  character: string | null;
  /** They changed character to be here, the one thing the ordering is trying to avoid. */
  switched: boolean;
};

export type GridRow = { planned: PlannedRun; cells: GridCell[] };

/**
 * The night with a column per person.
 *
 * A party is six seats and a group is often more people than that, so who is NOT in a run is half
 * the plan and a per-run list of seats cannot show it. A column can: it is one person all night,
 * and the gaps in it are theirs.
 *
 * Only people the plan uses get a column. Somebody whose runs all fell out is not sitting through
 * the night, they are absent from this plan entirely, and the leftovers name them and their boss.
 */
export function planGrid(
  /** The runs alone. Part of a night has no `switches` or `minutes` that are still true of it. */
  plan: { runs: PlannedRun[] },
  roster: NightPerson[],
): { people: NightPerson[]; rows: GridRow[] } {
  const inPlan = new Set(
    plan.runs.flatMap((planned) => planned.run.seats.map((seat) => seat.personId)),
  );
  const people = roster.filter((person) => inPlan.has(person.id));

  const rows = plan.runs.map((planned) => {
    const switched = new Set(planned.switched);
    return {
      planned,
      cells: people.map((person) => {
        const seat = planned.run.seats.find((s) => s.personId === person.id);
        return {
          character: seat ? seat.character : null,
          switched: seat !== undefined && switched.has(person.id),
        };
      }),
    };
  });

  return { people, rows };
}

/** What the party calls a boss, with its mode: "Chaos Kalos" is the whole name of what is run. */
function bossHeading(planned: PlannedRun): string {
  return bossLabel(
    BOSS_SHORT_NAMES[planned.run.bossKey] ?? planned.run.bossName,
    planned.run.difficulty,
  );
}

/** A field with nothing in it that can break a row: its own width is what places the next column. */
function cell(value: string): string {
  return value.replace(/[\t\n\r]+/g, " ").trim();
}

/** The gap between two columns, the same everywhere, so the eye reads one gutter down the table. */
const COLUMN_GAP = "  ";

/** Rows of fields, each column padded to its own widest cell and flush left within it. */
function paddedTable(rows: string[][]): string[] {
  const widths = (rows[0] ?? []).map((_, i) =>
    Math.max(...rows.map((row) => (row[i] ?? "").length)),
  );
  return rows.map((row) =>
    row
      .map((field, i) => field.padEnd(widths[i] ?? 0))
      .join(COLUMN_GAP)
      .trimEnd(),
  );
}

/**
 * The plan as text, for pasting where the party actually talks.
 *
 * The table and nothing else: bosses down, people across, and an X where somebody sits one out.
 * It is fenced because the columns only line up in a monospace font, and a chat client renders
 * everything outside a code block proportionally.
 *
 * It used to carry a headline above and a key below, and the corner cell said "Boss". All three
 * were dropped: what gets pasted is a table people read off during the night, and a count, a
 * duration and a glyph key are three lines of talking around it.
 *
 * The count, the duration and the switches are still on the page, beside the controls that set
 * them. The X is not explained anywhere a reader of the paste can see, and that is the cost of
 * dropping the key rather than an oversight: it is a bare X in a table, and the party reading it
 * ran the night. Put the key back if that stops being true.
 *
 * NO TIME COLUMN. It carried one for as long as the page did, on the argument that "+2:30" is what
 * tells a reader when to be there. The page now says the clock in half-hour rules and this says the
 * order, which is what a party pastes it for: the exact minute a run starts is a consequence of the
 * one above it running to length, and a column of them in a chat window is read as a commitment
 * nobody made. Put it back only with the page, or the two drift and the paste is the one believed.
 *
 * The corner is empty and every field is flush left, padded out to the widest cell in its column.
 * One tab per column was tried instead (#212), on the theory that a tab stop aligns for free. It
 * does not: a single boss name crossing a stop moves every column below it, which is how a table
 * that lined up in the widest-name case arrived crooked in every other.
 *
 * PART OF A NIGHT is the same table with fewer rows, for the group that is told the next two runs
 * rather than all seven. A person in none of the rows drawn loses their column, which is the point:
 * a truncated paste that still carries a column of Xs is a longer table, not a shorter one.
 *
 * Built from the Plan it is given, never restated by hand, so it cannot drift from what the page
 * is showing. The same rule explainSplit() follows.
 */
export function planAsText(
  plan: Plan,
  roster: NightPerson[],
  /** The runs to draw, for a copy of part of the night. Omitted draws all of them. */
  only?: ReadonlySet<string>,
): string {
  const runs = only ? plan.runs.filter((planned) => only.has(planned.run.id)) : plan.runs;
  if (runs.length === 0) return "No bosses fit in the time.";

  const { people, rows } = planGrid({ runs }, roster);
  const header = ["", ...people.map((person) => cell(person.name))];
  const body = rows.map(({ planned, cells }) => [
    cell(bossHeading(planned)),
    ...cells.map((c) =>
      c.character === null ? SITTING_OUT : cell(c.character + (c.switched ? SWITCH_MARK : "")),
    ),
  ]);

  return ["```", ...paddedTable([header, ...body]), "```"].join("\n");
}
