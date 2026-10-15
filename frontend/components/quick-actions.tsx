"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { HeroFold } from "@/components/hero-fold";
import { type RunLog, RunPlan } from "@/components/run-plan";
import { SaleCards } from "@/components/sale-cards";
import { SettlementStage } from "@/components/settlement-stage";
import { apiFetch } from "@/lib/api";
import { progressLabel, progressMark } from "@/lib/boss-clears";
import { YOU } from "@/lib/boss-night";
import { weeklyLeft } from "@/lib/bosses-left";
import { peek, put } from "@/lib/cache";
import { sectionHref } from "@/lib/drop-sections";
import { saleQueues } from "@/lib/lot-sale";
import { settlementView } from "@/lib/settlement-view";
import { soloNight } from "@/lib/solo-night";
import { useAuth } from "@/lib/use-auth";
import { type DropLogPatch, useDropLogWrites } from "@/lib/use-drop-log-writes";
import { useNightClears } from "@/lib/use-night-clears";
import { SELF_KEY } from "@/lib/vestige-ledger";
import type { Boss, BossClearsView } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropLogPage } from "@/types/page";
import type { Party } from "@/types/party";

// The keys the full pages read and seed, so a widget and its page share one cached copy.
const PARTIES_KEY = "/api/parties";
const BOSSES_KEY = "/api/bosses";
const CLEARS_KEY = "/api/bosses/clears";
const CHARACTERS_KEY = "/api/characters";
const DROP_LOG_KEY = "/api/pages/drop-log";

type LoadState = "loading" | "loaded" | "error";

const SOLO: { id: string; name: string }[] = [{ id: YOU, name: "You" }];

/**
 * A slice of a page, answerable from the home screen. Each draws the page's own components, so
 * an act taken here is the act taken there.
 *
 * Each body mounts on first open, so the home screen fetches nothing for a widget nobody opened.
 */
export function QuickActions({ trades }: { trades: boolean }) {
  return (
    <section className="quick-actions">
      <h2 className="quick-actions-title">Quick Actions</h2>
      <HeroFold head="Bosses Left" panelClassName="quick-action-body" lazy>
        <QuickBossesLeft />
      </HeroFold>
      <HeroFold head="Solo Run Order" panelClassName="quick-action-body" lazy>
        <QuickRunOrder />
      </HeroFold>
      {/* Heroic worlds trade nothing. See lib/world.ts. */}
      {trades && (
        <HeroFold head="Record Sale" panelClassName="quick-action-body" lazy>
          <QuickSale />
        </HeroFold>
      )}
      {trades && (
        <HeroFold head="Settlement" panelClassName="quick-action-body" lazy>
          <QuickSettlement />
        </HeroFold>
      )}
    </section>
  );
}

/**
 * The Drop Log's composite read, and the writes that patch it.
 *
 * Not cached, as on the Drop Log: the pools are never cached there either.
 */
function useDropLog() {
  const { getToken, isLoaded } = useAuth();
  const [page, setPage] = useState<DropLogPage | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    // Not before auth answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    let live = true;
    apiFetch<DropLogPage>(DROP_LOG_KEY, { method: "GET" }, getToken)
      .then((next) => {
        if (!live) return;
        setPage(next);
        setState("loaded");
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, [getToken, isLoaded]);

  const apply = useCallback(
    (patch: DropLogPatch) => setPage((current) => (current ? { ...current, ...patch } : current)),
    [],
  );
  const writes = useDropLogWrites(getToken, apply);

  return { page, state, writes };
}

/** The Drop Log's sale cards, without the coupon piles, which stay on the Sales tab. */
function QuickSale() {
  const { page, state, writes } = useDropLog();
  const queues = useMemo(
    () => (page ? saleQueues(page.parties, page.pools, page.drops, SELF_KEY) : null),
    [page],
  );

  return (
    <>
      {state === "loading" && <p className="party-hint">Loading...</p>}
      {state === "error" && (
        <p className="finder-empty">Couldn&apos;t load your drops. Reload to try again.</p>
      )}
      {queues && queues.lots.length + queues.alone.length === 0 && (
        <p className="party-hint">No drops to sell.</p>
      )}
      {page && queues && (
        <SaleCards page={page} lots={queues.lots} alone={queues.alone} writes={writes} />
      )}
      <Link className="quick-action-more" href={sectionHref("sales")}>
        All Sales
      </Link>
    </>
  );
}

/** The Drop Log's Settlement stage, whole. */
function QuickSettlement() {
  const { page, state, writes } = useDropLog();
  const view = useMemo(() => (page ? settlementView(page) : null), [page]);

  return (
    <>
      {state === "loading" && <p className="party-hint">Loading...</p>}
      {state === "error" && (
        <p className="finder-empty">Couldn&apos;t load your settlements. Reload to try again.</p>
      )}
      {page && view && <SettlementStage page={page} view={view} writes={writes} heading={false} />}
      <Link className="quick-action-more" href={sectionHref("settlement")}>
        All Settlements
      </Link>
    </>
  );
}

/** Run Order with only you on and no clock. See lib/solo-night.ts. */
function QuickRunOrder() {
  const { getToken, isLoaded } = useAuth();
  const seeded = peek<Party[]>(PARTIES_KEY);
  const [parties, setParties] = useState<Party[]>(seeded ?? []);
  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [state, setState] = useState<LoadState>(seeded ? "loaded" : "loading");
  const { answered, isSaving, toggleClear } = useNightClears(getToken, setParties);

  useEffect(() => {
    if (!isLoaded) return;
    let live = true;
    Promise.all([
      apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, getToken),
      apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, getToken),
    ])
      .then(([nextParties, nextBosses]) => {
        if (!live) return;
        setParties(nextParties);
        setBosses(nextBosses);
        put(PARTIES_KEY, nextParties);
        put(BOSSES_KEY, nextBosses);
        setState("loaded");
      })
      .catch(() => live && setState((current) => (current === "loaded" ? current : "error")));
    return () => {
      live = false;
    };
  }, [getToken, isLoaded]);

  const { plan, total } = useMemo(
    () => soloNight(parties, bosses, answered),
    [parties, bosses, answered],
  );
  const partyById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);

  const log: RunLog = {
    partyOf: (runId) => partyById.get(runId),
    dropTable: () => undefined,
    busy: isSaving,
    onToggleClear: toggleClear,
  };

  return (
    <>
      {state === "loading" && <p className="party-hint">Loading...</p>}
      {state === "error" && (
        <p className="finder-empty">Couldn&apos;t load your parties. Reload to try again.</p>
      )}
      {state === "loaded" && plan.runs.length === 0 && (
        <p className="party-hint">
          {total === 0 ? "No bosses you run alone." : "Every solo boss is cleared."}
        </p>
      )}
      {plan.runs.length > 0 && (
        <RunPlan plan={plan} roster={SOLO} startAt={0} timed={false} log={log} />
      )}
      <Link className="quick-action-more" href="/bosses/order">
        Full Run Order
      </Link>
    </>
  );
}

/** This week's weekly bosses each character still has to clear. See lib/bosses-left.ts. */
function QuickBossesLeft() {
  const { getToken, isLoaded } = useAuth();
  const seededView = peek<BossClearsView>(CLEARS_KEY);
  const [view, setView] = useState<BossClearsView | null>(seededView ?? null);
  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [characters, setCharacters] = useState<Character[]>(
    peek<Character[]>(CHARACTERS_KEY) ?? [],
  );
  const [state, setState] = useState<LoadState>(seededView ? "loaded" : "loading");

  useEffect(() => {
    if (!isLoaded) return;
    let live = true;
    Promise.all([
      apiFetch<BossClearsView>(CLEARS_KEY, { method: "GET" }, getToken),
      apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, getToken),
      apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, getToken),
    ])
      .then(([nextView, nextBosses, nextCharacters]) => {
        if (!live) return;
        setView(nextView);
        setBosses(nextBosses);
        setCharacters(nextCharacters);
        put(CLEARS_KEY, nextView);
        put(BOSSES_KEY, nextBosses);
        put(CHARACTERS_KEY, nextCharacters);
        setState("loaded");
      })
      .catch(() => live && setState((current) => (current === "loaded" ? current : "error")));
    return () => {
      live = false;
    };
  }, [getToken, isLoaded]);

  const rows = useMemo(
    () => (view ? weeklyLeft(bosses, characters, view) : []),
    [bosses, characters, view],
  );

  return (
    <>
      {state === "loading" && <p className="party-hint">Loading...</p>}
      {state === "error" && (
        <p className="finder-empty">Couldn&apos;t load your clears. Reload to try again.</p>
      )}
      {state === "loaded" && rows.length === 0 && (
        <p className="party-hint">No weekly bosses to run.</p>
      )}
      {rows.length > 0 && (
        <ul className="quick-left">
          {rows.map(({ character, progress, left }) => (
            <li key={character.id} className="quick-left-row">
              <span className="quick-left-name">{character.name}</span>
              <span className="quick-left-mark" aria-label={progressLabel(progress)}>
                {progressMark(progress)}
              </span>
              <span className="quick-left-bosses">{left.map((boss) => boss.name).join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
      <Link className="quick-action-more" href="/bosses">
        Individual View
      </Link>
    </>
  );
}
