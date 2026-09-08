"use client";

import { PageSwap } from "@/components/page-swap";
import { useAuth } from "@/lib/use-auth";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BossMatrix } from "@/components/boss-matrix";
import { OtherWorld } from "@/components/other-world";
import { ResetTimer } from "@/components/reset-timer";
import { WeekStepper } from "@/components/week-stepper";
import { apiFetch } from "@/lib/api";
import { preloadBossArt } from "@/lib/preload-boss-art";
import { type CrossedReset, WEEKLY_CADENCE } from "@/lib/reset-countdown";
import { peek, put, storedAt } from "@/lib/cache";
import { reportDataReady } from "@/lib/rum";
import type { Boss, BossClearsView } from "@/types/boss";
import type { Character } from "@/types/character";

type LoadState = "loading" | "loaded" | "error";

const BOSSES_KEY = "/api/bosses";
const CLEARS_KEY = "/api/bosses/clears";
const CHARACTERS_KEY = "/api/characters";

// Only the current view is cached. A past week is reached by a deliberate click and is worth a
// round-trip; caching every week stepped through would grow without bound for no visible gain.
const clearsUrl = (week: string | null) => (week ? `${CLEARS_KEY}?week=${week}` : CLEARS_KEY);

export default function BossesPage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken, isLoaded } = useAuth();

  // Seeded from cache so a repeat visit paints immediately rather than flashing a loading state
  // for data it already had. The fetch below still runs and overwrites. See lib/cache.ts.
  const seededBosses = peek<Boss[]>(BOSSES_KEY);
  const seededCharacters = peek<Character[]>(CHARACTERS_KEY);

  const [bosses, setBosses] = useState<Boss[]>(seededBosses ?? []);
  const [characters, setCharacters] = useState<Character[]>(seededCharacters ?? []);
  const [view, setView] = useState<BossClearsView | null>(peek<BossClearsView>(CLEARS_KEY) ?? null);
  // When the view was received, so the countdown can correct for a browser clock that disagrees
  // with the server's. A seeded view arrived with the request that cached it, not now: see
  // storedAt in lib/cache.ts, and lib/reset-countdown.ts.
  const [receivedAt, setReceivedAt] = useState<number>(() => storedAt(CLEARS_KEY) ?? Date.now());
  const [state, setState] = useState<LoadState>(
    seededBosses && seededCharacters ? "loaded" : "loading",
  );
  const [week, setWeek] = useState<string | null>(null);
  const [stepping, setStepping] = useState(false);
  const [ticking, setTicking] = useState(false);

  // Clicking the arrow twice quickly fires two requests, and they can land in either order. Only
  // the newest one may write state, or the matrix ends up showing a week the label disagrees with.
  const latestRequest = useRef(0);

  // Answers whether this response was the one that landed. A caller that also moves the week label
  // has to know: an overtaken response leaves the matrix on somebody else's week, and setting the
  // label anyway would put this week's date over that week's marks.
  async function loadClears(target: string | null, token?: string | null): Promise<boolean> {
    const ticket = ++latestRequest.current;
    const result = await apiFetch<BossClearsView>(
      clearsUrl(target),
      { method: "GET" },
      token !== undefined ? () => Promise.resolve(token) : getToken,
    );
    if (ticket !== latestRequest.current) return false;
    setView(result);
    setReceivedAt(Date.now());
    if (target === null) put(CLEARS_KEY, result);
    return true;
  }

  /**
   * Answers one cell by hand, for when there is no planner capture to hand.
   *
   * Writes boss_clear, the same row a capture writes and Party View ticks, so the three cannot
   * drift. The server answers with the refreshed matrix: which period a tick lands in follows from
   * the boss's cadence and is decided there, so reading it back is what makes the screen show what
   * was written rather than what was clicked.
   *
   * Ticks serialise (see `ticking`). Two in flight at once could land in either order, and the
   * later answer is not necessarily the one that saw both writes.
   */
  async function toggleClear(characterId: string, bossKey: string, cleared: boolean) {
    const ticket = ++latestRequest.current;
    setTicking(true);
    try {
      const result = await apiFetch<BossClearsView>(
        CLEARS_KEY,
        { method: "PUT", body: JSON.stringify({ characterId, bossKey, cleared }) },
        getToken,
      );
      if (ticket !== latestRequest.current) return;
      setView(result);
      setReceivedAt(Date.now());
      put(CLEARS_KEY, result);
    } catch {
      // Leaving the old mark up beats drawing a tick that did not save.
    } finally {
      setTicking(false);
    }
  }

  async function selectWeek(target: string | null) {
    setStepping(true);
    try {
      if (await loadClears(target)) setWeek(target);
    } catch {
      // Keep the week that is on screen. Moving the label without the data behind it would label
      // one week's marks with another week's date.
    } finally {
      setStepping(false);
    }
  }

  /**
   * Picks the new period up when a reset passes under an open tab.
   *
   * A weekly reset takes the matrix back to the current week, the way the in-game planner comes
   * back cleared rather than still showing the week you had open. Every other cadence refetches
   * the week on screen and leaves it there: a daily period turning over at midnight says nothing
   * about the week you were reading, and moving you off it would be the clock taking the page.
   */
  async function pickUpReset(crossed: CrossedReset) {
    await selectWeek(crossed.cadences.includes(WEEKLY_CADENCE) ? null : week);
  }

  useEffect(() => {
    // Not before auth answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    // One token for the whole burst. getToken() can round-trip to auth and that cost is paid
    // before each request goes out (see lib/api.ts), so three separate calls would pay it three
    // times. Mint once and share, as the inventory page does.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          loadClears(null, token),
        ]);
      })
      .then(([bossResult, characterResult]) => {
        setBosses(bossResult);
        setCharacters(characterResult);
        put(BOSSES_KEY, bossResult);
        put(CHARACTERS_KEY, characterResult);
        setState("loaded");
        reportDataReady();
      })
      // Only show the error state if we have nothing at all: a failed refresh behind data we
      // already have should not blank the page.
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  // Not "characters.length === 0": that is also true while the roster is still loading, when the
  // answer is "not yet" rather than "nobody".

  return (
    <main className="page">
      {/* Beside the title, like Edit Parties on Party View: it leaves the page, so it does not
          belong in the controls row, where everything else acts on the table below. */}
      <div className="page-head">
        <h1 className="page-title">Individual View</h1>
        {state === "loaded" && characters.length > 0 && (
          <span className="page-head-links">
            {/* Which bosses a character runs is set one character at a time, on its own page: the
                whole set is the thing being answered, and a grid of cells cannot show one
                character's set without you reading down a column. */}
            <Link className="party-cancel" href="/bosses/routine">
              Edit Boss Config
            </Link>
          </span>
        )}
      </div>

      {state === "error" && <p>Couldn&apos;t load your boss clears.</p>}

      {/* The loading state IS the real matrix with shimmer in its cells, so the two cannot drift
          apart. A separate skeleton that restated the table's metrics by hand is exactly what put
          the inventory window 30px out of place (#77). */}
      <PageSwap
        waiting={state === "loading"}
        placeholder={
          <BossMatrix loading bosses={bosses} characters={characters} clearsByCharacter={{}} />
        }
        shaped
      >
        {state === "loaded" && (
          <>
            {characters.length === 0 ? (
              <>
                <p className="finder-empty">
                  No characters yet. <Link href="/characters">Add one</Link> to start tracking
                  clears.
                </p>
                {/* This list is one world's, so "no characters" can mean they are all in the
                    other one, and the line above would be telling you to add what you have. */}
                <OtherWorld />
              </>
            ) : (
              <>
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

                {/* Editable on the live view only: a past week carries weekly rows alone, so a
                tick on it would have no one period to land in. */}
                <BossMatrix
                  bosses={bosses}
                  characters={characters}
                  clearsByCharacter={view?.clearsByCharacter ?? {}}
                  skipsByCharacter={view?.skipsByCharacter ?? {}}
                  historyWeek={view?.weekStart ?? null}
                  onToggle={week === null ? toggleClear : undefined}
                  busy={ticking || stepping}
                />
              </>
            )}
          </>
        )}
      </PageSwap>
    </main>
  );
}
