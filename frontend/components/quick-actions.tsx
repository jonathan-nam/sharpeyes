"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";

import { LotSale } from "@/components/lot-sale";
import { RowSale } from "@/components/row-sale";
import { type RunLog, RunPlan } from "@/components/run-plan";
import { apiFetch, readBack } from "@/lib/api";
import { YOU } from "@/lib/boss-night";
import { peek, put } from "@/lib/cache";
import { sectionHref } from "@/lib/drop-sections";
import {
  fungibleDropKeys,
  lotDrops,
  rowSales,
  type LotRow,
  type LotSaleBody,
} from "@/lib/lot-sale";
import { soloNight } from "@/lib/solo-night";
import { useAuth } from "@/lib/use-auth";
import { useRowWrites } from "@/lib/use-row-writes";
import { SELF_KEY } from "@/lib/vestige-ledger";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { PartyLootPool, SellLootBody } from "@/types/loot";
import type { DropLogPage } from "@/types/page";
import type { Party } from "@/types/party";

// The keys the full pages read and seed, so a widget and its page share one cached copy.
const PARTIES_KEY = "/api/parties";
const BOSSES_KEY = "/api/bosses";
const DROP_LOG_KEY = "/api/pages/drop-log";
const POOLS_KEY = "/api/parties/loot";

type LoadState = "loading" | "loaded" | "error";

const SOLO: { id: string; name: string }[] = [{ id: YOU, name: "You" }];

/**
 * A slice of a page, answerable from the home screen.
 *
 * Each body mounts on first open, so the home screen fetches nothing for a widget nobody opened.
 */
export function QuickActions({ trades }: { trades: boolean }) {
  return (
    <section className="quick-actions">
      <h2 className="quick-actions-title">Quick Actions</h2>
      {/* Heroic worlds sell nothing. See lib/world.ts. */}
      {trades && (
        <QuickFold label="Record Sale">
          <QuickSale />
        </QuickFold>
      )}
      <QuickFold label="Solo Run Order">
        <QuickRunOrder />
      </QuickFold>
    </section>
  );
}

function QuickFold({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Kept mounted once opened, so folding it away does not throw out a half-typed price.
  const [opened, setOpened] = useState(false);
  const panelId = useId();
  return (
    <div className="hero-fold">
      <button
        type="button"
        className="hero-fold-head"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((o) => !o);
          setOpened(true);
        }}
      >
        {label}
        <span className="party-row-chevron hero-fold-caret" aria-hidden="true" />
      </button>
      <div id={panelId} className="quick-action-body" hidden={!open}>
        {opened && children}
      </div>
    </div>
  );
}

/** The Drop Log's Sales tab without the coupon piles, which stay on the tab. */
function QuickSale() {
  const { getToken, isLoaded } = useAuth();
  const [page, setPage] = useState<DropLogPage | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);

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

  async function refreshPools() {
    const pools = await apiFetch<PartyLootPool[]>(POOLS_KEY, {}, getToken);
    setPage((current) => (current ? { ...current, pools } : current));
  }

  // Thrown on rather than shown here, as on the Drop Log: the card that asked shows the reason.
  async function lotSale(body: LotSaleBody) {
    setBusy(true);
    try {
      const pools = await apiFetch<PartyLootPool[]>(
        "/api/parties/loot/lot",
        { method: "POST", body: JSON.stringify(body) },
        getToken,
      );
      setPage((current) => (current ? { ...current, pools } : current));
    } finally {
      setBusy(false);
    }
  }

  async function rowSale(row: LotRow, body: SellLootBody) {
    setBusy(true);
    try {
      await apiFetch<unknown>(
        `/api/parties/${row.partyId}/loot/${row.lootId}/sale`,
        { method: "PUT", body: JSON.stringify(body) },
        getToken,
      );
      await readBack(refreshPools);
    } finally {
      setBusy(false);
    }
  }

  const parties = page?.parties ?? [];
  const pools = page?.pools ?? [];
  const dropTables: DropTables = page?.drops ?? {};
  const fungible = fungibleDropKeys(dropTables);
  const lots = lotDrops(parties, pools, fungible, SELF_KEY);
  const alone = rowSales(parties, pools, dropTables, fungible, SELF_KEY);
  const bossByKey = new Map<string, Boss>((page?.bosses ?? []).map((b) => [b.bossKey, b]));
  const partyById = new Map<string, Party>(parties.map((p) => [p.id, p]));
  const characterById = new Map<string, Character>((page?.characters ?? []).map((c) => [c.id, c]));

  return (
    <>
      {state === "loading" && <p className="party-hint">Loading...</p>}
      {state === "error" && (
        <p className="finder-empty">Couldn&apos;t load your drops. Reload to try again.</p>
      )}
      {state === "loaded" && lots.length + alone.length === 0 && (
        <p className="party-hint">No drops to sell.</p>
      )}
      <LotSale
        drops={lots}
        bossByKey={bossByKey}
        partyById={partyById}
        busy={busy}
        onSell={lotSale}
      />
      <RowSale
        rows={alone}
        bossByKey={bossByKey}
        partyById={partyById}
        characterById={characterById}
        busy={busy}
        onSell={rowSale}
      />
      <Link className="quick-action-more" href={sectionHref("sales")}>
        All Sales
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
  const { isSaving, write } = useRowWrites();
  // Runs ticked here stay in the order. See stillToRun.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());

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

  // The same clear Run Order and Party View write.
  async function toggleClear(party: Party, cleared: boolean) {
    setAnswered((current) => (current.has(party.id) ? current : new Set(current).add(party.id)));
    try {
      await write(party.id, async () => {
        await apiFetch<Party>(
          `${PARTIES_KEY}/${party.id}/clear`,
          { method: "PUT", body: JSON.stringify({ cleared }) },
          getToken,
        );
        const refreshed = await apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, getToken);
        setParties(refreshed);
        put(PARTIES_KEY, refreshed);
      });
    } catch {
      // Leaving the old state up beats showing a tick that did not save.
    }
  }

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
