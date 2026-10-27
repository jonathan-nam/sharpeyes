// Run Order's night, from the controls to the search's answer, as plain functions of plain data so
// the search can run in a worker (night-search.worker.ts) ahead of the button. See use-night-search.

import {
  type NightPerson,
  parseOffset,
  rosterFrom,
  runsFromParties,
  spanBetween,
  stillToRun,
} from "@/lib/boss-night";
import {
  type Availability,
  type CandidateRun,
  type EligibleRun,
  type Plan,
  planNight,
  screenRuns,
} from "@/lib/boss-run-plan";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";

/** One person's window, as typed. Parsed where it is used, so a half-finished "+3" is not a time. */
export type WindowText = { from: string; until: string };

/** The controls a night is planned from. */
export type NightInputs = {
  budget: number;
  openOnly: boolean;
  everyoneOn: boolean;
  away: string[];
  startAt: number;
  windows: Record<string, WindowText>;
  timed: boolean;
};

/** The account's side of a night: what does not come from the controls. */
export type NightData = {
  running: Party[];
  answered: ReadonlySet<string>;
  bosses: Boss[];
  switchers: ReadonlySet<string>;
};

/** Everything the search reads, all of it plain data so it can cross to a worker. */
export type NightSearch = {
  searched: EligibleRun[];
  hidden: string[];
  /** Minutes the night may take, Infinity when it is not run to the clock. */
  night: number;
  available: Record<string, Availability>;
  everyoneOn: boolean;
  allRuns: CandidateRun[];
  hereAll: string[];
};

export type NightResult = {
  /** What the search was given, the hidden runs' minutes included. Shuffle searches with it. */
  minutes: number;
  byCount: Plan[];
};

export type Night = {
  plannedParties: Party[];
  /** Planned and then hidden: the configs already cleared. See withoutRuns. */
  hidden: ReadonlySet<string>;
  /** Who is on, in grid order. */
  onTonight: NightPerson[];
  search: NightSearch;
};

/** The night [inputs] describe, over [data]. */
export function nightOf(inputs: NightInputs, data: NightData): Night {
  const { running, answered, bosses, switchers } = data;
  const plannedParties = inputs.openOnly ? stillToRun(running, answered) : running;

  // The search plans every config on the period, cleared or not, and the cleared ones are hidden
  // from what it returns. See withoutRuns for why.
  const shownIds = new Set(plannedParties.map((party) => party.id));
  const hidden = new Set(
    running.filter((party) => !shownIds.has(party.id)).map((party) => party.id),
  );
  const allRuns = runsFromParties(running, bosses, switchers);

  const on = (person: NightPerson) => switchers.has(person.id) && !inputs.away.includes(person.id);
  const onTonight = rosterFrom(plannedParties).filter(on);
  const here = onTonight.map((person) => person.id);
  // Everyone in a hidden run too, or their runs would be refused and drop out of the search.
  const hereAll = rosterFrom(running)
    .filter(on)
    .map((person) => person.id);

  const searched = screenRuns(allRuns, hereAll, {
    everyoneOn: inputs.everyoneOn,
    everyone: here,
  }).eligible;

  return {
    plannedParties,
    hidden,
    onTonight,
    search: {
      searched,
      hidden: [...hidden],
      // Nothing, when the night is not run to the clock: every boss that can be run is in the plan.
      night: inputs.timed ? inputs.budget : Infinity,
      available: availableOf(inputs, switchers),
      everyoneOn: inputs.everyoneOn,
      allRuns,
      hereAll,
    },
  };
}

/**
 * The windows, moved from the reset clock to minutes from the start of the night. A half-typed "+"
 * parses to nothing and constrains nothing, which stops the plan lurching while a time is typed.
 * spanBetween rather than a subtraction: the clock wraps at reset.
 */
function availableOf(
  inputs: NightInputs,
  switchers: ReadonlySet<string>,
): Record<string, Availability> {
  const byPerson: Record<string, Availability> = {};
  // A window is a time, so an untimed night has none. Kept, not cleared, for when the clock is back.
  if (!inputs.timed) return byPerson;
  for (const [id, window] of Object.entries(inputs.windows)) {
    if (!switchers.has(id)) continue;
    const from = parseOffset(window.from);
    const until = parseOffset(window.until);
    const said: Availability = {};
    if (from !== null) said.from = spanBetween(inputs.startAt, from);
    if (until !== null) said.until = spanBetween(inputs.startAt, until);
    if (said.from !== undefined || said.until !== undefined) byPerson[id] = said;
  }
  return byPerson;
}

/** The search itself: the slow part, and the only part the worker runs. */
export function searchNight(search: NightSearch): NightResult {
  const hidden = new Set(search.hidden);
  // The hidden runs take no time tonight, so the search gets their minutes back on top.
  let hiddenMinutes = 0;
  for (const run of search.searched) if (hidden.has(run.id)) hiddenMinutes += run.minutes;
  const minutes = search.night + hiddenMinutes;
  const prefer = search.everyoneOn ? preferredOrder(search, hidden) : undefined;
  const { byCount } = planNight(search.searched, { minutes, available: search.available, prefer });
  return { minutes, byCount };
}

/** The night's order without "Exclude Party Member Subsets", for that toggle to break ties toward. */
function preferredOrder(search: NightSearch, hidden: ReadonlySet<string>): string[] {
  const runs = screenRuns(search.allRuns, search.hereAll).eligible;
  let hiddenMinutes = 0;
  for (const run of runs) if (hidden.has(run.id)) hiddenMinutes += run.minutes;
  const options = { minutes: search.night + hiddenMinutes, available: search.available };
  return planNight(runs, options).best.runs.map((planned) => planned.run.id);
}
