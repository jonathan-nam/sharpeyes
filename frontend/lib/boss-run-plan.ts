// Ordering a night of bosses so people stay on one character and nobody sits about.
//
// The hard part of a bossing night is not what time to meet, it is what to run and in what order.
// Every person has several characters, and each boss is run with a particular one of them. Put the
// runs in a careless order and everybody relogs between every boss.
//
// So: a run is a boss plus exactly who brings which character. A SWITCH is one person changing
// character between two consecutive runs THEY are in. Somebody sitting out a run does not log off,
// so their run for the night is a subsequence and only the gaps within it can cost anything. A
// person's first run is free, because logging in is not switching.
//
// What is optimised, in order:
//
//   1. the number of runs that fit in the time
//   2. the fullest parties first
//   3. the least waiting around
//   4. the number of switches
//   5. finishing earlier
//
// Count first is deliberate: the point of the night is dead bosses, and a plan that saves two
// relogs by dropping a boss is not obviously better. It is often not much worse either, which is
// why `byCount` hands back the best plan at EVERY length and lets the caller show the trade.
//
// The fullest parties go first because the group only shrinks: someone dropping out at midnight
// takes the six-person boss with them, where a relog costs a minute. That is why party size
// outranks switches and not the run count.
//
// WAITING is a run somebody sits out between two runs they are in. Somebody needed for two of six
// bosses should do them back to back and have the rest of the night free, whichever end that lands
// on. A run at either end costs them nothing, so only the gaps in the middle are counted. It sits
// above switches because a gap is a whole boss of sitting there and a switch is a moment at the
// login screen. It sits below party size, so a person whose two runs are the fullest and the
// emptiest can still be split across the night.
//
// A gap is counted as it OPENS, not when it closes. Waiting is only paid when somebody comes back,
// so ranking half-built nights on the paid total alone cannot tell a night that has stranded
// somebody from one that has not, and prunes the orderings that would have avoided it: that is
// what put a person's last two runs behind nine they sat out. See betterState and betterPlanned,
// which are why there are two comparators rather than one.
//
// A switch is counted and ordered on, never billed to the clock. The night is measured in whole
// runs, so at the default half hour a run the schedule reads 0:00, 0:30, 1:00. Charging a relog
// against an estimate that coarse only bought a finishing time that looked precise and was not.
//
// AVAILABILITY is a window per person, in minutes from the start of the night. `until` is hard:
// somebody with other bossing booked at the end of theirs is not going to be late for it, so a run
// that would overrun the window is never scheduled and its boss drops out of the plan. `from` makes
// the night WAIT, since a run starts at the later of the clock and everybody in it being free. That
// is the only thing that ever puts idle time in a schedule which is otherwise back to back, so a
// gap in the plan always has a person's name on it. See PlannedRun.waitingFor.
//
// Nothing here says WHOSE bosses to drop when they will not all fit. A "keep their runs" tick was
// built and taken out again: it read as a promise it could not make, and it sat next to the
// windows looking like it ordered the night, which is the thing people actually ask for and the
// thing it did not do. Say the ordering ask out loud before building for it again.

/** One seat in a run: a character, and whose it is. Null means nobody has claimed it. */
export type RunSeat = {
  /** The character's IGN. Identity here is the character, not the class or the level. */
  character: string;
  personId: string | null;
};

/** A boss somebody could run tonight, with the party that would run it. */
export type CandidateRun = {
  id: string;
  bossKey: string;
  bossName: string;
  /** The mode the config says it runs. Null for a hand-typed run, which is not asked for one. */
  difficulty: string | null;
  /** Door to door, in minutes: getting in, the fight, and looting. */
  minutes: number;
  /** The minutes are the flat fallback, nobody having timed this party. Drawn as "~30m". */
  assumed?: boolean;
  seats: RunSeat[];
};

/** A seat whose owner is known. Every seat of an eligible run has one. */
export type AttributedSeat = { character: string; personId: string };

/** A candidate that survived screening, so it can actually be scheduled. */
export type EligibleRun = Omit<CandidateRun, "seats"> & { seats: AttributedSeat[] };

/**
 * Why a candidate cannot be scheduled.
 *
 * `person-twice` is the one that is a mistake in the data rather than a fact about tonight: one
 * person cannot play two characters at once, so a party holding two of somebody's characters is
 * not a party that can be formed.
 *
 * NOTHING DRAWS THIS. Run Order used to list the rejections under "Can't be scheduled" and no
 * longer does, so a config refused here now vanishes from the page with nothing said. Screening
 * still classifies, and these tests still pin it, because the classification is what produces
 * `eligible`. Read a UI for it back off `rejected`; do not re-derive the reasons.
 */
export type RejectionReason =
  "person-twice" | "person-unavailable" | "unattributed-seat" | "leaves-somebody-out";

export type Rejection = {
  run: CandidateRun;
  reason: RejectionReason;
  /** Who or what caused it, named well enough to say more than "excluded" if anything ever does. */
  detail: string[];
};

export type Screening = {
  eligible: EligibleRun[];
  rejected: Rejection[];
};

export type ScreenOptions = {
  /**
   * Keep only the runs that seat EVERYONE who is on, so three people get the three-person party
   * and not its solo and duo versions as well. Off, a smaller config staffed entirely by people
   * who turned up is a run like any other.
   */
  everyoneOn?: boolean;
  /**
   * Who "everyone" is for `everyoneOn`, when it is not everybody available. Run Order screens its
   * cleared runs too (see withoutRuns), and somebody whose every run is cleared is not on tonight.
   */
  everyone?: Iterable<string>;
};

/**
 * The candidates that can run tonight, and why the others cannot.
 *
 * Order of checks matters for the message, not the outcome: a party that double-books somebody is
 * broken whether or not they turned up, so that is reported ahead of availability.
 */
export function screenRuns(
  runs: CandidateRun[],
  availablePersonIds: Iterable<string>,
  options: ScreenOptions = {},
): Screening {
  const available = new Set(availablePersonIds);
  const everyone = options.everyone === undefined ? available : new Set(options.everyone);
  const eligible: EligibleRun[] = [];
  const rejected: Rejection[] = [];

  for (const run of runs) {
    const seenPersons = new Map<string, string[]>();
    for (const seat of run.seats) {
      if (seat.personId === null) continue;
      const characters = seenPersons.get(seat.personId);
      if (characters) characters.push(seat.character);
      else seenPersons.set(seat.personId, [seat.character]);
    }

    const doubled = [...seenPersons.entries()].filter(([, characters]) => characters.length > 1);
    if (doubled.length > 0) {
      rejected.push({
        run,
        reason: "person-twice",
        detail: doubled.flatMap(([, characters]) => characters),
      });
      continue;
    }

    // An unclaimed seat is not evidence of absence. We simply cannot say whether whoever plays it
    // is here, and scheduling a run on that assumption is how a plan comes out confidently wrong.
    const unattributed = run.seats.filter((seat) => seat.personId === null);
    if (unattributed.length > 0) {
      rejected.push({
        run,
        reason: "unattributed-seat",
        detail: unattributed.map((seat) => seat.character),
      });
      continue;
    }

    const missing = run.seats.filter((seat) => !available.has(seat.personId as string));
    if (missing.length > 0) {
      rejected.push({
        run,
        reason: "person-unavailable",
        detail: missing.map((seat) => seat.personId as string),
      });
      continue;
    }

    if (options.everyoneOn === true) {
      const seated = new Set(run.seats.map((seat) => seat.personId as string));
      const out = [...everyone].filter((id) => !seated.has(id));
      if (out.length > 0) {
        rejected.push({ run, reason: "leaves-somebody-out", detail: out });
        continue;
      }
    }

    eligible.push({ ...run, seats: run.seats as AttributedSeat[] });
  }

  return { eligible, rejected };
}

/**
 * When one person can play, in minutes from the start of the night. An end left out is open.
 *
 * `until` is when they have to be FINISHED, not when they can last start something: the point of
 * saying it is that they have somewhere else to be.
 */
export type Availability = {
  from?: number;
  until?: number;
};

export type PlanOptions = {
  /** The window, in minutes. */
  minutes: number;
  /**
   * How many partial plans stay alive per step. The search is a beam, not an exhaustive one: the
   * orderings of even fifteen runs do not fit in a browser tab. Wider is slower and no worse.
   */
  beamWidth?: number;
  /** By person id. Anybody not in here is free for the whole night. */
  available?: Record<string, Availability>;
  /**
   * Run ids in the order another plan put them, to break ties toward. Run Order passes the plan
   * without `everyoneOn`, so ticking it keeps the order wherever dropping the smaller parties makes
   * no order cheaper. Without it, a tie falls to the run ids, which are random UUIDs.
   */
  prefer?: readonly string[];
};

export type PlannedRun = {
  run: EligibleRun;
  /** Who changed character to start this run, in seat order. Empty for most runs, and that is the point. */
  switched: string[];
  /** Minutes from the start of the night. */
  startsAt: number;
  /**
   * Who the plan is waiting for, when this run starts later than the one before it finished.
   * Empty for every run in a night nobody turns up late to, which is most of them.
   */
  waitingFor: string[];
};

export type Plan = {
  runs: PlannedRun[];
  switches: number;
  /** Minutes from the start of the night to the end of the last run, waiting included. */
  minutes: number;
};

export const EMPTY_PLAN: Plan = { runs: [], switches: 0, minutes: 0 };

/** When a run can start and when it has to be finished: the tightest window of its seats. */
type RunWindow = {
  readyAt: number;
  dueBy: number;
  /** Who a wait would be for, named only where the run is actually held up. */
  waitsFor: string[];
};

/** One run's window: the earliest it can start, the latest it can end, and who is waited for. */
function windowOf(run: EligibleRun, available: Record<string, Availability>): RunWindow {
  let readyAt = 0;
  let dueBy = Infinity;
  for (const seat of run.seats) {
    const window = available[seat.personId];
    if (window === undefined) continue;
    if (window.from !== undefined && window.from > readyAt) readyAt = window.from;
    if (window.until !== undefined && window.until < dueBy) dueBy = window.until;
  }

  // Only the people the wait is actually for, so a run held up until 3:00 does not also name
  // somebody who was free at 2:40.
  const waitsFor =
    readyAt > 0
      ? run.seats
          .filter((seat) => available[seat.personId]?.from === readyAt)
          .map((seat) => seat.personId)
      : [];

  return { readyAt, dueBy, waitsFor };
}

// A state is copied once per candidate, and there are hundreds of thousands of candidates, so it is
// built out of fixed-length arrays indexed by a number worked out up front. The string-keyed Maps
// and Sets this replaced were three quarters of the search's time at 30 runs: copying four of them
// per candidate, then sorting two back into a key.
//
// One record per scheduled run rather than three arrays kept index-aligned. The parallel version
// typechecked and was one off-by-one away from attributing a switch to the wrong run.

/**
 * The runs scheduled so far, newest first, sharing every link with the state it grew from.
 *
 * A chain rather than an array because appending is the only thing the search does with it, and
 * `[...state.order, planned]` copied the whole prefix per candidate: 89k element copies for a
 * seventeen-run night at two hours, against maybe thirty plans that are ever read back. Reading is
 * what pays instead, in orderOf, and only the round leaders and the tie-break key ever read.
 */
type OrderChain = { planned: PlannedRun; before: OrderChain | null };

type State = {
  order: OrderChain | null;
  /** How many runs are in `order`, since a chain cannot say so in constant time. */
  depth: number;
  /** One bit per run. */
  taken: number[];
  /** Where each person is parked right now, by person. Undefined means they have not logged in yet. */
  parked: (string | undefined)[];
  /** One bit per character-and-boss pair. A character clears a boss once a period, so never twice a night. */
  spent: number[];
  /**
   * Party sizes in run order, one fixed-width field each, so a plain string compare IS the
   * lexicographic compare of the sequence. Safe because states are only ever compared at equal
   * length: every round of the beam appends exactly one run.
   */
  parties: string;
  /** Which run each person was last in, by person. -1 means they have not been in one yet. */
  lastRunAt: number[];
  /** Candidate runs each person is still in that have not been scheduled, by person. */
  left: number[];
  /** Runs people sit out between two of their own, summed over everybody. See WAITING. */
  waiting: number;
  /** The waiting already incurred by everybody still owed a run. See WAITING. */
  owed: number;
  minutes: number;
  switches: number;
  /** Filled in by planKey on first use, which only happens on a tie. */
  orderKey: string | null;
  /** The same for preferKey. */
  preferKey: string | null;
};

// 30 bits to the word, so a word stays a small signed integer and the shifts stay in range.
const WORD = 30;

function noBits(count: number): number[] {
  return new Array(Math.max(1, Math.ceil(count / WORD))).fill(0);
}

function hasBit(bits: number[], at: number): boolean {
  return ((bits[(at / WORD) | 0] as number) & (1 << (at % WORD))) !== 0;
}

function setBit(bits: number[], at: number): void {
  const word = (at / WORD) | 0;
  bits[word] = (bits[word] as number) | (1 << (at % WORD));
}

/** A party size as a comparison field. Two digits, because a party is six people and never 100. */
function sizeField(size: number): string {
  return String(Math.min(size, 99)).padStart(2, "0");
}

/**
 * The best `k` items, in no particular order, with the single best one first. Sorts in place.
 *
 * Equivalent to `items.sort(better).slice(0, k)` for the SET it returns and for the element at 0,
 * and that is all the beam reads: the next round iterates it to generate candidates and dedupes
 * them through a comparison that does not depend on the order they arrive in. Sorting the other
 * 999 was a quarter of the search's time.
 *
 * Cutting at the k-th element is only well defined because `better` is a total order. planNight's
 * is: it breaks its last tie on the run-id sequence, which two distinct states cannot share. Given
 * that, "the best k" is one particular set rather than any of several equally good ones.
 *
 * Hoare partition around a median-of-three pivot, recurring only into the side holding the cut.
 * Generic over the comparator so pinBestOf can check it against a plain sort without building
 * States, which is worth it: a selection that quietly keeps the wrong k would change plans on some
 * inputs and not others, and nothing downstream could tell.
 */
export function bestOf<T>(items: T[], k: number, better: (a: T, b: T) => number): T[] {
  if (k <= 0) return [];
  if (items.length > k) {
    let lo = 0;
    let hi = items.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      // Median of three, parked at hi as the pivot, so sorted and reverse-sorted input do not
      // degrade to O(n^2).
      if (better(items[mid] as T, items[lo] as T) < 0) swap(items, mid, lo);
      if (better(items[hi] as T, items[lo] as T) < 0) swap(items, hi, lo);
      if (better(items[mid] as T, items[hi] as T) < 0) swap(items, mid, hi);
      const pivot = items[hi] as T;

      let split = lo;
      for (let i = lo; i < hi; i++) {
        if (better(items[i] as T, pivot) < 0) swap(items, i, split++);
      }
      swap(items, split, hi);

      // The cut sits at index k-1, so a partition landing at or past k means everything from the
      // pivot rightwards is out.
      if (split >= k) hi = split - 1;
      else lo = split + 1;
    }
    items.length = k;
  }

  // The leader has to be exact: it is the plan the round records. Partitioning only guarantees the
  // SET, so the minimum is found rather than assumed to have landed at the front.
  let leader = 0;
  for (let i = 1; i < items.length; i++) {
    if (better(items[i] as T, items[leader] as T) < 0) leader = i;
  }
  if (leader > 0) swap(items, 0, leader);
  return items;
}

function swap<T>(items: T[], a: number, b: number): void {
  const held = items[a] as T;
  items[a] = items[b] as T;
  items[b] = held;
}

/**
 * Which of two states to carry forward: waiting counted with what is already owed.
 *
 * The beam has to rank half-built nights, and waiting is a LAGGING cost: it is only charged when
 * somebody comes back, so a state that has stranded a person mid-night is indistinguishable from
 * one that has not until the bill arrives, by which point every better continuation has been
 * pruned. That is what put a person's last two runs behind nine they sat out. `owed` is the same
 * gap counted as it opens rather than when it closes, which is what makes the two comparable.
 */
function betterState(a: State, b: State, tie: Tie): number {
  // Bigger parties earlier. Greater string, not lesser, so this is descending.
  if (a.parties !== b.parties) return a.parties < b.parties ? 1 : -1;
  if (a.waiting + a.owed !== b.waiting + b.owed) return a.waiting + a.owed - (b.waiting + b.owed);
  if (a.switches !== b.switches) return a.switches - b.switches;
  if (a.minutes !== b.minutes) return a.minutes - b.minutes;
  // Deterministic last resort, so the same input always gives the same plan back.
  return tie(a, b);
}

/**
 * Which of two finished plans to hand back. Waiting only, because `owed` is an estimate.
 *
 * A night that runs out of clock leaves runs unscheduled, and whoever is in them is owed a gap
 * that will never be waited. Ranking the ANSWER on that would trade a real sat-out run for an
 * imaginary one, which is the ordering this file promises not to do. So the estimate steers the
 * search and the tally decides between what it found.
 */
function betterPlanned(a: State, b: State, tie: Tie): number {
  if (a.parties !== b.parties) return a.parties < b.parties ? 1 : -1;
  if (a.waiting !== b.waiting) return a.waiting - b.waiting;
  if (a.switches !== b.switches) return a.switches - b.switches;
  if (a.minutes !== b.minutes) return a.minutes - b.minutes;
  return tie(a, b);
}

/** The last comparison, between two states every rule above calls equal. Must be total. */
type Tie = (a: State, b: State) => number;

const byRunId: Tie = (a, b) => planKey(a).localeCompare(planKey(b));

/**
 * Ties broken toward `prefer`: the order whose runs sit earliest in it wins, and runs it does not
 * name rank equal behind all of them, so byRunId still decides between those.
 */
function preferring(prefer: readonly string[]): Tie {
  const width = String(prefer.length).length;
  const rankOf = new Map(prefer.map((id, at) => [id, String(at).padStart(width, "0")]));
  const unranked = String(prefer.length).padStart(width, "0");
  const keyOf = (state: State) => {
    if (state.preferKey === null) {
      state.preferKey = orderOf(state)
        .map((planned) => rankOf.get(planned.run.id) ?? unranked)
        .join();
    }
    return state.preferKey;
  };
  return (a, b) => {
    const left = keyOf(a);
    const right = keyOf(b);
    if (left !== right) return left < right ? -1 : 1;
    return byRunId(a, b);
  };
}

/** The chain read back into schedule order, which is the order it was built in reversed. */
function orderOf(state: State): PlannedRun[] {
  const runs: PlannedRun[] = new Array(state.depth);
  let link = state.order;
  for (let i = state.depth - 1; i >= 0; i--) {
    runs[i] = (link as OrderChain).planned;
    link = (link as OrderChain).before;
  }
  return runs;
}

function planKey(state: State): string {
  if (state.orderKey === null) {
    state.orderKey = orderOf(state)
      .map((planned) => planned.run.id)
      .join();
  }
  return state.orderKey;
}

function toPlan(state: State): Plan {
  return {
    runs: orderOf(state),
    switches: state.switches,
    minutes: state.minutes,
  };
}

/**
 * The best order to run tonight's bosses in.
 *
 * `best` is the longest plan that fits, broken to fewest switches. `byCount` holds the best plan of
 * every length from 1 up, so a caller can offer "one fewer boss, three fewer relogs" without
 * running the search again.
 */
export function planNight(
  runs: EligibleRun[],
  options: PlanOptions,
): { best: Plan; byCount: Plan[] } {
  const beamWidth = options.beamWidth ?? 1000;
  const available = options.available ?? {};
  const tie = options.prefer === undefined ? byRunId : preferring(options.prefer);
  const steer = (a: State, b: State) => betterState(a, b, tie);
  const pick = (a: State, b: State) => betterPlanned(a, b, tie);

  // Everything a run needs during the search, numbered once. The inner loop then never touches an
  // IGN or a boss key, only indices into these.
  const personAt = new Map<string, number>();
  const pairAt = new Map<string, number>();
  const prepared = runs.map((run, index) => {
    const persons: number[] = [];
    const pairs: number[] = [];
    for (const seat of run.seats) {
      let person = personAt.get(seat.personId);
      if (person === undefined) personAt.set(seat.personId, (person = personAt.size));
      persons.push(person);

      const name = `${seat.character}::${run.bossKey}`;
      let pair = pairAt.get(name);
      if (pair === undefined) pairAt.set(name, (pair = pairAt.size));
      pairs.push(pair);
    }

    // A run's own window does not depend on what has been scheduled, so it is worked out once here
    // rather than per candidate.
    const { readyAt, dueBy, waitsFor } = windowOf(run, available);

    return {
      run,
      index,
      persons,
      pairs,
      size: sizeField(run.seats.length),
      readyAt,
      dueBy,
      waitsFor,
    };
  });

  const people = personAt.size;

  // How many of tonight's runs each person is in, which is what makes stranding them visible.
  const runsPerPerson = new Array(people).fill(0);
  // The shortest run each person is in, and the clock they have to be off by: together, whether
  // another run could still fit them. Both are optimistic (the short run may already be taken),
  // which is the safe direction: owed is a cost, and over-owing is what distorts a plan.
  const shortestRun = new Array(people).fill(Infinity);
  const offBy = new Array(people).fill(options.minutes);
  for (const { run, persons } of prepared) {
    for (let s = 0; s < persons.length; s++) {
      const person = persons[s] as number;
      runsPerPerson[person]++;
      if (run.minutes < shortestRun[person]) shortestRun[person] = run.minutes;
      const until = available[(run.seats[s] as AttributedSeat).personId]?.until;
      if (until !== undefined && until < offBy[person]) offBy[person] = until;
    }
  }

  const start: State = {
    order: null,
    depth: 0,
    taken: noBits(runs.length),
    parked: new Array(people).fill(undefined),
    spent: noBits(pairAt.size),
    parties: "",
    lastRunAt: new Array(people).fill(-1),
    left: runsPerPerson,
    waiting: 0,
    owed: 0,
    minutes: 0,
    switches: 0,
    orderKey: null,
    preferKey: null,
  };

  const byCount: Plan[] = [];
  let beam: State[] = [start];

  while (beam.length > 0) {
    // Keyed on what the future actually depends on: which runs are gone, where everyone is parked,
    // and how long ago each person last played. Two states agreeing on all three are the same
    // problem from here, so only the cheaper one is worth carrying. The third is there because
    // waiting is counted: two states can park everybody identically and still owe a different gap
    // to whoever comes back next.
    const next = new Map<string, State>();

    for (const state of beam) {
      for (const { run, index, persons, pairs, size, readyAt, dueBy, waitsFor } of prepared) {
        if (hasBit(state.taken, index)) continue;

        // The later of the clock and everybody in it being free. Nothing else ever moves a run
        // later than the one before it, so idle time only exists where somebody is not here yet.
        const startsAt = readyAt > state.minutes ? readyAt : state.minutes;
        const minutes = startsAt + run.minutes;
        if (minutes > options.minutes) continue;
        // Hard. Somebody who has to be done by their cutoff does not run one that ends after it.
        if (minutes > dueBy) continue;

        let clashes = false;
        for (const pair of pairs) {
          if (hasBit(state.spent, pair)) {
            clashes = true;
            break;
          }
        }
        if (clashes) continue;

        const seats = run.seats;

        // In seat order, because that is the order the marks are drawn in.
        const switched: string[] = [];
        for (let s = 0; s < seats.length; s++) {
          const seat = seats[s] as AttributedSeat;
          const wasOn = state.parked[persons[s] as number];
          if (wasOn !== undefined && wasOn !== seat.character) switched.push(seat.personId);
        }

        const at = state.depth;
        const parked = state.parked.slice();
        const lastRunAt = state.lastRunAt.slice();
        const left = state.left.slice();
        const spent = state.spent.slice();
        let waiting = state.waiting;
        for (let s = 0; s < seats.length; s++) {
          const person = persons[s] as number;
          const before = state.lastRunAt[person] as number;
          if (before >= 0) waiting += at - before - 1;
          parked[person] = (seats[s] as AttributedSeat).character;
          lastRunAt[person] = at;
          left[person] = (left[person] as number) - 1;
          setBit(spent, pairs[s] as number);
        }

        const taken = state.taken.slice();
        setBit(taken, index);

        // Only ever compared for equality, so the shape is free: the taken words, the clock, then
        // everyone who has logged in, in person order.
        //
        // The clock is in here because waiting for somebody makes it depend on the ORDER the runs
        // were taken in and not just on which ones. Without an arrival it is the sum of the taken
        // runs and therefore already implied by the words in front of it, which is why adding it
        // cannot change a plan for a night nobody turns up late to.
        //
        // `owed` rides along the same pass: it reads only `parked`, `lastRunAt` and `left`, all of
        // which the key already covers, so it is a function of the key and cannot split one.
        let owed = 0;
        let key = `${taken.join()}@${minutes}`;
        for (let person = 0; person < people; person++) {
          const on = parked[person];
          if (on === undefined) continue;
          key += `|${person}>${on}@${lastRunAt[person]}`;
          if ((left[person] as number) > 0 && minutes + shortestRun[person] <= offBy[person]) {
            owed += at - (lastRunAt[person] as number);
          }
        }

        const candidate: State = {
          order: {
            planned: {
              run,
              switched,
              startsAt,
              waitingFor: startsAt > state.minutes ? waitsFor : [],
            },
            before: state.order,
          },
          depth: at + 1,
          taken,
          parked,
          spent,
          parties: state.parties + size,
          lastRunAt,
          left,
          waiting,
          owed,
          minutes,
          switches: state.switches + switched.length,
          orderKey: null,
          preferKey: null,
        };

        const held = next.get(key);
        if (!held || steer(candidate, held) < 0) next.set(key, candidate);
      }
    }

    // Full width to EACH comparator, carrying the union forward, because the estimate steers and
    // can therefore steer wrong: `owed` prefers a state with nobody stranded over one with more
    // of the clock left, and less clock left fits fewer runs after it. Planning two thousand
    // random nights both ways, that dropped a whole boss on three of them, and a boss is the one
    // thing ranked above waiting. Splitting one width between the two was far worse again (38 of
    // the two thousand), so the count is bought with width and not with the ranking.
    const pool = [...next.values()];
    const steered = bestOf(pool.slice(), beamWidth, steer);
    const plain = bestOf(pool, beamWidth, pick);

    const kept = new Set(steered);
    beam = steered;
    for (const state of plain) {
      if (!kept.has(state)) {
        kept.add(state);
        beam.push(state);
      }
    }
    if (beam.length === 0) break;

    // The beam is cut on the estimate, the plan of this length is picked off what survived.
    let leader = beam[0] as State;
    for (let i = 1; i < beam.length; i++) {
      if (pick(beam[i] as State, leader) < 0) leader = beam[i] as State;
    }
    byCount.push(toPlan(leader));
  }

  return { best: byCount[byCount.length - 1] ?? EMPTY_PLAN, byCount };
}

/** `ids` in an order fixed by `seed`: the same seed, the same order. */
export function shuffledIds(ids: readonly string[], seed: number): string[] {
  // mulberry32
  let a = seed;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    swap(out, i, j);
  }
  return out;
}

/** Runs each person sits out between two of their own, summed. See WAITING. */
function waitingOf(plan: Plan): number {
  const lastAt = new Map<string, number>();
  let waiting = 0;
  plan.runs.forEach((planned, at) => {
    for (const seat of planned.run.seats) {
      const before = lastAt.get(seat.personId);
      if (before !== undefined) waiting += at - before - 1;
      lastAt.set(seat.personId, at);
    }
  });
  return waiting;
}

/** betterPlanned, less its tie-break, on two finished plans of the same length. Zero is a tie. */
export function comparePlans(a: Plan, b: Plan): number {
  for (let i = 0; i < a.runs.length; i++) {
    const left = (a.runs[i] as PlannedRun).run.seats.length;
    const right = (b.runs[i] as PlannedRun).run.seats.length;
    if (left !== right) return right - left;
  }
  const waiting = waitingOf(a) - waitingOf(b);
  if (waiting !== 0) return waiting;
  if (a.switches !== b.switches) return a.switches - b.switches;
  return a.minutes - b.minutes;
}

/**
 * [plan]'s own runs reordered with their ties broken by `seed`, for Run Order's Shuffle.
 *
 * Never other bosses, and only an order that scores exactly as well, so a tab's switch count still
 * holds. The tie-break also steers the beam, so where the reordered search ends anywhere else
 * [plan] comes back as it was. A `prefer` still comes first, the shuffle breaking what it leaves.
 */
export function shuffledPlan(plan: Plan, options: PlanOptions, seed: number): Plan {
  const picked = plan.runs.map((planned) => planned.run);
  const named = new Set(options.prefer);
  const rest = picked.map((run) => run.id).filter((id) => !named.has(id));
  const prefer = [...(options.prefer ?? []), ...shuffledIds(rest, seed)];
  const beamWidth = Math.min(options.beamWidth ?? SHUFFLE_BEAM, SHUFFLE_BEAM);
  const mine = planNight(picked, { ...options, prefer, beamWidth }).byCount[picked.length - 1];
  return mine !== undefined && comparePlans(mine, plan) === 0 ? mine : plan;
}

// Narrow, because a press has to answer at once and a miss only means the plan comes back as it was.
// At 22 untimed runs, 92ms a press against 483ms at the full 1000, both giving 10 different orders
// in 10 seeds (2026-10-27, a scratch timing over the shuffledPlan tests' generator).
const SHUFFLE_BEAM = 200;

/**
 * A plan with some of its runs taken out, the rest kept in the same order and re-timed.
 *
 * This is how Run Order hides what is already cleared. Planning only what is left re-ran the
 * search on a smaller set, and the best order of a subset is not the superset's order with gaps:
 * two cleared bosses put the last run of the night first. Planning everything and hiding the
 * cleared runs keeps every remaining row where it was.
 *
 * Switch marks are redrawn against the rows kept, because a hidden run is already done and nobody
 * plays it tonight. Kept as planned, they marked a seat whose name had not changed and missed one
 * that had. A run that no longer fits once re-timed is dropped, which can only happen when the
 * search was given more clock than `options.minutes` to account for the hidden runs.
 */
export function withoutRuns(plan: Plan, hidden: ReadonlySet<string>, options: PlanOptions): Plan {
  const available = options.available ?? {};
  const runs: PlannedRun[] = [];
  let clock = 0;
  let switches = 0;
  // Where each person is parked, by person id, as the kept rows leave them.
  const parked = new Map<string, string>();
  for (const planned of plan.runs) {
    if (hidden.has(planned.run.id)) continue;
    const { readyAt, dueBy, waitsFor } = windowOf(planned.run, available);
    const startsAt = readyAt > clock ? readyAt : clock;
    const ends = startsAt + planned.run.minutes;
    if (ends > options.minutes || ends > dueBy) continue;
    const switched: string[] = [];
    for (const seat of planned.run.seats) {
      const wasOn = parked.get(seat.personId);
      if (wasOn !== undefined && wasOn !== seat.character) switched.push(seat.personId);
      parked.set(seat.personId, seat.character);
    }
    runs.push({ ...planned, switched, startsAt, waitingFor: startsAt > clock ? waitsFor : [] });
    clock = ends;
    switches += switched.length;
  }
  return { runs, switches, minutes: clock };
}

/**
 * `byCount` with the hidden runs taken out of every plan, still one plan per length, shortest first.
 *
 * Two plans can come out the same length once hidden runs are gone. The one from the longer search
 * is kept, so the plan on screen is the restriction of the full night's best.
 */
export function withoutRunsByCount(
  byCount: Plan[],
  hidden: ReadonlySet<string>,
  options: PlanOptions,
): Plan[] {
  return sourcesByCount(byCount, hidden, options).map((source) => source.shown);
}

/** withoutRunsByCount, with the index into `byCount` each plan came from. */
export function sourcesByCount(
  byCount: Plan[],
  hidden: ReadonlySet<string>,
  options: PlanOptions,
): { shown: Plan; from: number }[] {
  const byLength = new Map<number, { shown: Plan; from: number }>();
  for (let i = byCount.length - 1; i >= 0; i--) {
    const shown = withoutRuns(byCount[i] as Plan, hidden, options);
    if (shown.runs.length > 0 && !byLength.has(shown.runs.length)) {
      byLength.set(shown.runs.length, { shown, from: i });
    }
  }
  return [...byLength.values()].sort((a, b) => a.shown.runs.length - b.shown.runs.length);
}

/**
 * The plans actually worth choosing between, longest first.
 *
 * Out of `byCount`, the ones that buy something: a shorter plan earns its place only by costing
 * strictly fewer switches than every longer one. Dropping a boss to save nothing is not an option
 * anybody wants offered, and listing all of them would bury the two that matter.
 */
export function tradeOffs(byCount: Plan[]): Plan[] {
  const worthwhile: Plan[] = [];
  let fewest = Infinity;

  for (let i = byCount.length - 1; i >= 0; i--) {
    const plan = byCount[i];
    if (plan && plan.switches < fewest) {
      worthwhile.push(plan);
      fewest = plan.switches;
    }
  }

  return worthwhile;
}
