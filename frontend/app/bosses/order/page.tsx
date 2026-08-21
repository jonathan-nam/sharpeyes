"use client";

import { useAuth } from "@clerk/nextjs";
import { useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { RunDraftEditor } from "@/components/run-draft-editor";
import { CopyPlan, type RunLog, RunPlan } from "@/components/run-plan";
import { rotatingDrops, type Rotation, rotationFor } from "@/lib/loot-rotation";
import type { PartyLootPool } from "@/types/loot";
import { apiFetch, readBack } from "@/lib/api";
import { progressLabel } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import { DEFAULT_MINUTES } from "@/lib/boss-minutes";
import {
  type DraftRun,
  formatDuration,
  formatOffsetShort,
  type NightPerson,
  offsetNow,
  parseOffset,
  rosterFrom,
  rosterFromDrafts,
  runsFromDrafts,
  nextHalfHour,
  runsFromParties,
  spanBetween,
  stillToRun,
} from "@/lib/boss-night";
import {
  type Availability,
  type EligibleRun,
  planNight,
  screenRuns,
  tradeOffs,
} from "@/lib/boss-run-plan";
import { peek, put } from "@/lib/cache";
import { runningThisPeriod } from "@/lib/parties";
import { preloadRunArt } from "@/lib/preload-boss-art";
import { controlsKey } from "@/lib/run-order-submit";
import { useDropIcons } from "@/lib/drop-icons";
import { useSeatSprites } from "@/lib/seat-sprites";
import { useRowWrites } from "@/lib/use-row-writes";
import { useShowTimes } from "@/lib/show-times";
import { useWhoIsOn } from "@/lib/who-is-on";
import type { Boss } from "@/types/boss";
import type { DropTables } from "@/types/drop";
import type { AddLootBody } from "@/types/loot";
import type { Party } from "@/types/party";

const BOSSES_KEY = "/api/bosses";
const PARTIES_KEY = "/api/parties";
// The whole catalog's drop tables, so a row can open its picker without a round-trip. Same key as
// Party View and the party page, so all three share one cached copy.
const DROPS_KEY = "/api/bosses/drops";
const POOLS_KEY = "/api/parties/loot";
const DRAFT_KEY = "sharpeyes.run-order.drafts";

/** The windows people actually block out. Anything else goes in the box beside them. */
const PRESETS = [60, 90, 120, 180, 240];

const NO_DRAFTS: DraftRun[] = [];
const NO_RUNS: EligibleRun[] = [];

type Source = "parties" | "byHand";
type LoadState = "loading" | "loaded" | "error";

/** One person's window, as typed. Parsed where it is used, so a half-finished "+3" is not a time. */
type WindowText = { from: string; until: string };

const NO_WINDOW: WindowText = { from: "", until: "" };
const NO_WINDOWS: Record<string, WindowText> = {};

// The clock only has to be right to the minute it is drawn to, and it is read on every render, so
// it ticks on its own rather than being recomputed. Same primitive as the drafts below and for the
// same reason: there is no clock during the prerender, and seeding one from an effect is a
// setState cascade that also renders the wrong minute first.
const CLOCK_TICK = 20_000;

function subscribeToClock(onChange: () => void) {
  const timer = setInterval(onChange, CLOCK_TICK);
  return () => clearInterval(timer);
}

/** Quantised to the minute by offsetNow, so repeated reads inside one render agree. */
function readClock(): number {
  return offsetNow(Date.now());
}

function noClock(): null {
  return null;
}

/**
 * What a chip says about somebody without being opened: "· +2 to +4", "· to +3.5".
 *
 * Null when there is nothing to say, which is the usual case and the reason the chip row still
 * reads as a row of names.
 */
function pinOf(window: WindowText | undefined): string | null {
  const from = window ? parseOffset(window.from) : null;
  const until = window ? parseOffset(window.until) : null;

  const said: string[] = [];
  if (from !== null && until !== null)
    said.push(`${formatOffsetShort(from)} to ${formatOffsetShort(until)}`);
  else if (from !== null) said.push(`from ${formatOffsetShort(from)}`);
  else if (until !== null) said.push(`to ${formatOffsetShort(until)}`);

  return said.length === 0 ? null : `· ${said.join(" · ")}`;
}

// Hand-typed runs are read through useSyncExternalStore rather than an effect. localStorage does
// not exist during the prerender, so seeding useState from it hydrates to different markup than
// the server sent, and loading it in an effect is a setState-in-effect cascade. This is the
// primitive for exactly that: getServerSnapshot answers the prerender, and React re-reads on the
// client without a mismatch.
//
// The `storage` event fires for OTHER tabs only, so our own writes never come back this way. That
// is what the `edited` state below is for.
function subscribeToDrafts(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readStoredDrafts(): string | null {
  try {
    return window.localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

/** Nothing on the server, because there is no localStorage to have anything in. */
function noStoredDrafts(): string | null {
  return null;
}

function parseDrafts(raw: string | null): DraftRun[] {
  if (raw === null) return NO_DRAFTS;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DraftRun[]) : NO_DRAFTS;
  } catch {
    // A corrupt draft is not worth an error on screen. You get an empty form, which is what you
    // would have had anyway.
    return NO_DRAFTS;
  }
}

export default function RunOrderPage() {
  preloadRunArt();
  const { getToken } = useAuth();

  const seededParties = peek<Party[]>(PARTIES_KEY);
  const seededBosses = peek<Boss[]>(BOSSES_KEY);

  const [parties, setParties] = useState<Party[]>(seededParties ?? []);
  const [bosses, setBosses] = useState<Boss[]>(seededBosses ?? []);
  const [dropTables, setDropTables] = useState<DropTables>(peek<DropTables>(DROPS_KEY) ?? {});
  // Only for the loot rotation, which is read off what each week's pickups were. Nothing else on
  // this page needs the pools, so losing them costs a line on some rows and nothing else.
  const [pools, setPools] = useState<PartyLootPool[]>(peek<PartyLootPool[]>(POOLS_KEY) ?? []);
  const [state, setState] = useState<LoadState>(seededParties ? "loaded" : "loading");

  // A run in the night links to its party, which draws its seats. See lib/seat-sprites.ts.
  useSeatSprites(parties);
  // A run opens to the drop picker, which draws them. See lib/drop-icons.ts.
  useDropIcons(dropTables);

  // Per row, so ticking one boss does not dim every other row's controls. See lib/use-row-writes.ts.
  const { isSaving, write } = useRowWrites();
  // Every config this page has written to this sitting. They stay in the night rather than dropping
  // out of the filter under the plan somebody is reading. See stillToRun.
  //
  // ANY write, not just the tick. Logging a drop clears the boss too (a drop is evidence of a
  // night, see addLoot), so pinning on the tick alone took the run off the plan the moment the
  // first drop landed, closing the picker on a boss that had three more things to log.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());

  /** Pins a config for the sitting. Called BEFORE the write: see toggleClear. */
  function keepInNight(partyId: string) {
    setAnswered((current) => (current.has(partyId) ? current : new Set(current).add(partyId)));
  }

  /** Each party's own rows, for the rotation to read its answered weeks off. */
  const lootByParty = new Map(pools.map((pool) => [pool.partyId, pool.loot]));

  const [source, setSource] = useState<Source>("parties");
  const [duration, setDuration] = useState(120);
  const [openOnly, setOpenOnly] = useState(true);
  // Who is off, kept across visits. The same handful of people are away most weeks, and unticking
  // them again every visit is the sort of setup that gets skipped, which plans a night around
  // somebody who is not there. See lib/who-is-on.ts.
  const [away, setAway] = useWhoIsOn();
  const [chosen, setChosen] = useState<number | null>(null);
  const [edited, setEdited] = useState<DraftRun[] | null>(null);

  // Whether the night runs to the clock at all. Off, it is an ORDER: nothing bounds it, the windows
  // people gave are not applied, and no time is drawn anywhere. That is a night where the length of
  // a run is a guess nobody is holding to, and showing one would be reading a schedule into a list.
  // The windows are kept while it is off, so ticking it back on gets the same night back. Kept
  // across visits too: the choice is how you plan, not something about tonight.
  const [timed, setTimed] = useShowTimes();

  // The night on the reset clock: when it starts, when it has to be over, and who is only here for
  // part of it. Every one is a time against reset, signed, which is what the party already says.
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState<string | null>(null);
  const [windows, setWindows] = useState<Record<string, WindowText>>(NO_WINDOWS);
  const [opened, setOpened] = useState<string | null>(null);

  const now = useSyncExternalStore(subscribeToClock, readClock, noClock);
  // Now, rounded up, until you say otherwise. The prerender has no clock and lands on zero, which
  // nothing draws: every section holding a time is behind data that is empty until the fetch.
  const startAt = parseOffset(startText) ?? (now === null ? 0 : nextHalfHour(now));

  // The end is what people say ("done by +2"), the duration is what they pick, and either can be
  // the one that moves. Typing an end wins while it parses; a preset hands it back to the duration.
  const endAt = endText === null ? null : parseOffset(endText);
  const budget = endAt === null ? duration : spanBetween(startAt, endAt);
  const endShown = endText ?? formatOffsetShort(startAt + budget);

  const storedRaw = useSyncExternalStore(subscribeToDrafts, readStoredDrafts, noStoredDrafts);
  const stored = useMemo(() => parseDrafts(storedRaw), [storedRaw]);
  const drafts = edited ?? stored;

  function changeDrafts(next: DraftRun[]) {
    setEdited(next);
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    } catch {
      // Private browsing, or a full quota. The tool still works for this sitting.
    }
  }

  useEffect(() => {
    let live = true;
    // One token for the burst. getToken() can round-trip to Clerk, and paying that per request is
    // latency the user waits through twice for no reason.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, withToken),
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          // Optional, as it is on Party View: losing it costs a row's drop picker, and a night you
          // cannot log a drop from still tells you what to run and in what order.
          apiFetch<DropTables>(DROPS_KEY, { method: "GET" }, withToken).catch(() => null),
          // Optional for the same reason: it only feeds the rotation, and a night still tells you
          // what to run without it.
          apiFetch<PartyLootPool[]>(POOLS_KEY, { method: "GET" }, withToken).catch(() => null),
        ]);
      })
      .then(([nextParties, nextBosses, nextDrops, nextPools]) => {
        if (!live) return;
        setParties(nextParties);
        setBosses(nextBosses);
        put(PARTIES_KEY, nextParties);
        put(BOSSES_KEY, nextBosses);
        if (nextDrops) {
          setDropTables(nextDrops);
          put(DROPS_KEY, nextDrops);
        }
        if (nextPools) {
          setPools(nextPools);
          put(POOLS_KEY, nextPools);
        }
        setState("loaded");
      })
      .catch(() => {
        // Signed out lands here too, and that is not a failure: it is the standalone tool. The
        // parties tab says so and offers the other one.
        if (live) setState((current) => (current === "loaded" ? "loaded" : "error"));
      });
    return () => {
      live = false;
    };
  }, [getToken]);

  /**
   * The list again, after a write, so what is on screen is the server's answer and not ours.
   *
   * Which period a tick landed in and which of the three counts a drop went to are both the
   * server's to derive, exactly as they are on Party View.
   */
  async function refetchParties() {
    const refreshed = await apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, getToken);
    setParties(refreshed);
    put(PARTIES_KEY, refreshed);
  }

  /**
   * Ticks a run off, or un-ticks it.
   *
   * The same boss_clear row Party View's boss row writes and a planner capture overwrites, so
   * ticking a boss here and ticking it there are one answer rather than two.
   */
  async function toggleClear(party: Party, cleared: boolean) {
    // Marked before the write, not after: the row has to stay in the night whether the tick lands
    // or not, or a failed save would take the run off the plan on its way to saying it failed.
    keepInNight(party.id);
    try {
      await write(party.id, async () => {
        await apiFetch<Party>(
          `${PARTIES_KEY}/${party.id}/clear`,
          { method: "PUT", body: JSON.stringify({ cleared }) },
          getToken,
        );
        await refetchParties();
      });
    } catch {
      // Leaving the old state up beats showing a tick that did not save.
    }
  }

  /**
   * Logs a drop into the party's own pool, the same POST the party page and Party View make.
   *
   * Pinned like a tick, because the server treats it as one: addLoot clears the boss, and a boss
   * that dropped four things has three more to log after the first.
   */
  async function addDrop(party: Party, body: AddLootBody) {
    keepInNight(party.id);
    await write(party.id, async () => {
      await apiFetch<unknown>(
        `${PARTIES_KEY}/${party.id}/loot`,
        { method: "POST", body: JSON.stringify(body) },
        getToken,
      );
      // The drop is in from here, so a failed refetch is the plan going stale. See StaleAfterWrite.
      await readBack(refetchParties);
    });
  }

  const fromAccount = source === "parties";

  // A boss taken off this period is out of the night whatever the toggle says. "Only bosses not
  // cleared" is a narrowing you can turn off to see the rest; "we are not running it" is not one of
  // those, and a plan that scheduled it anyway would be a night built around a boss Party View has
  // already dropped.
  const running = useMemo(() => runningThisPeriod(parties), [parties]);

  // --- The controls, live --------------------------------------------------------------------
  //
  // A CONTROL answers on the tick you click it, so the chips and the sections around them are
  // drawn from state as it is now. Only the plan waits to be asked for.
  //
  // `answered` is what keeps a run you have just written to on screen instead of dropping it out
  // from under the plan. See stillToRun.
  const usable = useMemo(
    () => (openOnly ? stillToRun(running, answered) : running),
    [running, openOnly, answered],
  );

  const roster: NightPerson[] = useMemo(
    () => (fromAccount ? rosterFrom(usable) : rosterFromDrafts(drafts)),
    [fromAccount, usable, drafts],
  );

  const runs = useMemo(
    () => (fromAccount ? runsFromParties(usable, bosses) : runsFromDrafts(drafts)),
    [fromAccount, usable, bosses, drafts],
  );

  const openedPerson = roster.find((person) => person.id === opened) ?? null;

  // --- The night that was asked for ----------------------------------------------------------
  //
  // The plan is built from the controls as they were when the button was pressed, not as they are.
  // Half a night is a half-typed night: a time being entered, a person about to be ticked back on,
  // an order the group is following that must not re-sort under them while somebody adjusts a box.
  //
  // Snapshot the INPUTS rather than each derived value: derived values are computed at different
  // depths of the chain, and freezing them one by one is what would let them disagree. Server data
  // (parties, bosses) is deliberately not in here, so a write during the night still lands.
  const inputs = useMemo(
    () => ({ source, budget, openOnly, away, drafts, startAt, windows, timed }),
    [source, budget, openOnly, away, drafts, startAt, windows, timed],
  );

  // What the button compares against. See lib/run-order-submit.ts for why it is a key.
  const key = useMemo(
    () =>
      controlsKey({ source, openOnly, timed, away, windows, drafts, startText, endText, duration }),
    [source, openOnly, timed, away, windows, drafts, startText, endText, duration],
  );

  const [asked, setAsked] = useState<{ inputs: typeof inputs; key: string } | null>(null);
  // Deferred so the press itself lands on the tick it is made. planNight is a beam search, and a
  // night of a dozen bosses is long enough to be felt between the click and the button answering.
  //
  // Taking the plan AWAY is not deferred, though: a deferred null draws the old plan one more
  // time, which is the parties plan flashing under the by-hand tab that just replaced it.
  const deferredAsk = useDeferredValue(asked);
  const shownAsk = asked === null ? null : deferredAsk;
  const stale = shownAsk !== asked;
  const shown = shownAsk?.inputs ?? inputs;
  const planning = shownAsk !== null;
  // The controls have moved since. Said by the button, which is the only thing that can act on it.
  const outdated = asked !== null && asked.key !== key;

  function showOrder() {
    setAsked({ inputs, key });
    setChosen(null);
  }

  const showingAccount = shown.source === "parties";

  // The same two lists again, from the night that was asked for. Not shared with the live ones
  // above: those describe the controls, and these are what the plan is, so a filter ticked after
  // the plan was drawn must move one and not the other.
  const plannedParties = useMemo(
    () => (shown.openOnly ? stillToRun(running, answered) : running),
    [running, shown.openOnly, answered],
  );

  const plannedRuns = useMemo(
    () => (showingAccount ? runsFromParties(plannedParties, bosses) : runsFromDrafts(shown.drafts)),
    [showingAccount, plannedParties, bosses, shown.drafts],
  );

  // Who is on, as people and as ids. The grid puts a column per person, so it needs the names and
  // the order, not just the set the screening asks for.
  const onTonight = useMemo(() => {
    const people = showingAccount ? rosterFrom(plannedParties) : rosterFromDrafts(shown.drafts);
    return people.filter((person) => !shown.away.includes(person.id));
  }, [showingAccount, plannedParties, shown.drafts, shown.away]);
  const here = useMemo(() => onTonight.map((person) => person.id), [onTonight]);

  // Only the eligible half is read. screenRuns still reports what it rejected, and the page no
  // longer shows it: a run nobody can staff now just does not appear.
  //
  // Nothing until the night has been asked for, which is what keeps the search, the plan and
  // "Left out" all empty rather than each needing its own gate.
  const eligible = useMemo(
    () => (planning ? screenRuns(plannedRuns, here).eligible : NO_RUNS),
    [planning, plannedRuns, here],
  );

  // Nothing on screen marks the wait. Fading the old plan through it was tried and removed: at the
  // ~64ms a normal account takes, the fade began and reversed before it finished, and a flicker
  // reads as a fault where the plain swap reads as the page keeping up. aria-busy still says it,
  // for anything listening rather than looking.
  // Windows are stated on the reset clock and the search counts from the start of the night, so
  // this is where the one becomes the other. A half-typed "+" parses to nothing and constrains
  // nothing, which is what stops the plan lurching about while somebody types a time.
  //
  // spanBetween rather than a subtraction: the clock wraps at reset, and it also answers the
  // person who was already free before the night started with a nought rather than most of a day.
  const available = useMemo(() => {
    const byPerson: Record<string, Availability> = {};
    // A window is a time, so an untimed night has none. Not cleared, just not applied: the boxes
    // still hold what was typed for when the clock comes back.
    if (!shown.timed) return byPerson;
    for (const [id, window] of Object.entries(shown.windows)) {
      const from = parseOffset(window.from);
      const until = parseOffset(window.until);
      const said: Availability = {};
      if (from !== null) said.from = spanBetween(shown.startAt, from);
      if (until !== null) said.until = spanBetween(shown.startAt, until);
      if (said.from !== undefined || said.until !== undefined) byPerson[id] = said;
    }
    return byPerson;
  }, [shown.windows, shown.startAt, shown.timed]);

  // What the night is allowed to take. Nothing, when it is not being run to the clock: the point of
  // that mode is that the length is not the question, so every boss that can be run is in the plan
  // and none is dropped for a reason the page is no longer showing.
  const night = shown.timed ? shown.budget : Infinity;

  const { best, byCount } = useMemo(
    () => planNight(eligible, { minutes: night, available }),
    [eligible, night, available],
  );

  const options = useMemo(() => tradeOffs(byCount), [byCount]);
  // Clamps by itself: a stale index from a previous set of inputs falls back to the full plan
  // rather than showing one built for a question that is no longer being asked.
  const plan = (chosen !== null && options[chosen]) || best;

  const scheduled = new Set(plan.runs.map((planned) => planned.run.id));
  const unscheduled = eligible.filter((run) => !scheduled.has(run.id));
  const assumed = plan.runs.filter((planned) => planned.run.assumed).length;

  // A run's id IS its config's id, which is what lets the plan be answered for at all. See
  // runsFromParties. Keyed off every config still on the period rather than the filtered set: a
  // plan drawn before the filter moved holds runs that are no longer in it, and a run on screen
  // that cannot find its config is a row you cannot tick.
  const partyById = useMemo(() => new Map(running.map((party) => [party.id, party])), [running]);
  // A picker with no tables behind it lists nothing, and then explains the empty list as "no drop
  // table recorded for this boss", which is a claim about the catalog we are not in a position to
  // make from here. Same rule as Party View's.
  const haveDropTables = Object.keys(dropTables).length > 0;

  /**
   * Whose turn it is on this run's pieces, or null for a boss with none to rotate.
   *
   * An EVEN split is drawn now, unlike when this fed a badge on every person's cell: what ruled one
   * out was a column of identical figures across the grid, and in a panel somebody opened there is
   * no column and an even week is worth saying. Same block Party View draws, same reasons.
   */
  const rotationOnRun = (party: Party | undefined): Rotation | null => {
    if (!party) return null;
    const drop = rotatingDrops(party, dropTables)[0];
    if (!drop) return null;
    const mode = party.difficulty ?? "";
    const quantity = drop.pieces?.[party.worldType]?.[mode] ?? 0;
    const bundles = drop.bundles?.[party.worldType]?.[mode] ?? 0;
    return rotationFor(party, lootByParty.get(party.id) ?? [], drop, quantity, bundles);
  };

  // Only a night built from your parties can be answered for: a hand-typed run has no config
  // behind it, so there is nothing to tick and no pool to log a drop into.
  const log: RunLog | undefined = showingAccount
    ? {
        partyOf: (runId) => partyById.get(runId),
        rotationOf: (runId) => rotationOnRun(partyById.get(runId)),
        dropTable: (bossKey) => dropTables[bossKey],
        busy: isSaving,
        onToggleClear: toggleClear,
        onAddDrop: haveDropTables ? addDrop : undefined,
      }
    : undefined;

  const cleared = plan.runs.filter(
    (planned) => partyById.get(planned.run.id)?.cleared === true,
  ).length;

  return (
    <main className="page">
      <h1 className="page-title">Run Order</h1>

      <div className="basis-row" role="group" aria-label="Where the runs come from">
        {(
          [
            ["parties", "From my parties"],
            ["byHand", "By hand"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={source === value ? "basis-tab active" : "basis-tab"}
            aria-pressed={source === value}
            onClick={() => {
              setSource(value);
              // Not just outdated: a plan built from your parties, sitting under the by-hand
              // editor, is a run order for a night this tab is not showing.
              setAsked(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* The class is on the hint, not the <main>: this page draws most of itself without waiting
          for anything, and hiding all of it to cover one line would blank the controls too. */}
      {fromAccount && state === "loading" && (
        <p className="party-hint page-waiting">Loading your parties...</p>
      )}

      {fromAccount && state === "error" && (
        <p className="finder-empty">
          Couldn&apos;t load your parties. Sign in to plan from them, or{" "}
          <button type="button" className="party-cancel" onClick={() => setSource("byHand")}>
            build the night by hand
          </button>
          .
        </p>
      )}

      {fromAccount && state === "loaded" && parties.length === 0 && (
        <p className="finder-empty">
          No parties yet. Add some under Party View, or build the night by hand.
        </p>
      )}

      {/* The filter sits with the parties it narrows, not down in the budget section, because it
          is the only way back out of the state where it has excluded everything. Under a heading
          the plan renders it left a cleared week with a blank page and no control on it. */}
      {fromAccount && state === "loaded" && parties.length > 0 && (
        <label className="night-toggle">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
          />
          <span>Only bosses not cleared this period</span>
        </label>
      )}

      {/* showingAccount, not fromAccount: this describes the runs, so it moves with them rather
          than a render ahead of them. Counted over the parties still ON the period: counting every
          config would call a boss taken off by hand a boss that is cleared, which is a different
          answer to "why is there nothing to run". */}
      {showingAccount && state === "loaded" && parties.length > 0 && runs.length === 0 && (
        <p className="finder-empty">
          {running.length === 0
            ? "Every boss is off this period."
            : running.length === 1
              ? "Your party is cleared this period."
              : `All ${running.length} parties are cleared this period.`}
        </p>
      )}

      {!fromAccount && (
        <section className="night-section">
          <h2 className="night-heading">The runs</h2>
          {/* Both halves are required, and a run missing either is skipped. Saying so up front
              beats a row that silently never appears in the plan. */}
          <p className="party-hint">
            One row per boss, with the character each person brings. A run needs both to be
            scheduled.
          </p>
          <RunDraftEditor drafts={drafts} onChange={changeDrafts} />
        </section>
      )}

      {roster.length > 0 && (
        <section className="night-section">
          <h2 className="night-heading">Who is on</h2>
          <ul className="night-roster">
            {roster.map((person) => {
              const on = !away.includes(person.id);
              const pin = pinOf(windows[person.id]);
              return (
                <li className="night-chip" key={person.id}>
                  <button
                    type="button"
                    className={on ? "night-person is-on" : "night-person"}
                    aria-pressed={on}
                    onClick={() =>
                      setAway(on ? [...away, person.id] : away.filter((id) => id !== person.id))
                    }
                  >
                    {person.name}
                    {pin && <span className={timed ? "night-pin" : "night-pin is-off"}>{pin}</span>}
                  </button>
                  <button
                    type="button"
                    className={[
                      "night-chip-set",
                      on ? "is-on" : "",
                      opened === person.id ? "is-open" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-expanded={opened === person.id}
                    aria-label={`When ${person.name} is free`}
                    disabled={!timed}
                    onClick={() =>
                      setOpened((current) => (current === person.id ? null : person.id))
                    }
                  >
                    <span aria-hidden="true">&#9662;</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Named off the roster rather than off `opened` alone: switching source swaps everybody
              out, and a row headed by nothing is worse than no row. */}
          {openedPerson !== null && (
            <div className={timed ? "night-detail" : "night-detail night-off"}>
              <span className="night-detail-who">{openedPerson.name}</span>
              <label className="night-custom">
                <span>Free from</span>
                <input
                  className="split-input"
                  type="text"
                  inputMode="decimal"
                  disabled={!timed}
                  value={(windows[openedPerson.id] ?? NO_WINDOW).from}
                  placeholder={formatOffsetShort(startAt)}
                  onChange={(e) => {
                    const from = e.target.value;
                    setWindows((current) => ({
                      ...current,
                      [openedPerson.id]: { ...(current[openedPerson.id] ?? NO_WINDOW), from },
                    }));
                  }}
                />
              </label>
              <label className="night-custom">
                <span>until</span>
                <input
                  className="split-input"
                  type="text"
                  inputMode="decimal"
                  disabled={!timed}
                  value={(windows[openedPerson.id] ?? NO_WINDOW).until}
                  placeholder={formatOffsetShort(startAt + budget)}
                  onChange={(e) => {
                    const until = e.target.value;
                    setWindows((current) => ({
                      ...current,
                      [openedPerson.id]: { ...(current[openedPerson.id] ?? NO_WINDOW), until },
                    }));
                  }}
                />
              </label>
            </div>
          )}
        </section>
      )}

      {/* Everything the clock drives hangs off this one box: the window below, the windows people
          gave, and every time in the plan and in what gets pasted. Unticked it disables them rather
          than removing them, so the only thing that changes size is the plan. Two sections and a
          chevron per chip vanishing moved the whole page under the cursor that ticked it. */}
      {runs.length > 0 && (
        <label className="night-toggle">
          <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} />
          <span>Show times</span>
        </label>
      )}

      {runs.length > 0 && (
        <section className={timed ? "night-section" : "night-section night-off"}>
          <h2 className="night-heading">When you&apos;re running</h2>
          <div className="night-budget">
            <label className="night-custom">
              <span>From</span>
              <input
                className="split-input"
                type="text"
                inputMode="decimal"
                disabled={!timed}
                value={startText}
                placeholder={now === null ? "" : formatOffsetShort(nextHalfHour(now))}
                onChange={(e) => setStartText(e.target.value)}
              />
            </label>
            <span className="basis-row">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={budget === preset ? "basis-tab active" : "basis-tab"}
                  aria-pressed={budget === preset}
                  disabled={!timed}
                  onClick={() => {
                    setDuration(preset);
                    setEndText(null);
                  }}
                >
                  {formatDuration(preset)}
                </button>
              ))}
            </span>
            {/* An end rather than a length, because "we need to be done by +2" is what gets said.
                It follows the presets until it is typed in, and then it is what sets the length. */}
            <label className="night-custom">
              <span>until</span>
              <input
                className="split-input"
                type="text"
                inputMode="decimal"
                disabled={!timed}
                value={endShown}
                onChange={(e) => setEndText(e.target.value)}
              />
            </label>
            {now !== null && (
              <span className="night-now">
                now <b>{formatOffsetShort(now)}</b>
              </span>
            )}
          </div>
        </section>
      )}

      {/* Nothing below this is drawn until it is asked for. The order is what the group is sent,
          and one built while somebody is still ticking names is a night they are not running. */}
      {runs.length > 0 && (
        <button
          type="button"
          className="party-save night-go"
          disabled={asked !== null && !outdated}
          onClick={showOrder}
        >
          {outdated ? "Update run order" : "Show run order"}
        </button>
      )}

      {plan.runs.length > 0 && (
        <section className="night-section" aria-busy={stale}>
          {/* The copy button sits a line above the plan tabs: both act on the plan below them, and
              the button keeps its place however many tabs there are. */}
          <div className="night-plan-copy">
            <div className="night-plan-line">
              <CopyPlan plan={plan} roster={onTonight} />
              {/* How far through the night is, in the words Party View already counts clears in.
                  The rows say which ones; this says how many are left without counting them. */}
              {log && (
                <span className="night-progress">
                  {progressLabel({ cleared, total: plan.runs.length })}
                </span>
              )}
            </div>
            {options.length > 1 && (
              <div className="basis-row" role="group" aria-label="Plans to choose between">
                {options.map((option, i) => (
                  <button
                    key={option.runs.length}
                    type="button"
                    className={plan === option ? "basis-tab active" : "basis-tab"}
                    aria-pressed={plan === option}
                    onClick={() => setChosen(i)}
                  >
                    {option.runs.length} {option.runs.length === 1 ? "boss" : "bosses"}
                    <span className="tab-count">
                      {option.switches} {option.switches === 1 ? "switch" : "switches"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <RunPlan
            plan={plan}
            roster={onTonight}
            startAt={shown.startAt}
            timed={shown.timed}
            log={log}
          />

          {/* What was guessed stays on screen. It is what the finishing time is built from, and a
              time presented without it reads as a measurement of your parties. */}
          {shown.timed && assumed > 0 && (
            <p className="split-caveat">
              {assumed === plan.runs.length
                ? `Every run is assumed to take ${formatDuration(DEFAULT_MINUTES)}.`
                : `${assumed} ${assumed === 1 ? "run" : "runs"} assumed at ${formatDuration(DEFAULT_MINUTES)}.`}
            </p>
          )}
        </section>
      )}

      {/* The second is a claim about the clock, so it is not made where there is not one. Nothing
          untimed reaches it anyway: with nothing bounding the night, a run that can be staffed
          fits. */}
      {planning && plannedRuns.length > 0 && plan.runs.length === 0 && (
        <p className="finder-empty">
          {eligible.length === 0 || !shown.timed
            ? "No run can go ahead with the people who are on."
            : `Nothing fits in ${formatDuration(shown.budget)}. The shortest run needs longer than that.`}
        </p>
      )}

      {/* Just "Left out". Time is not the only thing that drops a run, so a heading that named one
          reason was wrong for the others, and no budget could fix what it blamed on the budget. */}
      {unscheduled.length > 0 && (
        <section className="night-section" aria-busy={stale}>
          <h2 className="night-heading">Left out</h2>
          <ul className="night-leftovers">
            {unscheduled.map((run) => (
              <li key={run.id}>
                {bossLabel(run.bossName, run.difficulty)}
                <span className="night-leftover-seats">
                  {run.seats.map((seat) => seat.character).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
