"use client";

import { useAuth } from "@clerk/nextjs";
import { useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { RunDraftEditor } from "@/components/run-draft-editor";
import { CopyPlan, RunPlan } from "@/components/run-plan";
import { apiFetch } from "@/lib/api";
import { bossLabel } from "@/lib/boss-difficulty";
import { DEFAULT_MINUTES } from "@/lib/boss-minutes";
import {
  type DraftRun,
  formatDuration,
  type NightPerson,
  rosterFrom,
  rosterFromDrafts,
  runsFromDrafts,
  runsFromParties,
} from "@/lib/boss-night";
import { planNight, screenRuns, tradeOffs } from "@/lib/boss-run-plan";
import { peek, put } from "@/lib/cache";
import { isCleared } from "@/lib/parties";
import { preloadRunArt } from "@/lib/preload-boss-art";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";

const BOSSES_KEY = "/api/bosses";
const PARTIES_KEY = "/api/parties";
const DRAFT_KEY = "sharpeyes.run-order.drafts";

/** The windows people actually block out. Anything else goes in the box beside them. */
const PRESETS = [60, 90, 120, 180, 240];

const NO_DRAFTS: DraftRun[] = [];

type Source = "parties" | "byHand";
type LoadState = "loading" | "loaded" | "error";

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
  const [state, setState] = useState<LoadState>(seededParties ? "loaded" : "loading");

  const [source, setSource] = useState<Source>("parties");
  const [budget, setBudget] = useState(120);
  const [openOnly, setOpenOnly] = useState(true);
  const [away, setAway] = useState<string[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [edited, setEdited] = useState<DraftRun[] | null>(null);

  const storedRaw = useSyncExternalStore(subscribeToDrafts, readStoredDrafts, noStoredDrafts);
  const stored = useMemo(() => parseDrafts(storedRaw), [storedRaw]);
  const drafts = edited ?? stored;

  function changeDrafts(next: DraftRun[]) {
    setEdited(next);
    setChosen(null);
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
        ]);
      })
      .then(([nextParties, nextBosses]) => {
        if (!live) return;
        setParties(nextParties);
        setBosses(nextBosses);
        put(PARTIES_KEY, nextParties);
        put(BOSSES_KEY, nextBosses);
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

  const fromAccount = source === "parties";

  // A CONTROL answers on the tick you click it. Everything a control describes is derived from
  // `shown`, one deferred snapshot of all five of them, so the page it describes changes in a
  // single commit.
  //
  // Deferring only the plan's inputs is what made the filter feel like it loaded in twice: the
  // roster and the run count came from live state and landed immediately, while the headline, the
  // plan tabs and the grid came from a deferred one and landed a render later.
  // Two commits, so the top of the page moved and the rest followed it. It also meant that for the
  // length of the gap the page disagreed with itself, and `unscheduled` below already carried a
  // comment about the one place that had been noticed and patched.
  //
  // Snapshot the INPUTS rather than each derived value: derived values are computed at different
  // depths of the chain, and deferring them one by one is what allowed them to disagree. Server
  // data (parties, bosses) is deliberately not in here, so a load still paints the moment it lands.
  const inputs = useMemo(
    () => ({ source, budget, openOnly, away, drafts }),
    [source, budget, openOnly, away, drafts],
  );
  const shown = useDeferredValue(inputs);
  const stale = shown !== inputs;

  // Memoised down the chain, and the chain is why. planNight is a beam search: run unmemoised it
  // would re-order the whole night on every keystroke in the draft form.
  const showingAccount = shown.source === "parties";

  const usable = useMemo(
    () => (shown.openOnly ? parties.filter((party) => !isCleared(party)) : parties),
    [parties, shown.openOnly],
  );

  const roster: NightPerson[] = useMemo(
    () => (showingAccount ? rosterFrom(usable) : rosterFromDrafts(shown.drafts)),
    [showingAccount, usable, shown.drafts],
  );

  const runs = useMemo(
    () => (showingAccount ? runsFromParties(usable, bosses) : runsFromDrafts(shown.drafts)),
    [showingAccount, usable, bosses, shown.drafts],
  );

  // Who is on, as people and as ids. The grid puts a column per person, so it needs the names and
  // the order, not just the set the screening asks for.
  const onTonight = useMemo(
    () => roster.filter((person) => !shown.away.includes(person.id)),
    [roster, shown.away],
  );
  const here = useMemo(() => onTonight.map((person) => person.id), [onTonight]);

  // Only the eligible half is read. screenRuns still reports what it rejected, and the page no
  // longer shows it: a run nobody can staff now just does not appear.
  const { eligible } = useMemo(() => screenRuns(runs, here), [runs, here]);

  // Nothing on screen marks the wait. Fading the old plan through it was tried and removed: at the
  // ~64ms a normal account takes, the fade began and reversed before it finished, and a flicker
  // reads as a fault where the plain swap reads as the page keeping up. aria-busy still says it,
  // for anything listening rather than looking.
  const { best, byCount } = useMemo(
    () => planNight(eligible, { minutes: shown.budget }),
    [eligible, shown.budget],
  );

  const options = useMemo(() => tradeOffs(byCount), [byCount]);
  // Clamps by itself: a stale index from a previous set of inputs falls back to the full plan
  // rather than showing one built for a question that is no longer being asked.
  const plan = (chosen !== null && options[chosen]) || best;

  const scheduled = new Set(plan.runs.map((planned) => planned.run.id));
  const unscheduled = eligible.filter((run) => !scheduled.has(run.id));
  const assumed = plan.runs.filter((planned) => planned.run.assumed).length;

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
              setChosen(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {fromAccount && state === "loading" && <p className="party-hint">Loading your parties...</p>}

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
            onChange={(e) => {
              setOpenOnly(e.target.checked);
              setChosen(null);
            }}
          />
          <span>Only bosses not cleared this period</span>
        </label>
      )}

      {/* showingAccount, not fromAccount: this describes the runs, so it moves with them rather
          than a render ahead of them. */}
      {showingAccount && state === "loaded" && parties.length > 0 && runs.length === 0 && (
        <p className="finder-empty">
          {parties.length === 1
            ? "Your party is cleared this period."
            : `All ${parties.length} parties are cleared this period.`}
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
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    className={on ? "night-person is-on" : "night-person"}
                    aria-pressed={on}
                    onClick={() => {
                      setAway((current) =>
                        on ? [...current, person.id] : current.filter((id) => id !== person.id),
                      );
                      setChosen(null);
                    }}
                  >
                    {person.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {runs.length > 0 && (
        <section className="night-section">
          <h2 className="night-heading">How long you have</h2>
          <div className="night-budget">
            <span className="basis-row">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={budget === preset ? "basis-tab active" : "basis-tab"}
                  aria-pressed={budget === preset}
                  onClick={() => {
                    setBudget(preset);
                    setChosen(null);
                  }}
                >
                  {formatDuration(preset)}
                </button>
              ))}
            </span>
            <label className="night-custom">
              <span>Minutes</span>
              <input
                className="split-input"
                type="number"
                min={0}
                step={15}
                value={budget}
                onChange={(e) => {
                  setBudget(Math.max(0, Number(e.target.value) || 0));
                  setChosen(null);
                }}
              />
            </label>
          </div>
        </section>
      )}

      {plan.runs.length > 0 && (
        <section className="night-section" aria-busy={stale}>
          <div className="night-plan-head">
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
            <CopyPlan plan={plan} roster={onTonight} />
          </div>

          <RunPlan plan={plan} roster={onTonight} />

          {/* What was guessed stays on screen. It is what the finishing time is built from, and a
              time presented without it reads as a measurement of your parties. */}
          {assumed > 0 && (
            <p className="split-caveat">
              {assumed === plan.runs.length
                ? `Every run is assumed to take ${formatDuration(DEFAULT_MINUTES)}.`
                : `${assumed} ${assumed === 1 ? "run" : "runs"} assumed at ${formatDuration(DEFAULT_MINUTES)}.`}
            </p>
          )}
        </section>
      )}

      {runs.length > 0 && plan.runs.length === 0 && (
        <p className="finder-empty">
          {eligible.length === 0
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
