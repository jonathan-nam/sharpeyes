"use client";

import { PageSwap } from "@/components/page-swap";
import { useAuth } from "@/lib/use-auth";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AddForWeek } from "@/components/add-for-week";
import { KnownCharacters } from "@/components/known-characters";
import { PartyCard } from "@/components/party-card";
import { ResetTimer } from "@/components/reset-timer";
import { RosterStrip } from "@/components/roster-strip";
import { WeekStepper } from "@/components/week-stepper";
import {
  ApiError,
  SAVED_BUT_STALE,
  StaleAfterWrite,
  apiAssetUrl,
  apiFetch,
  readBack,
  spriteUrl,
} from "@/lib/api";
import { cellState, clearOfCell, indexClears } from "@/lib/boss-clears";
import { SharedParties } from "@/components/shared-parties";
import { yourClear } from "@/lib/shared-parties";
import { bossLabel, difficultyLabel } from "@/lib/boss-difficulty";
import { peek, put, storedAt } from "@/lib/cache";
import { reportDataReady } from "@/lib/rum";
import { buildDropLog, couponsOutstandingByParty, pieceStatusByParty } from "@/lib/drop-log";
import { dropsInWeek, NOTHING_OUTSTANDING } from "@/lib/loot";
import { closedByHolder, outstanding, runningBalance, stillOpen } from "@/lib/vestige-ledger";
import { assignableDrops } from "@/lib/vestige-pickup";
import { behindByHolder, rotatingDrops, rotationFor } from "@/lib/loot-rotation";
import { shareConfig } from "@/lib/vestige-stacks";
import {
  byBoss,
  byCharacter,
  type ClearFilter,
  consolidate,
  existedInWeek,
  filterByClear,
  knownCharacterNames,
  runningThisPeriod,
} from "@/lib/parties";
import { preloadBossArt } from "@/lib/preload-boss-art";
import { type CrossedReset, WEEKLY_CADENCE } from "@/lib/reset-countdown";
import { useDropIcons } from "@/lib/drop-icons";
import { useSeatSprites } from "@/lib/seat-sprites";
import { OtherWorld } from "@/components/other-world";
import { useRowWrites } from "@/lib/use-row-writes";
import type { Boss, BossClearsView } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { AddLootBody, PartyLootPool, SellLootBody } from "@/types/loot";
import type { PartiesExtras, PartiesPage } from "@/types/parties-page";
import type { VestigeSettlement } from "@/types/vestige";
import type {
  Party,
  Person,
  SavePartyBody,
  SaveWeekRosterBody,
  SeatedParty,
  SetPartySkipBody,
} from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

// The same configs, read three ways, and none of them hides anything.
//   character   what does this character owe the week, a row per boss
//   boss        who am I doing Kalos with tonight
//   party       filed by ARRANGEMENT: a duo with the same person across three bosses is one
//               section, the roster in its banner and a row per boss under it
type Grouping = "character" | "boss" | "party";

// Party View's two reads, in place of the nine requests this page used to make on load. Two
// rather than one because six of those nine were allowed to fail: see types/parties-page.ts.
const PAGE_KEY = "/api/pages/parties";
const EXTRAS_KEY = "/api/pages/parties/extras";

// The resource, for the writes below. What this page READS is PARTY_LIST_KEY.
const PARTIES_KEY = "/api/parties";
// Every config, because the coupons figure is a LEDGER and a debt cancels against the other nights
// with the same person. A retired config or a solo pool left out moves the figure on the standing
// rows, and buildDropLog cannot tell a pool it was handed no config for from one that is square.
// What the page DRAWS is filtered back down: see `parties`. Same key as the Drop Log, so the badge
// and the log cannot disagree. See partiesFor.
const PARTY_LIST_KEY = "/api/parties?solo=include&retired=include";
const BOSSES_KEY = "/api/bosses";
// The parties somebody ELSE owns that a character of yours sits in. See SeatedParties.kt.
const SEATED_KEY = "/api/parties/seated";
const CHARACTERS_KEY = "/api/characters";
// Whose character is whose, for the roster editor's datalist. Same key as the edit page, so the
// two share one cached copy and offer the same spellings.
const PEOPLE_KEY = "/api/people";
// The countdown, the week being shown, AND the clears for a past week. On the live view a config
// carries its own answer (party.cleared) and that is what is drawn; only a history view reads the
// clears out of here, because /api/parties can only ever answer for the period it is in.
const CLEARS_KEY = "/api/bosses/clears";
// The whole catalog's drop tables, so a row can open its picker without a round-trip. Same key as
// the party page, so the two share one cached copy.
const DROPS_KEY = "/api/bosses/drops";
// Every pool, for the coupons-owed figure on a row. Same key as the Drop Log, so the two share one
// cached copy and cannot disagree about what is owed.
const POOLS_KEY = "/api/parties/loot";
const SETTLEMENTS_KEY = "/api/vestige-settlements";

// The stacking drop the stack boxes under a boss row are for. One key, because one item behaves
// this way: a boss drops it in bundles that do not divide by looting alone. See lib/piece-ledger.ts.
const VESTIGE = "vestige-of-erion";

// Both lists take the week. The clears draw a past week's ticks, and the party list carries that
// week's drop counts, so the badge beside a tick answers for the same week the tick does.
//
// Only the live view is cached. A past week is a deliberate click and worth a round-trip, and
// caching every week stepped through would grow without bound. Same reasoning as the boss page.
const clearsUrl = (week: string | null) => (week ? `${CLEARS_KEY}?week=${week}` : CLEARS_KEY);
const partiesUrl = (week: string | null) =>
  week ? `${PARTY_LIST_KEY}&week=${week}` : PARTY_LIST_KEY;

// Rows are keyed by their config's id while they save. The one-off form is not a row, so it takes a
// name of its own: it is one more thing that can be mid-save. See lib/use-row-writes.ts.
const ADD_FOR_WEEK = "add-for-week";

export default function PartiesPage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken, isLoaded } = useAuth();

  const seededParties = peek<Party[]>(PARTY_LIST_KEY);
  const seededBosses = peek<Boss[]>(BOSSES_KEY);
  const seededCharacters = peek<Character[]>(CHARACTERS_KEY);

  const [everyParty, setEveryParty] = useState<Party[]>(seededParties ?? []);
  const [bosses, setBosses] = useState<Boss[]>(seededBosses ?? []);
  const [seated, setSeated] = useState<SeatedParty[]>(peek<SeatedParty[]>(SEATED_KEY) ?? []);
  const [characters, setCharacters] = useState<Character[]>(seededCharacters ?? []);
  const [dropTables, setDropTables] = useState<DropTables>(peek<DropTables>(DROPS_KEY) ?? {});
  const [people, setPeople] = useState<Person[]>(peek<Person[]>(PEOPLE_KEY) ?? []);
  const [pools, setPools] = useState<PartyLootPool[]>(peek<PartyLootPool[]>(POOLS_KEY) ?? []);
  const [settlements, setSettlements] = useState<VestigeSettlement[]>(
    peek<VestigeSettlement[]>(SETTLEMENTS_KEY) ?? [],
  );
  const [state, setState] = useState<LoadState>(
    seededParties && seededBosses && seededCharacters ? "loaded" : "loading",
  );
  const [grouping, setGrouping] = useState<Grouping>("character");
  const [clearFilter, setClearFilter] = useState<ClearFilter>("all");
  // Per row, so a tick on one boss does not grey out every other row's controls. One write at a
  // time still, because each one refetches the list. See lib/use-row-writes.ts.
  const { isSaving, write } = useRowWrites();
  const [view, setView] = useState<BossClearsView | null>(peek<BossClearsView>(CLEARS_KEY) ?? null);
  // When the view was received, so the countdown can correct for a browser clock that disagrees
  // with the server's. A seeded view arrived with the request that cached it, not now: see
  // storedAt in lib/cache.ts, and lib/reset-countdown.ts.
  const [receivedAt, setReceivedAt] = useState<number>(() => storedAt(CLEARS_KEY) ?? Date.now());
  // null is the live view. Anything else is a past week, read-only.
  const [week, setWeek] = useState<string | null>(null);
  const [stepping, setStepping] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Why the last write to a pool did not land, and whose. Carried with the party's id so the row
  // that failed is the row that says so, rather than every open panel on the page.
  const [poolError, setPoolError] = useState<{ partyId: string; message: string } | null>(null);
  // What this page is: the arrangements on this week. A solo pool is a pool rather than a party, and
  // a retired config is a boss this character no longer runs, so neither is a row here. Every figure
  // read as a ledger takes `everyParty` instead, because a debt does not stop being owed for having
  // been arranged on a config that has since come off the list. See V33__party_standing.sql.
  const parties = everyParty.filter((p) => !p.solo && !p.retired);
  // The seats are drawn on the party page, which is a click from here. See lib/seat-sprites.ts.
  useSeatSprites(parties);
  // The drop icons are drawn by the picker in a row's panel, a chevron from here. Same idea, and
  // see lib/drop-icons.ts for why it warms differently.
  useDropIcons(dropTables);

  // Stepping twice quickly fires two requests that can land in either order. Only the newest may
  // write state, or the list ends up showing a week the label disagrees with. Same guard as the
  // boss page, and one ticket for both lists so they cannot land out of step with each other.
  const latestWeek = useRef(0);

  /**
   * The week's two lists, under one ticket.
   *
   * Answers whether the week label may move, as the boss page's loader does: a response overtaken
   * by a newer step must move neither the label nor the lists.
   *
   * `clearsOptional` is the first load alone. Losing the clears there costs the stepper and the
   * countdown and nothing else, and blanking the party list over that says less than leaving it up.
   * A step is both or neither: badges from one week under a label from another is exactly the
   * confidently wrong screen this guard exists to prevent.
   */
  async function loadWeek(
    target: string | null,
    opts: { token?: string | null; clearsOptional?: boolean } = {},
  ): Promise<boolean> {
    const { token, clearsOptional } = opts;
    const auth = token !== undefined ? () => Promise.resolve(token) : getToken;
    const ticket = ++latestWeek.current;
    const clearsRequest = apiFetch<BossClearsView>(clearsUrl(target), { method: "GET" }, auth);
    const [clears, partyList] = await Promise.all([
      clearsOptional ? clearsRequest.catch(() => null) : clearsRequest,
      apiFetch<Party[]>(partiesUrl(target), { method: "GET" }, auth),
    ]);
    if (ticket !== latestWeek.current) return false;

    setEveryParty(partyList);
    if (target === null) {
      put(PARTY_LIST_KEY, partyList);
    }
    if (!clears) return false;
    setView(clears);
    setReceivedAt(Date.now());
    if (target === null) put(CLEARS_KEY, clears);
    return true;
  }

  async function selectWeek(target: string | null) {
    setStepping(true);
    try {
      if (await loadWeek(target)) setWeek(target);
    } catch {
      // Keep the week on screen. Moving the label without the lists behind it would label one
      // week's ticks and badges with another week's date.
    } finally {
      setStepping(false);
    }
  }

  /**
   * Picks the new period up when a reset passes under an open tab. See ResetTimer.
   *
   * A weekly reset takes the list back to the current week, the way the in-game planner comes back
   * cleared rather than still showing the week you had open. Every other cadence refreshes the
   * week on screen and leaves it there, since a daily boundary says nothing about that week.
   *
   * Both lists either way, because the page draws its ticks from whichever one the week calls for:
   * the live view reads party.cleared, a past week reads the clears. Refreshing one would leave
   * the other answering for the period that just ended.
   *
   * Which configs there are is untouched by a reset (the party table has no period). What changes
   * for them is the clear each one carries, back to "nobody has said anything yet", and the drop
   * counts, since a settled pool belongs to the week it settled in.
   */
  async function pickUpReset(crossed: CrossedReset) {
    const target = crossed.cadences.includes(WEEKLY_CADENCE) ? null : week;
    setStepping(true);
    try {
      if (await loadWeek(target)) setWeek(target);
    } catch {
      // The old list under a rolled-over week is wrong, but blanking the page says less than
      // leaving it up. The next visit or step reloads it.
    } finally {
      setStepping(false);
    }
  }

  useEffect(() => {
    // Not before auth answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    // A ticket like loadWeek's, taken here rather than borrowed by routing this load through it.
    // Opening the page and immediately stepping has to leave the week you asked for on screen, not
    // the current one landing late underneath its label.
    const ticket = ++latestWeek.current;
    // One token for both requests: getToken() can round-trip to auth, and two calls would pay it
    // twice.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<PartiesPage>(PAGE_KEY, { method: "GET" }, withToken),
          // Still allowed to fail, as all six of these were when they were six requests. Losing
          // them costs the drop picker, the roster editor's suggestions, a row's coupons figure
          // (and the correction that stops it counting a closed debt, see V52), and the section for
          // parties somebody else keeps the book for. Never the page. See types/parties-page.ts.
          apiFetch<PartiesExtras>(EXTRAS_KEY, { method: "GET" }, withToken).catch(() => null),
        ]);
      })
      .then(([page, extras]) => {
        // Whether a step overtook this load. The two week-dependent lists must not land under a
        // label for another week, which is what loadWeek's ticket guards and what this load used to
        // borrow by going through it. Everything else here is the same whatever week is shown.
        const current = ticket === latestWeek.current;

        if (current) {
          setEveryParty(page.parties);
          put(PARTY_LIST_KEY, page.parties);
        }
        setBosses(page.bosses);
        setCharacters(page.characters);
        put(BOSSES_KEY, page.bosses);
        put(CHARACTERS_KEY, page.characters);

        if (extras) {
          if (current) {
            setView(extras.clears);
            setReceivedAt(Date.now());
            put(CLEARS_KEY, extras.clears);
          }
          setDropTables(extras.drops);
          put(DROPS_KEY, extras.drops);
          setPeople(extras.people);
          put(PEOPLE_KEY, extras.people);
          setPools(extras.pools);
          put(POOLS_KEY, extras.pools);
          setSettlements(extras.settlements);
          put(SETTLEMENTS_KEY, extras.settlements);
          setSeated(extras.seated);
          put(SEATED_KEY, extras.seated);
        }
        setState("loaded");
        reportDataReady();
      })
      // Only blank the page if there is nothing to show: a failed refresh behind data we already
      // have should leave that data up.
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  /**
   * Ticks a boss cleared, or un-ticks it.
   *
   * Writes boss_clear, the same row the Individual View matrix reads and a planner capture
   * overwrites, so the two pages cannot drift. Refetched rather than patched in place: the server
   * decides which period the tick landed in.
   */
  async function toggleClear(party: Party, cleared: boolean) {
    try {
      await write(party.id, async () => {
        await apiFetch<Party>(
          `${PARTIES_KEY}/${party.id}/clear`,
          { method: "PUT", body: JSON.stringify({ cleared }) },
          getToken,
        );
        const refreshed = await apiFetch<Party[]>(PARTY_LIST_KEY, { method: "GET" }, getToken);
        setEveryParty(refreshed);
        put(PARTY_LIST_KEY, refreshed);
      });
    } catch {
      // Leaving the old state up beats showing a tick that did not save.
    }
  }

  /**
   * Changes how this party splits its coupons, tonight's included.
   *
   * Through the party's own save, which is the one route that writes a standing share, so the
   * server pins the weeks this is not the deal for before the new value lands: the ones that are
   * over, and the ones a sale has already been paid on. See pinWeeksAlreadyWritten, which keys that
   * off the BOSS's period and is the only thing that decides it. Without it, a new deal re-divides
   * July's outstanding coupons and tells nobody.
   *
   * Keyed by NAME because that is what SavePartyBody takes, and it carries the party's existing
   * difficulty, minutes and looter: the route writes all of them, so sending the shares alone would
   * quietly clear the rest.
   */
  async function saveShares(party: Party, shares: Map<string, number>) {
    const byName = new Map(party.members.map((m) => [m.id, m.name]));
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
              .filter((m) => m.characterId !== party.characterId)
              .map((m) => m.name),
            difficulty: party.difficulty,
            minutes: party.minutes,
            looterName: party.seats.find((s) => s.id === party.looterMemberId)?.name ?? null,
            shares: named,
          } satisfies SavePartyBody),
        },
        getToken,
      );
      // Both lists: the shares are on the party, and every pool row's entitlement is read against
      // them, so a pool left stale would draw the old split under the new one.
      const refreshed = await apiFetch<Party[]>(PARTY_LIST_KEY, { method: "GET" }, getToken);
      setEveryParty(refreshed);
      put(PARTY_LIST_KEY, refreshed);
      await refreshPools();
    });
  }

  /**
   * Sets who ran THIS week, or puts the week back to the usual party with null.
   *
   * Not the config's own roster: that is the edit page's, and changing it here would rewrite every
   * week rather than the one on screen. The week is left off the body on purpose, so the server's
   * clock decides which one this is.
   *
   * Live view only, so PARTY_LIST_KEY is the right list to refetch. Throws on failure, which is what
   * lets the row show the server's reason.
   */
  async function saveRoster(party: Party, members: string[] | null) {
    await write(party.id, async () => {
      await apiFetch<Party>(
        `${PARTIES_KEY}/${party.id}/roster`,
        { method: "PUT", body: JSON.stringify({ members } satisfies SaveWeekRosterBody) },
        getToken,
      );
      const refreshed = await apiFetch<Party[]>(PARTY_LIST_KEY, { method: "GET" }, getToken);
      setEveryParty(refreshed);
      put(PARTY_LIST_KEY, refreshed);
    });
  }

  /**
   * Takes a boss off this period, leaving the config alone.
   *
   * A week off is not the party ending, so nothing is deleted: the seats, the pool and the standing
   * roster all survive it, and next period runs as usual without being told to. One direction only.
   * The row leaves the list and stays off until the reset.
   *
   * Live view only, so PARTY_LIST_KEY is the right list to refetch. Throws on failure, which is what
   * lets the row show it did not save.
   */
  async function takeOff(party: Party) {
    await write(party.id, async () => {
      // Not typed as a Party: taking a one-off off its period deletes it, and that answers 204 with
      // no config to send back. The list below is what redraws either way.
      await apiFetch<unknown>(
        `${PARTIES_KEY}/${party.id}/skip`,
        { method: "PUT", body: JSON.stringify({ skipped: true } satisfies SetPartySkipBody) },
        getToken,
      );
      const refreshed = await apiFetch<Party[]>(PARTY_LIST_KEY, { method: "GET" }, getToken);
      setEveryParty(refreshed);
      put(PARTY_LIST_KEY, refreshed);
    });
  }

  /**
   * Adds a boss for this period alone.
   *
   * A one-off, not a config: it is on the week you are looking at and gone from the next one with
   * nobody saying so. The server arms the config a spent one-off already left behind rather than
   * making a second one for the pair, so running the same boss again a month later lands in the
   * same pool.
   */
  async function addOneOff(body: SavePartyBody) {
    setAddError(null);
    try {
      await write(ADD_FOR_WEEK, async () => {
        await apiFetch<Party>(
          PARTIES_KEY,
          { method: "POST", body: JSON.stringify(body) },
          getToken,
        );
        const refreshed = await apiFetch<Party[]>(PARTY_LIST_KEY, { method: "GET" }, getToken);
        setEveryParty(refreshed);
        put(PARTY_LIST_KEY, refreshed);
      });
    } catch (e) {
      // The server's own reason. It is the only part of a refusal you can act on.
      setAddError(e instanceof ApiError ? e.body : "Couldn't add that boss.");
    }
  }

  /**
   * Both lists a pool write moves: the rows in the panel, and the counts the badge is read off.
   *
   * Refetched rather than patched in place, for the reason the party's own page gives: which of the
   * three counts a drop lands in, and what its status now is, are the server's to derive.
   *
   * Live view only, so PARTY_LIST_KEY is the right list to refetch and to cache. Both keys are the
   * same ones the Drop Log and the party page read, so a settled drop is settled everywhere at once.
   */
  async function refreshPools() {
    const [refreshed, poolResult] = await Promise.all([
      apiFetch<Party[]>(PARTY_LIST_KEY, { method: "GET" }, getToken),
      apiFetch<PartyLootPool[]>(POOLS_KEY, { method: "GET" }, getToken),
    ]);
    setEveryParty(refreshed);
    put(PARTY_LIST_KEY, refreshed);
    setPools(poolResult);
    put(POOLS_KEY, poolResult);
  }

  /**
   * Logs a drop from the row, without leaving the list.
   *
   * The pool it lands in is the party page's, the same POST that page makes, so a drop added here
   * and one added there are the same row.
   *
   * Throws on failure, which is what makes the row say so. The drop is in from the moment the POST
   * answers, so the refetch after it fails as a StaleAfterWrite and never as a failed add.
   */
  async function addDrop(party: Party, body: AddLootBody) {
    await write(party.id, async () => {
      await apiFetch<unknown>(
        `${PARTIES_KEY}/${party.id}/loot`,
        { method: "POST", body: JSON.stringify(body) },
        getToken,
      );
      await readBack(refreshPools);
    });
  }

  /**
   * One write against one drop, keyed by that drop so only its row dims.
   *
   * Every route here is the party page's own, so selling from this panel and selling from there are
   * one write and cannot come out differently. A refusal is kept with the party it was about.
   */
  async function writeDrop(party: Party, lootId: string, path: string, options: RequestInit) {
    setPoolError(null);
    try {
      await write(lootId, async () => {
        await apiFetch<unknown>(
          `${PARTIES_KEY}/${party.id}/loot/${lootId}${path}`,
          options,
          getToken,
        );
        // Past the write, so the same reading the party's own page makes: a refetch that fails is
        // a stale panel, not a sale that did not save. See StaleAfterWrite.
        await readBack(refreshPools);
      });
    } catch (e) {
      // The server's own reason. It is the only part of a refusal you can act on.
      setPoolError({
        partyId: party.id,
        message:
          e instanceof StaleAfterWrite
            ? SAVED_BUT_STALE
            : e instanceof ApiError
              ? e.body
              : "That didn't save.",
      });
    }
  }

  const characterById = new Map(characters.map((c) => [c.id, c]));
  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  // Coupons somebody else is holding for you, per party. Through the Drop Log's own entries so the
  // badge and the log cannot disagree about what you are owed, rather than counted again here.
  // Off the ledger's own notion of finished, not off the party's arrangement: `owedBy` is
  // `entitled - looted` and never moves, so without the closures this counted a debt forever. See V52.
  // NOT off the tranches. Selling their share turns a coupon debt into a meso one and the Sale
  // Ledger is the one place that nets it: subtracting it here too made a boss row's figure depend on
  // every other party. See couponsOutstandingByParty.
  const log = buildDropLog(everyParty, pools, dropTables, closedByHolder(settlements).closed);
  // Narrowed to the week on screen, the same way the panel below each row is. A row sits under a
  // heading about one week, so summing a season of runs into it answers a question nobody asked:
  // Hard Baldrix read "20 coupons owed" off a run ten days before the one being looked at.
  // `weekStart ?? currentWeekStart` is the week ON SCREEN, which is what weekLabel heads the page
  // with. currentWeekStart alone is the live one, and would answer for tonight under a heading
  // about a week in August.
  const couponsOut = couponsOutstandingByParty(
    log.entries,
    view ? (view.weekStart ?? view.currentWeekStart) : null,
  );
  // What each COUPON row in a panel says it is, off the same entries the badge above it is counted
  // from, so the two cannot disagree about a stack of vestiges.
  const pieceStatus = pieceStatusByParty(log.entries);
  const history = week !== null;

  // No tables, no picker. Offering one without them would list nothing and then explain the empty
  // list as "no drop table recorded for this boss", which is a statement about the catalog we
  // would not be in a position to make. The link into the party is still there either way.
  const haveDropTables = Object.keys(dropTables).length > 0;
  // Never on a past week: the server stamps a drop with today, so one added under last week's
  // label would land in a week this screen is not showing.
  const canAddDrops = !history && haveDropTables;
  const lootByParty = new Map(pools.map((pool) => [pool.partyId, pool.loot]));

  // How far ahead or behind each holder is across every night already answered, so the odd stack
  // rotates instead of landing on the same person every week. Only the drops still open count: a
  // debt that was closed was compensated, and would otherwise suggest against them forever. See V52.
  const closures = closedByHolder(settlements);
  const bossOrder = new Map(bosses.map((b, i) => [b.bossKey, i]));
  const behind = runningBalance(
    stillOpen(outstanding(everyParty, pools, VESTIGE, bossOrder), closures.closed),
  );

  /**
   * How this party splits the boss's coupons, and the write that changes it.
   *
   * Off the CATALOG, not off a logged drop: what the boss drops is a fact about the boss, so the
   * split can be agreed before the week's coupons have fallen and stays on screen in a week nobody
   * ran it.
   *
   * The live view only, the same rule the pool and the roster follow. A past week is shown and not
   * edited, and its share is now pinned anyway: see pinWeeksAlreadyWritten.
   */
  /**
   * Whose turn it is to loot the boss's Eternal pieces, or null where nothing rotates.
   *
   * Read, never written: the balance comes off the arrangements already recorded on this party's own
   * rows. Not shown on a past week, the same rule the split and the roster follow, because "this
   * week" says nothing when the week being looked at is over.
   *
   * One rotation, because a boss's token modes and its fragment modes do not overlap, so a party
   * running one mode sees one of them. rotatingDrops returns a list rather than picking, which is
   * what would hide the second the day that stops being true.
   */
  const rotationOf = (party: Party) => {
    if (history) return null;
    const drop = rotatingDrops(party, dropTables)[0];
    if (!drop) return null;
    const quantity = drop.pieces?.[party.worldType]?.[party.difficulty ?? ""] ?? 0;
    // The stacks it falls in, which is what a party can actually hand over. Absent is uncounted, and
    // rotationFor refuses it rather than assuming the drop divides down to the single piece.
    const bundles = drop.bundles?.[party.worldType]?.[party.difficulty ?? ""] ?? 0;
    return rotationFor(party, lootByParty.get(party.id) ?? [], drop, quantity, bundles);
  };

  const stacksFor = (party: Party) => {
    if (history) return undefined;
    const config = shareConfig(
      dropTables[party.bossKey],
      party.difficulty,
      party.worldType,
      VESTIGE,
      party.members,
    );
    if (!config) return undefined;
    return {
      // The deal, which is a standing fact about the party and not about any one night. The block's
      // only heading now: it used to sit under "Vestige of Erion Config", which headed the week's
      // coupons as well and read as though a drop that had fallen were a setting.
      entitledTitle: "Entitled each week",
      // What the Add Drop form matches its picked drop against, so it can offer the same two blocks
      // before the row exists and the panel can stand down while it does.
      dropKey: VESTIGE,
      config,
      behind,
      onSave: (shares: Map<string, number>) => saveShares(party, shares),
      // What actually got picked up, per night. Off the rows the panel is already showing, so the
      // boxes cannot cover a different set of drops from the ones above them.
      pickup: {
        title: "Looted this week",
        drops: assignableDrops(
          party,
          dropsInWeek(lootByParty.get(party.id) ?? [], view?.currentWeekStart ?? null),
          { dropKey: VESTIGE, tradeable: true, behind },
        ),
        // A settled night is history. The server refuses to rewrite one either way (see
        // settledAlready), so without this the boxes would open on a save that cannot land.
        locked: new Set(log.entries.filter((entry) => entry.closed).map((entry) => entry.lootId)),
        onSave: (lootId: string, bundles: Record<string, number>) =>
          writeDrop(party, lootId, "/bundles", {
            method: "PUT",
            body: JSON.stringify({ bundles }),
          }),
      },
    };
  };

  /**
   * Who picked up which stacks of the rotating piece, on this week's night of it.
   *
   * The write the rotation reads. Nothing else produces one: the Drop Ledger leaves pieces out
   * entirely, and the coupon's boxes only ever covered the coupon, so every rotation on the account
   * was drawn off zero answered weeks and broke its tie by seat order instead.
   *
   * Its own block rather than a second drop in `stacksFor`, which needs a coupon config and so has
   * none on Chaos Kalos or Normal Kaling, both of which rotate a piece.
   *
   * No `locked`: a settlement is a coupon's, and a piece has none to close.
   */
  const piecePickupFor = (party: Party) => {
    const rotation = rotationOf(party);
    if (!rotation) return undefined;
    return {
      title: "Looted this week",
      drops: assignableDrops(
        party,
        dropsInWeek(lootByParty.get(party.id) ?? [], view?.currentWeekStart ?? null),
        { dropKey: rotation.dropKey, tradeable: false, behind: behindByHolder(rotation) },
      ),
      onSave: (lootId: string, bundles: Record<string, number>) =>
        writeDrop(party, lootId, "/bundles", {
          method: "PUT",
          body: JSON.stringify({ bundles }),
        }),
    };
  };

  /**
   * What a row's panel draws its pool from, or nothing where it must not draw one.
   *
   * Both of canAddDrops' conditions apply again here, and the second is not incidental: isPieceDrop
   * reads the catalog's tables, so without them a stack of vestige coupons would be listed as an
   * ordinary drop with a sale button on it, which is the two-settlements-for-one-drop the piece
   * ledger exists to prevent. The week rule is in the card's own docs.
   *
   * One week's drops, not the pool: the row is about the week on screen, and the whole pool under it
   * was a season of drops headed by tonight. What that leaves out is on the party's own page, which
   * the row's heading and its badge both link to. See dropsInWeek.
   *
   * The week is the clears view's, which is the server's own reckoning and the same one every row's
   * weekStart was stamped with. Null while that view has not arrived, which shows the pool whole
   * rather than narrowing it against a week nothing has named yet.
   */
  const poolFor = (party: Party) => {
    return canAddDrops
      ? {
          loot: dropsInWeek(lootByParty.get(party.id) ?? [], view?.currentWeekStart ?? null),
          dropTables,
          bossByKey,
          pieceStatus: pieceStatus.get(party.id),
          error: poolError?.partyId === party.id ? poolError.message : null,
          isSaving,
          onSell: (lootId: string, body: SellLootBody) =>
            writeDrop(party, lootId, "/sale", { method: "PUT", body: JSON.stringify(body) }),
          onUnsell: (lootId: string) => writeDrop(party, lootId, "/sale", { method: "DELETE" }),
          onSetTaken: (lootId: string, memberId: string | null) =>
            writeDrop(party, lootId, "/taken", {
              method: "PUT",
              body: JSON.stringify({ memberId }),
            }),
          onSetPaid: (lootId: string, memberId: string, paid: boolean) =>
            writeDrop(party, lootId, `/payouts/${memberId}`, {
              method: "PUT",
              body: JSON.stringify({ paid }),
            }),
          onDelete: (lootId: string) => writeDrop(party, lootId, "", { method: "DELETE" }),
        }
      : undefined;
  };

  // The names already spelled somewhere, for the editor's datalist. Built from what the page has:
  // people is optional, and its absence costs suggestions rather than the editor.
  const knownCharacters = knownCharacterNames(characters, people, parties);

  // Two rules narrow a past week, counted apart so the empty line can name the one that applies.
  //
  // Cadence first: the server returns weekly rows alone for a history view, so a monthly config in
  // a past week has no row and would draw as "not reported" when the truth is that nobody asked.
  // Dropping those configs is what the matrix does with its monthly and daily bands.
  const weekly = history
    ? parties.filter((p) => bossByKey.get(p.bossKey)?.reset === WEEKLY_CADENCE)
    : parties;
  // Then age, which is existedInWeek's job: today's configs are not last week's parties.
  const shown = week !== null ? existedInWeek(weekly, week) : weekly;
  const hiddenByCadence = parties.length - weekly.length;
  const hiddenByAge = weekly.length - shown.length;
  // Last, what was taken off this period by hand. Held apart from the two rules above because those
  // are about the week and this is about the boss: a config taken off is in the week, it is just not
  // being run in it. Everything below counts `running`, so a boss taken off is out of the tabs and
  // out of the group headings as well as out of the list.
  const running = runningThisPeriod(shown);

  // Either rule can empty a week, and naming the wrong one explains a correct screen wrongly. Only
  // for a week with nothing left in it: a week that still has a list says nothing about what it
  // narrowed, since the list IS the answer.
  const emptyWeekReason =
    hiddenByCadence === 0
      ? "They were all set up later."
      : hiddenByAge === 0
        ? "None are on a weekly boss."
        : "They were set up later, or are not on a weekly boss.";

  const clearsByCharacter = new Map(
    Object.entries(view?.clearsByCharacter ?? {}).map(([id, clears]) => [id, indexClears(clears)]),
  );

  /**
   * What this config's clear tick should say.
   *
   * On the live view that is the config's own answer, straight off /api/parties. On a past week it
   * has to come from the clears the stepper just fetched, because /api/parties only ever answers
   * for the period it is in: reading party.cleared there would label last week's row with this
   * week's state. `byHand` is false on a history view rather than guessed, since the clears
   * endpoint does not carry the provenance the config does.
   */
  function clearOf(party: Party): { cleared: boolean | null; byHand: boolean } {
    if (!history) return { cleared: party.cleared, byHand: party.clearedByHand };
    const state = cellState(clearsByCharacter.get(party.characterId), party.bossKey);
    return { cleared: clearOfCell(state), byHand: false };
  }

  // The clear the page is DRAWING, not the config's own, so the filter and the counts agree with
  // the ticks on a past week instead of narrowing by this week's state.
  const showsCleared = (party: Party) => clearOf(party).cleared === true;

  // Filtered by week first, then by clear state, then grouped, so all three groupings answer the
  // same question and a group with nothing left in it drops out rather than sitting there empty.
  const visible = filterByClear(running, clearFilter, showsCleared);
  const clearedCount = running.filter(showsCleared).length;
  const filterTabs: { value: ClearFilter; label: string; count: number; title?: string }[] = [
    { value: "all", label: "All", count: running.length },
    {
      value: "not-cleared",
      label: "Not Cleared",
      count: running.length - clearedCount,
      title: "Includes bosses no planner capture has mentioned this period",
    },
    { value: "cleared", label: "Cleared", count: clearedCount },
  ];

  const characterGroups = byCharacter(
    visible,
    characters.map((c) => c.id),
  );
  const bossGroups = byBoss(visible, bosses);
  const arrangements = consolidate(
    visible,
    characters.map((c) => c.id),
  );

  /**
   * One config as a row under a boss heading.
   *
   * Shared by the by-character and by-party lists, which ask different questions of the same rows:
   * both file a config under a boss, so both get the clear, the pool and the panel rather than one
   * of them getting a summary of them.
   */
  function bossRow(party: Party) {
    const boss = bossByKey.get(party.bossKey);
    return (
      <PartyCard
        key={party.id}
        party={party}
        busy={isSaving(party.id)}
        clear={clearOf(party)}
        coupons={couponsOut.get(party.id) ?? NOTHING_OUTSTANDING}
        onToggleClear={history ? undefined : (cleared) => toggleClear(party, cleared)}
        dropTable={dropTables[party.bossKey]}
        onAddDrop={canAddDrops ? (body) => addDrop(party, body) : undefined}
        pool={poolFor(party)}
        stacks={stacksFor(party)}
        rotation={rotationOf(party)}
        piecePickup={piecePickupFor(party)}
        onSaveRoster={history ? undefined : (members) => saveRoster(party, members)}
        onTakeOff={history ? undefined : () => takeOff(party)}
        heading={
          <>
            {boss?.iconUrl && (
              <img className="boss-portrait" src={apiAssetUrl(boss.iconUrl)} alt="" />
            )}
            <h3 className="party-row-name">
              {bossLabel(boss?.name ?? party.bossKey, party.difficulty)}
            </h3>
          </>
        }
      />
    );
  }

  return (
    <main className="page">
      {/* Beside the title, not among the tabs below: those pick what the list shows, so a link
          that leaves the page read as another one of them. */}
      <div className="page-head">
        <h1 className="page-title">Party View</h1>
        {state === "loaded" && (
          <span className="page-head-links">
            <Link className="party-cancel" href="/bosses/parties/edit">
              Edit Parties
            </Link>
          </span>
        )}
      </div>

      {state === "error" && <p>Couldn&apos;t load your parties.</p>}
      <PageSwap
        waiting={state === "loading"}
        placeholder={<p className="party-hint">Loading...</p>}
      >
        {state === "loaded" && (
          <>
            {/* Once for the page, not once per row: every roster editor points at this one id. */}
            <KnownCharacters names={knownCharacters} />
            {/* The same controls the Individual View carries, in the same order and the same row:
              the stepper on the left, the countdown on the right. The WeekStepper component
              itself, not a copy of its label, so the two pages cannot drift in wording, spacing
              or behaviour.

              Stepping refetches the clears and the ticks follow it, which is the only reason the
              arrows are allowed to be here: a label that moved while the ticks stayed on this
              week would be a confidently wrong screen. See clearOf(). */}
            {view && (
              <div className="boss-controls">
                <WeekStepper view={view} onSelect={selectWeek} busy={stepping} />
                <ResetTimer
                  nextResets={view.nextResets}
                  serverNow={view.now}
                  receivedAt={receivedAt}
                  onReset={pickUpReset}
                />
              </div>
            )}

            {/* Above every line about the list, the way the Drop Log's Add Drop is: the form is one
              thing and what the list is or is not showing is another.

              Live view only. The server writes a one-off into the period its own clock is in, so
              offering this under a past week's label would file the night in a week the screen is
              not showing. Same rule as the drop picker. */}
            {!history && characters.length > 0 && (
              <AddForWeek
                characters={characters}
                bosses={bosses}
                parties={parties}
                busy={isSaving(ADD_FOR_WEEK)}
                error={addError}
                onAdd={addOneOff}
              />
            )}

            <section className="party-filters">
              <h2 className="party-filters-title">Filter Options</h2>
              <div className="party-toolbar-tabs">
                <div className="basis-row" role="group" aria-label="Group parties by">
                  <button
                    type="button"
                    className={grouping === "character" ? "basis-tab active" : "basis-tab"}
                    onClick={() => setGrouping("character")}
                  >
                    By character
                  </button>
                  <button
                    type="button"
                    className={grouping === "boss" ? "basis-tab active" : "basis-tab"}
                    onClick={() => setGrouping("boss")}
                  >
                    By boss
                  </button>
                  <button
                    type="button"
                    className={grouping === "party" ? "basis-tab active" : "basis-tab"}
                    onClick={() => setGrouping("party")}
                  >
                    By party
                  </button>
                </div>

                {/* What is left this week, without reading past what is done. "Not Cleared" holds the
                  unreported ones too. The counts do not move when you switch tabs: they are of every
                  config being RUN in the week, which on the live view is all of them bar the ones
                  taken off and on a past week is the weekly ones. Counting past that would offer a tab
                  that lists less than it promises. */}
                <div
                  className="basis-row basis-row-end"
                  role="group"
                  aria-label="Filter by clear state"
                >
                  {filterTabs.map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      className={clearFilter === tab.value ? "basis-tab active" : "basis-tab"}
                      aria-pressed={clearFilter === tab.value}
                      title={tab.title}
                      onClick={() => setClearFilter(tab.value)}
                    >
                      {tab.label}
                      <span className="tab-count">{tab.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* "No parties YET" is about parties of your own, and a member of somebody else's has
                none by design: the section below is theirs. Saying it above that section read as
                the page contradicting itself. */}
            {parties.length === 0 && seated.length === 0 && (
              <>
                <p className="finder-empty">
                  No parties yet. <Link href="/bosses/parties/edit">Set them up</Link>: pick a
                  character, then say who they run each boss with.
                </p>
                {/* This list is one world's, so "no parties" can mean every party you have belongs
                    to characters in the other one. See OtherWorld. */}
                <OtherWorld />
              </>
            )}

            {/* Not "nothing cleared": that week's clears are real and the Individual View has them.
              These parties just were not around for it. */}
            {parties.length > 0 && shown.length === 0 && (
              <p className="finder-empty">No parties in this week. {emptyWeekReason}</p>
            )}

            {shown.length > 0 && running.length === 0 && (
              <p className="finder-empty">
                {history ? "Every boss was off that week." : "Every boss is off this week."}
              </p>
            )}

            {/* An empty list under a filter is an answer, not a blank page. Kept apart from the no
              parties at all case above, which is a different thing to say. */}
            {running.length > 0 && visible.length === 0 && (
              <p className="finder-empty">
                {clearFilter === "cleared"
                  ? "Nothing cleared this week yet."
                  : "Every party is cleared this week."}
              </p>
            )}

            {grouping === "character" &&
              characterGroups.map((group) => {
                const character = characterById.get(group.key);
                return (
                  // A row of its own for the character, then its bosses under it at full width. The
                  // sprite was tried beside the list, in a column of its own, and the list starting
                  // 128px in cost more than the sprite gained.
                  <section className="party-group" key={group.key}>
                    <header className="party-banner">
                      {/* The frame is drawn either way, so a roster where one lookup came back empty
                        does not go ragged around it. */}
                      {character?.spriteImgUrl ? (
                        <img
                          className="party-banner-sprite"
                          src={spriteUrl(character.spriteImgUrl)}
                          alt=""
                        />
                      ) : (
                        <span className="party-banner-sprite is-empty" aria-hidden="true" />
                      )}
                      <h2 className="party-group-name">{character?.name ?? "Unknown character"}</h2>
                      {/* Of what is listed below, not of what the character has: under a filter the
                        two differ, and the number that describes the rows you can see is the one
                        that cannot be read as a claim about the rows you cannot. */}
                      <span className="party-banner-count">
                        {group.parties.length} {group.parties.length === 1 ? "boss" : "bosses"}
                      </span>
                    </header>
                    <div className="party-list">{group.parties.map(bossRow)}</div>
                  </section>
                );
              })}

            {grouping === "party" &&
              arrangements.map((arrangement) => (
                // The by-character list's shape, with the party as its subject: a banner for whose
                // runs these are, then a row per boss. The rows used to be chips summarising a clear
                // and a pool count, which meant leaving the list to answer for either.
                <section className="party-group" key={arrangement.key}>
                  <header className="party-banner is-roster">
                    {/* Every seat, your own character among them, unlike the strip inside a row: the
                      roster is what this grouping files by, so it is what the banner names. */}
                    <RosterStrip members={arrangement.members} />
                    {/* The tiles carry the names, so a visible heading would be the same names a
                      second time. It is still a heading, for the outline the sections make. */}
                    <h2 className="party-group-name visually-hidden">
                      {arrangement.members.map((m) => m.name).join(" + ")}
                    </h2>
                    {/* Of the rows below, as the character banner's count is. */}
                    <span className="party-banner-count">
                      {arrangement.parties.length}{" "}
                      {arrangement.parties.length === 1 ? "boss" : "bosses"}
                    </span>
                  </header>
                  <div className="party-list">{arrangement.parties.map(bossRow)}</div>
                </section>
              ))}

            {grouping === "boss" &&
              bossGroups.map((group) => (
                <section className="party-group" key={group.key.bossKey}>
                  <header className="party-group-head">
                    {group.key.iconUrl && (
                      <img className="boss-portrait" src={apiAssetUrl(group.key.iconUrl)} alt="" />
                    )}
                    <h2 className="party-group-name">{group.key.name}</h2>
                  </header>
                  <div className="party-list">
                    {group.parties.map((party) => (
                      <PartyCard
                        key={party.id}
                        party={party}
                        busy={isSaving(party.id)}
                        clear={clearOf(party)}
                        coupons={couponsOut.get(party.id) ?? NOTHING_OUTSTANDING}
                        onToggleClear={
                          history ? undefined : (cleared) => toggleClear(party, cleared)
                        }
                        dropTable={dropTables[party.bossKey]}
                        onAddDrop={canAddDrops ? (body) => addDrop(party, body) : undefined}
                        pool={poolFor(party)}
                        stacks={stacksFor(party)}
                        rotation={rotationOf(party)}
                        piecePickup={piecePickupFor(party)}
                        onSaveRoster={history ? undefined : (members) => saveRoster(party, members)}
                        onTakeOff={history ? undefined : () => takeOff(party)}
                        heading={
                          <>
                            {characterById.get(party.characterId)?.spriteImgUrl && (
                              <img
                                className="seat-sprite"
                                src={spriteUrl(characterById.get(party.characterId)!.spriteImgUrl!)}
                                alt=""
                              />
                            )}
                            <h3 className="party-row-name">
                              {characterById.get(party.characterId)?.name ?? "Unknown character"}
                            </h3>
                            {/* Beside the character, not folded into the heading: filed by boss,
                              two of your characters can run the same boss at different modes. */}
                            {party.difficulty && (
                              <span className="party-difficulty">
                                {difficultyLabel(party.difficulty)}
                              </span>
                            )}
                          </>
                        }
                      />
                    ))}
                  </div>
                </section>
              ))}

            <SharedParties
              parties={seated}
              bosses={bosses}
              characterOrder={characters.map((c) => c.id)}
              clearOf={(party) => yourClear(party, clearsByCharacter)}
            />
          </>
        )}
      </PageSwap>
    </main>
  );
}
