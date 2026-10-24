"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { StackDraft } from "@/components/drop-picker";
import { CopyPlan, type RunLog, RunPlan } from "@/components/run-plan";
import type { PartyLootPool } from "@/types/loot";
import { apiFetch, readBack } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import { progressLabel } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import { DEFAULT_MINUTES } from "@/lib/boss-minutes";
import {
  formatDuration,
  formatOffsetShort,
  type NightPerson,
  offsetNow,
  parseOffset,
  rosterFrom,
  rosterOfSwitchers,
  nextHalfHour,
  runsFromParties,
  spanBetween,
  stillToRun,
} from "@/lib/boss-night";
import {
  type Availability,
  type CandidateRun,
  EMPTY_PLAN,
  type EligibleRun,
  planNight,
  screenRuns,
  tradeOffs,
  withoutRunsByCount,
} from "@/lib/boss-run-plan";
import { peek, put } from "@/lib/cache";
import { reportDataReady } from "@/lib/rum";
import { modeThisWeek, runningThisPeriod } from "@/lib/parties";
import { closedByHolder, outstanding, runningBalance, stillOpen } from "@/lib/vestige-ledger";
import { shareConfig } from "@/lib/vestige-stacks";
import { preloadRunArt } from "@/lib/preload-boss-art";
import { controlsKey } from "@/lib/run-order-submit";
import { useDropIcons } from "@/lib/drop-icons";
import { usePiecePiles } from "@/lib/use-piece-piles";
import { useSeatSprites } from "@/lib/seat-sprites";
import { useNightClears } from "@/lib/use-night-clears";
import { useEveryoneOn } from "@/lib/everyone-on";
import { useShowTimes } from "@/lib/show-times";
import { useWhoIsOn } from "@/lib/who-is-on";
import { queryParam, replaceQuery, useQueryString } from "@/lib/url-state";
import type { Boss, BossClearsView } from "@/types/boss";
import type { DropTables } from "@/types/drop";
import type { AddLootBody } from "@/types/loot";
import type { Party, SavePartyBody, SeatedParty } from "@/types/party";
import { asYourRow } from "@/lib/shared-parties";
import { useLive } from "@/lib/use-live";
import type { VestigeSettlement } from "@/types/vestige";

const BOSSES_KEY = "/api/bosses";
const PARTIES_KEY = "/api/parties";
// The whole catalog's drop tables, so a row can open its picker without a round-trip. Same key as
// Party View and the party page, so all three share one cached copy.
const DROPS_KEY = "/api/bosses/drops";
const POOLS_KEY = "/api/parties/loot";
// The parties somebody ELSE owns that a character of yours sits in. See SeatedParties.kt.
const SEATED_KEY = "/api/parties/seated";
// Every config there has ever been, solo and retired included, for the coupon balance alone. A debt
// does not stop being owed for having been arranged on a config that has since come off the list,
// and reading the night's list instead would rotate the odd stack against half the account. Same
// key as Party View, so the two share one cached copy and cannot suggest different pickups.
const LEDGER_PARTIES_KEY = "/api/parties?solo=include&retired=include";
// What stops that balance counting a night somebody has already closed. See V52.
const SETTLEMENTS_KEY = "/api/vestige-settlements";
// Only for the week a pile of Eternal pieces is written to.
const CLEARS_KEY = "/api/bosses/clears";

// The stacking drop the picker's two blocks are for. One key, because one item behaves this way: a
// boss drops it in bundles that do not divide by looting alone. See lib/piece-ledger.ts.
const VESTIGE = "vestige-of-erion";

/** The windows people actually block out. Anything else goes in the box beside them. */
const PRESETS = [60, 90, 120, 180, 240];

const NO_RUNS: EligibleRun[] = [];

type LoadState = "loading" | "loaded" | "error";

/** One person's window, as typed. Parsed where it is used, so a half-finished "+3" is not a time. */
type WindowText = { from: string; until: string };

const NO_WINDOW: WindowText = { from: "", until: "" };
const NO_WINDOWS: Record<string, WindowText> = {};

// The clock only has to be right to the minute it is drawn to, and it is read on every render, so
// it ticks on its own rather than being recomputed. There is no clock during the prerender, and
// seeding one from an effect is a setState cascade that also renders the wrong minute first.
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

/** The night's order without "Exclude Party Member Subsets", for that toggle to break ties toward. */
function preferredOrder(
  allRuns: CandidateRun[],
  hereAll: string[],
  hidden: ReadonlySet<string>,
  night: number,
  available: Record<string, Availability>,
): string[] {
  const runs = screenRuns(allRuns, hereAll).eligible;
  let hiddenMinutes = 0;
  for (const run of runs) if (hidden.has(run.id)) hiddenMinutes += run.minutes;
  return planNight(runs, { minutes: night + hiddenMinutes, available }).best.runs.map(
    (planned) => planned.run.id,
  );
}

export default function RunOrderPage() {
  preloadRunArt();
  const { getToken, isLoaded } = useAuth();

  const seededParties = peek<Party[]>(PARTIES_KEY);
  const seededBosses = peek<Boss[]>(BOSSES_KEY);

  const [parties, setParties] = useState<Party[]>(seededParties ?? []);
  // Parties somebody else owns that a character of yours sits in, run tonight like your own.
  const [seated, setSeated] = useState<SeatedParty[]>(
    (peek<SeatedParty[]>(SEATED_KEY) ?? []).filter((row) => row.party),
  );
  const nightParties = useMemo(() => [...parties, ...seated.map(asYourRow)], [parties, seated]);
  const [bosses, setBosses] = useState<Boss[]>(seededBosses ?? []);
  const [dropTables, setDropTables] = useState<DropTables>(peek<DropTables>(DROPS_KEY) ?? {});
  // Only for the coupon balance behind the stack boxes, which is read off each week's pickups.
  const [pools, setPools] = useState<PartyLootPool[]>(peek<PartyLootPool[]>(POOLS_KEY) ?? []);
  // Both only for the coupon balance behind the stack boxes. Empty is a balanced first guess rather
  // than a wrong one: see `behind`.
  const [ledgerParties, setLedgerParties] = useState<Party[]>(
    peek<Party[]>(LEDGER_PARTIES_KEY) ?? [],
  );
  const [settlements, setSettlements] = useState<VestigeSettlement[]>(
    peek<VestigeSettlement[]>(SETTLEMENTS_KEY) ?? [],
  );
  // Never seeded from the cache: a copy from before a reset would file a pile under last week.
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>(seededParties ? "loaded" : "loading");

  // A run in the night links to its party, which draws its seats. See lib/seat-sprites.ts.
  useSeatSprites(nightParties);
  // A run opens to the drop picker, which draws them. See lib/drop-icons.ts.
  useDropIcons(dropTables);

  // Ticks, row writes, and the runs written to this sitting. See lib/use-night-clears.ts.
  const { answered, keepInNight, isSaving, write, toggleClear } = useNightClears(
    getToken,
    setParties,
  );

  // The budget preset and the plan tab are kept in the URL, so a reload lands on the same night.
  // See lib/url-state.ts. `plan` is "full" or a boss count, never a tab's position: the tabs are
  // recomputed on the way back in, and a position would name whichever one landed there.
  const search = useQueryString();
  const [chosenDuration, setChosenDuration] = useState<number | null>(null);
  const duration = chosenDuration ?? Number(queryParam(search, "for", PRESETS.map(String)) ?? 120);
  function setDuration(next: number) {
    setChosenDuration(next);
    replaceQuery({ for: next === 120 ? null : String(next) });
  }
  const [openOnly, setOpenOnly] = useState(true);
  // Whether a run has to seat everyone who is on, kept across visits: how you plan, not something
  // about tonight. Same reasoning as `timed` below. See lib/everyone-on.ts.
  const [everyoneOn, setEveryoneOn] = useEveryoneOn();
  // Who is off, kept across visits. The same handful of people are away most weeks, and unticking
  // them again every visit is the sort of setup that gets skipped, which plans a night around
  // somebody who is not there. See lib/who-is-on.ts.
  const [away, setAway] = useWhoIsOn();
  // The chosen plan tab, by its boss count. Null is the full plan.
  const [chosen, setChosen] = useState<number | null>(null);
  function choosePlan(bosses: number) {
    setChosen(bosses);
    replaceQuery({ plan: String(bosses) });
  }

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

  useEffect(() => {
    // Not before Clerk answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    let live = true;
    // One token for the burst. getToken() can round-trip to auth, and paying that per request is
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
          // Optional for the same reason: it feeds the stack boxes, and a night
          // still tells you what to run without it.
          apiFetch<PartyLootPool[]>(POOLS_KEY, { method: "GET" }, withToken).catch(() => null),
          // Optional, both, and only for the coupon balance the stack boxes open on. Losing either
          // opens them on the even split instead of on whoever is furthest behind.
          apiFetch<Party[]>(LEDGER_PARTIES_KEY, { method: "GET" }, withToken).catch(() => null),
          apiFetch<VestigeSettlement[]>(SETTLEMENTS_KEY, { method: "GET" }, withToken).catch(
            () => null,
          ),
          // Optional: losing it costs the picker its Eternal pieces and nothing else.
          apiFetch<BossClearsView>(CLEARS_KEY, { method: "GET" }, withToken).catch(() => null),
          // Optional: losing it loses the parties you are in, and keeps your own.
          apiFetch<SeatedParty[]>(SEATED_KEY, { method: "GET" }, withToken).catch(() => null),
        ]);
      })
      .then(
        ([
          nextParties,
          nextBosses,
          nextDrops,
          nextPools,
          nextLedger,
          nextSettlements,
          clears,
          nextSeated,
        ]) => {
          if (!live) return;
          if (nextSeated) {
            setSeated(nextSeated.filter((row) => row.party));
            put(SEATED_KEY, nextSeated);
          }
          if (clears) setWeekStart(clears.currentWeekStart);
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
          if (nextLedger) {
            setLedgerParties(nextLedger);
            put(LEDGER_PARTIES_KEY, nextLedger);
          }
          if (nextSettlements) {
            setSettlements(nextSettlements);
            put(SETTLEMENTS_KEY, nextSettlements);
          }
          setState("loaded");
          reportDataReady();
        },
      )
      .catch(() => {
        // Signed out lands here too, and that is not a failure: it is the standalone tool. The
        // parties tab says so and offers the other one.
        if (live) setState((current) => (current === "loaded" ? "loaded" : "error"));
      });
    return () => {
      live = false;
    };
  }, [getToken, isLoaded]);

  /**
   * Both lists a logged drop moves: the counts on each config, and the pools the stack boxes are
   * read off.
   *
   * The pools matter on this page in particular, because it is where a whole night is logged one
   * run after another: without this, the second run's boxes would open on a balance taken before
   * the first run's coupons were picked up.
   */
  async function refetchAfterDrop() {
    const [refreshed, poolResult] = await Promise.all([
      apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, getToken),
      apiFetch<PartyLootPool[]>(POOLS_KEY, { method: "GET" }, getToken),
      refetchSeated(),
    ]);
    setParties(refreshed);
    put(PARTIES_KEY, refreshed);
    setPools(poolResult);
    put(POOLS_KEY, poolResult);
  }

  /** The parties you are in, read again. A failure keeps the ones on screen. */
  async function refetchSeated() {
    const next = await apiFetch<SeatedParty[]>(SEATED_KEY, { method: "GET" }, getToken).catch(
      () => null,
    );
    if (!next) return;
    setSeated(next.filter((row) => row.party));
    put(SEATED_KEY, next);
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
      await readBack(refetchAfterDrop);
    });
  }

  /**
   * The party's standing coupon split, saved from the run's own picker.
   *
   * The whole config goes back, because that is what PUT /api/parties/{id} takes, and every other
   * field is passed through as it stands. Seats are named by CHARACTER NAME: the body names them
   * that way, since a party being created has no seat ids yet.
   *
   * Not pinned into the night: a split is the standing deal and says nothing about whether the boss
   * was run. Throws on failure, which is what lets the boxes show the server's reason.
   */
  async function saveShares(party: Party, shares: Map<string, number>) {
    const byName = new Map(party.members.map((member) => [member.id, member.name]));
    const named: Record<string, number> = {};
    for (const [seatId, count] of shares) {
      const name = byName.get(seatId);
      if (name) named[name] = count;
    }
    await write(party.id, async () => {
      await apiFetch<Party>(
        `${PARTIES_KEY}/${party.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            characterId: party.characterId,
            bossKey: party.bossKey,
            members: party.members
              .filter((member) => member.characterId !== party.characterId)
              .map((member) => member.name),
            difficulty: party.difficulty,
            minutes: party.minutes,
            shares: named,
          } satisfies SavePartyBody),
        },
        getToken,
      );
      // Both lists: the night's, which is what the plan is drawn from, and the ledger's, which the
      // stack boxes rotate against. A split saved here moves what each seat is entitled to, so a
      // ledger left stale would suggest the next pickup against the old deal.
      const [refreshed, ledger] = await Promise.all([
        apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, getToken),
        apiFetch<Party[]>(LEDGER_PARTIES_KEY, { method: "GET" }, getToken),
      ]);
      setParties(refreshed);
      put(PARTIES_KEY, refreshed);
      setLedgerParties(ledger);
      put(LEDGER_PARTIES_KEY, ledger);
    });
  }

  // A boss taken off this period is out of the night whatever the toggle says. "Only bosses not
  // cleared" is a narrowing you can turn off to see the rest; "we are not running it" is not one of
  // those, and a plan that scheduled it anyway would be a night built around a boss Party View has
  // already dropped.
  const running = useMemo(() => runningThisPeriod(nightParties), [nightParties]);

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

  // Only people with a chip are planned for. Somebody with one character gets none, and their seats
  // are left out of every run. Counted over the whole period so a filter cannot move who is in.
  const switchers = useMemo(
    () => new Set(rosterOfSwitchers(running).map((person) => person.id)),
    [running],
  );

  const roster: NightPerson[] = useMemo(
    () => rosterFrom(usable).filter((person) => switchers.has(person.id)),
    [usable, switchers],
  );

  const runs = useMemo(
    () => runsFromParties(usable, bosses, switchers),
    [usable, bosses, switchers],
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
    () => ({ budget, openOnly, everyoneOn, away, startAt, windows, timed }),
    [budget, openOnly, everyoneOn, away, startAt, windows, timed],
  );

  // What the button compares against. See lib/run-order-submit.ts for why it is a key.
  const key = useMemo(
    () =>
      controlsKey({
        openOnly,
        everyoneOn,
        timed,
        away,
        windows,
        startText,
        endText,
        duration,
      }),
    [openOnly, everyoneOn, timed, away, windows, startText, endText, duration],
  );

  const [asked, setAsked] = useState<{ inputs: typeof inputs; key: string } | null>(null);
  // Deferred so the press itself lands on the tick it is made. planNight is a beam search, and a
  // night of a dozen bosses is long enough to be felt between the click and the button answering.
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
    replaceQuery({ plan: "full" });
  }

  // A reload with a plan in the URL shows it again, adjusted during render as in PageSwap. Not
  // before the clock is read: the night starts from it, and the prerender has none.
  const [restored, setRestored] = useState(false);
  if (!restored && now !== null) {
    setRestored(true);
    const planned = new URLSearchParams(search).get("plan");
    if (planned !== null) {
      setAsked({ inputs, key });
      const bosses = Number(planned);
      setChosen(Number.isInteger(bosses) && bosses > 0 ? bosses : null);
    }
  }

  // The same two lists again, from the night that was asked for. Not shared with the live ones
  // above: those describe the controls, and these are what the plan is, so a filter ticked after
  // the plan was drawn must move one and not the other.
  const plannedParties = useMemo(
    () => (shown.openOnly ? stillToRun(running, answered) : running),
    [running, shown.openOnly, answered],
  );

  const plannedRuns = useMemo(
    () => runsFromParties(plannedParties, bosses, switchers),
    [plannedParties, bosses, switchers],
  );

  // The search plans every config on the period, cleared or not, and the cleared ones are hidden
  // from what it returns. See withoutRuns for why.
  const hidden = useMemo(() => {
    const shownIds = new Set(plannedParties.map((party) => party.id));
    return new Set(running.filter((party) => !shownIds.has(party.id)).map((party) => party.id));
  }, [running, plannedParties]);
  const allRuns = useMemo(
    () => runsFromParties(running, bosses, switchers),
    [running, bosses, switchers],
  );

  // Who is on, as people and as ids. The grid puts a column per person, so it needs the names and
  // the order, not just the set the screening asks for.
  const onTonight = useMemo(() => {
    return rosterFrom(plannedParties).filter(
      (person) => switchers.has(person.id) && !shown.away.includes(person.id),
    );
  }, [plannedParties, shown.away, switchers]);
  const here = useMemo(() => onTonight.map((person) => person.id), [onTonight]);
  // Everyone in a hidden run too, or their runs would be refused and drop out of the search.
  const hereAll = useMemo(
    () =>
      rosterFrom(running)
        .filter((person) => switchers.has(person.id) && !shown.away.includes(person.id))
        .map((person) => person.id),
    [running, shown.away, switchers],
  );

  // The eligible half is the plan. Nothing until the night has been asked for, which is what keeps
  // the search, the plan and "Left Out" all empty rather than each needing its own gate.
  const screening = useMemo(
    () =>
      planning
        ? screenRuns(allRuns, hereAll, { everyoneOn: shown.everyoneOn, everyone: here })
        : { eligible: NO_RUNS, rejected: [] },
    [planning, allRuns, hereAll, here, shown.everyoneOn],
  );
  const searched = screening.eligible;
  const eligible = useMemo(() => searched.filter((run) => !hidden.has(run.id)), [searched, hidden]);

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
      if (!switchers.has(id)) continue;
      const from = parseOffset(window.from);
      const until = parseOffset(window.until);
      const said: Availability = {};
      if (from !== null) said.from = spanBetween(shown.startAt, from);
      if (until !== null) said.until = spanBetween(shown.startAt, until);
      if (said.from !== undefined || said.until !== undefined) byPerson[id] = said;
    }
    return byPerson;
  }, [shown.windows, shown.startAt, shown.timed, switchers]);

  // What the night is allowed to take. Nothing, when it is not being run to the clock: the point of
  // that mode is that the length is not the question, so every boss that can be run is in the plan
  // and none is dropped for a reason the page is no longer showing.
  const night = shown.timed ? shown.budget : Infinity;

  const byCount = useMemo(() => {
    // The hidden runs take no time tonight, so the search gets their minutes back on top.
    let hiddenMinutes = 0;
    for (const run of searched) if (hidden.has(run.id)) hiddenMinutes += run.minutes;
    const full = planNight(searched, {
      minutes: night + hiddenMinutes,
      available,
      prefer: shown.everyoneOn
        ? preferredOrder(allRuns, hereAll, hidden, night, available)
        : undefined,
    });
    return withoutRunsByCount(full.byCount, hidden, { minutes: night, available });
  }, [searched, hidden, night, available, shown.everyoneOn, allRuns, hereAll]);
  const best = byCount[byCount.length - 1] ?? EMPTY_PLAN;

  const options = useMemo(() => tradeOffs(byCount), [byCount]);
  // A count no option has falls back to the full plan.
  const plan = (chosen !== null && options.find((o) => o.runs.length === chosen)) || best;

  // A clear moving on any party tonight, yours or one you are in, is on the plan without a reload.
  // The runs already on screen are kept in the night first, as a tick from here keeps its run (see
  // stillToRun): a clear arriving from the party's owner marks a run done, it does not take it away.
  useLive(["clears", "party", "loot"], () => {
    plan.runs.forEach((planned) => keepInNight(planned.run.id));
    void apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, getToken)
      .then((next) => {
        setParties(next);
        put(PARTIES_KEY, next);
      })
      .catch(() => {});
    void refetchSeated();
    void apiFetch<PartyLootPool[]>(POOLS_KEY, { method: "GET" }, getToken)
      .then((next) => {
        setPools(next);
        put(POOLS_KEY, next);
      })
      .catch(() => {});
  });

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
   * How far ahead or behind each holder is across every coupon night already answered, so the odd
   * stack rotates instead of landing on the same person every week.
   *
   * Account-wide and net of what has been settled, which is Party View's reckoning: the two screens
   * both open the same boxes, and a different suggestion on each is one night answered two ways. A
   * closed debt was compensated, and would otherwise suggest against its holder for ever. See V52.
   *
   * Empty where either list failed to load, which opens the boxes on the balanced split. A worse
   * first guess, never a stored one: nothing is written until the button is pressed.
   */
  const behind = useMemo(() => {
    const bossOrder = new Map(bosses.map((boss, i) => [boss.bossKey, i]));
    const closed = closedByHolder(settlements).closed;
    return runningBalance(stillOpen(outstanding(ledgerParties, pools, VESTIGE, bossOrder), closed));
  }, [bosses, ledgerParties, pools, settlements]);

  /**
   * The two coupon blocks this run's picker carries: what each seat is entitled to each week, and
   * who picked up which stacks of the night being logged.
   *
   * Off the CATALOG rather than off a logged drop, which is what makes them answerable HERE: the
   * drop does not exist until this form creates one, and the pickup goes out with it in the same
   * request. Undefined where there is nothing to divide, which is most bosses.
   */
  const stacksFor = (party: Party): StackDraft | undefined => {
    const config = shareConfig(
      dropTables[party.bossKey],
      modeThisWeek(party),
      party.worldType,
      VESTIGE,
      party.members,
    );
    if (!config) return undefined;
    return {
      dropKey: VESTIGE,
      config,
      party,
      behind,
      pickupTitle: "Looted this week",
      entitledTitle: "Entitled each week",
      // The split is the owner's deal, so a party you are only in shows it without a Save.
      onSaveShares:
        party.yours === false
          ? undefined
          : (shares: Map<string, number>) => saveShares(party, shares),
    };
  };

  // Re-read after every write that could re-file a pile: a tick, a drop, a roster.
  const { piecePileFor } = usePiecePiles({
    getToken,
    isLoaded,
    week: null,
    weekStart,
    bosses,
    reload: [parties],
  });

  const log: RunLog = {
    partyOf: (runId) => partyById.get(runId),
    dropTable: (bossKey) => dropTables[bossKey],
    busy: isSaving,
    onToggleClear: toggleClear,
    onAddDrop: haveDropTables ? addDrop : undefined,
    stacksOf: haveDropTables ? stacksFor : undefined,
    pieceOf: piecePileFor,
  };

  const left = plan.runs.filter((planned) => partyById.get(planned.run.id)?.cleared !== true);
  const cleared = plan.runs.length - left.length;
  // The runs' own minutes, so a wait for somebody late or a gap before the night starts is not
  // counted as time a clear takes.
  const minutesLeft = left.reduce((sum, planned) => sum + planned.run.minutes, 0);

  return (
    <main className="page">
      <h1 className="page-title">Run Order</h1>

      {/* The class is on the hint, not the <main>: this page draws most of itself without waiting
          for anything, and hiding all of it to cover one line would blank the controls too. */}
      {state === "loading" && <p className="party-hint page-waiting">Loading your parties...</p>}

      {state === "error" && (
        <p className="finder-empty">Couldn&apos;t load your parties. Reload to try again.</p>
      )}

      {state === "loaded" && nightParties.length === 0 && (
        <p className="finder-empty">
          No parties yet. <Link href="/bosses/parties/edit">Set one up.</Link>
        </p>
      )}

      {/* The filter sits with the parties it narrows, not down in the budget section, because it
          is the only way back out of the state where it has excluded everything. Under a heading
          the plan renders it left a cleared week with a blank page and no control on it. */}
      {state === "loaded" && nightParties.length > 0 && (
        <label className="night-toggle">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
          />
          <span>Only bosses not cleared this period</span>
        </label>
      )}

      {/* Counted over the parties still ON the period: counting every
          config would call a boss taken off by hand a boss that is cleared, which is a different
          answer to "why is there nothing to run". */}
      {state === "loaded" && nightParties.length > 0 && runs.length === 0 && (
        <p className="finder-empty">
          {running.length === 0
            ? "Every boss is off this period."
            : usable.length > 0
              ? "Nobody in these parties plays a second character."
              : running.length === 1
                ? "Your party is cleared this period."
                : `All ${running.length} parties are cleared this period.`}
        </p>
      )}

      {roster.length > 0 && (
        <section className="night-section">
          {/* Opposite the heading, not among the chips: a chip is an attendance switch, so a link
              standing in that row would read as one more person to toggle.

              The link sits with the roster rather than the page title because these are the names it
              is about, and Edit People is the page that says whose each character is. */}
          <div className="night-heading-row">
            <h2 className="night-heading">Party Members</h2>
            <Link className="party-cancel" href="/bosses/people">
              Edit People
            </Link>
          </div>
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
                    <span className="party-row-chevron" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Named off the roster rather than off `opened` alone: a row headed by nothing is worse
              than no row. */}
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

          {/* With the chips, because it is a rule about them, and because ticking it off is the
              only way back from a night where no party seats all of you. */}
          <label className="night-toggle">
            <input
              type="checkbox"
              checked={everyoneOn}
              onChange={(e) => setEveryoneOn(e.target.checked)}
            />
            <span>Exclude Party Member Subsets</span>
          </label>
        </section>
      )}

      {/* Everything the clock drives hangs off this one box: the window below, the windows people
          gave, and every time in the plan and in what gets pasted. Unticked it disables them rather
          than removing them, so the only thing that changes size is the plan. Two sections and a
          chevron per chip vanishing moved the whole page under the cursor that ticked it. */}
      {runs.length > 0 && (
        <label className="night-toggle">
          <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} />
          <span>Enable Time Configuration</span>
        </label>
      )}

      {runs.length > 0 && (
        <section className={timed ? "night-section" : "night-section night-off"}>
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
          {outdated ? "Update Run Order" : "Show Run Order"}
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
                  {shown.timed &&
                    minutesLeft > 0 &&
                    ` · ${formatDuration(minutesLeft).replace(/m$/, "min")} left`}
                </span>
              )}
            </div>
            {options.length > 1 && (
              <div className="basis-row" role="group" aria-label="Plans to choose between">
                {options.map((option) => (
                  <button
                    key={option.runs.length}
                    type="button"
                    className={plan === option ? "basis-tab active" : "basis-tab"}
                    aria-pressed={plan === option}
                    onClick={() => choosePlan(option.runs.length)}
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
              {`${assumed} ${assumed === 1 ? "run" : "runs"} assumed at ${formatDuration(DEFAULT_MINUTES)}.`}
            </p>
          )}
        </section>
      )}

      {/* The second is a claim about the clock, so it is not made where there is not one. Nothing
          untimed reaches it anyway: with nothing bounding the night, a run that can be staffed
          fits. */}
      {planning && plannedRuns.length > 0 && plan.runs.length === 0 && (
        <p className="finder-empty">
          {eligible.length === 0 && shown.everyoneOn
            ? "No parties available"
            : eligible.length === 0 || !shown.timed
              ? "No party has everyone it needs. Mark more people as free."
              : `Nothing fits in ${formatDuration(shown.budget)}. Add more time.`}
        </p>
      )}

      {/* Just "Left Out". Time is not the only thing that drops a run, so a heading that named one
          reason was wrong for the others, and no budget could fix what it blamed on the budget. */}
      {unscheduled.length > 0 && (
        <section className="night-section" aria-busy={stale}>
          <h2 className="night-heading">Left Out</h2>
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
