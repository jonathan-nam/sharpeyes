"use client";

import { PageSwap } from "@/components/page-swap";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DropAuditView } from "@/components/drop-audit";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import { bossLabel } from "@/lib/boss-difficulty";
import { peek, put } from "@/lib/cache";
import { reportDataReady } from "@/lib/rum";
import { buildDropAudit } from "@/lib/drop-audit";
import { buildDropLog, isUntradeablePiece } from "@/lib/drop-log";
import { closedByHolder, foldSeats } from "@/lib/vestige-ledger";
import type { Boss } from "@/types/boss";
import type { DropTables } from "@/types/drop";
import type { PartyLootPool } from "@/types/loot";
import type { Party, Person } from "@/types/party";
import type { SettlementDebt, VestigeSettlement } from "@/types/vestige";

// What happened to one drop. Reached from the Settled tab and from an offset on the Settlement
// Ledger, both of which name a drop and used to open the party it fell in.
//
// Reads the same lists the Drop Log does and builds the same log from them, because the figures on
// the row that was clicked have to be the figures on the page it opens. A cheaper fetch of the one
// drop would be a second reader, and two readers is how a page comes to disagree with the one that
// links to it.

type LoadState = "loading" | "loaded" | "error";

// Solo pools and retired configs included, as the Drop Log asks for them: both hold drops whose
// configs are off every list, and one of those is exactly a drop somebody follows a link to.
const PARTIES_KEY = "/api/parties?solo=include&retired=include";
const POOLS_KEY = "/api/parties/loot";
const BOSSES_KEY = "/api/bosses";
const DROPS_KEY = "/api/bosses/drops";
const SETTLEMENTS_KEY = "/api/vestige-settlements";
const DEBTS_KEY = "/api/settlement-debts";
const PEOPLE_KEY = "/api/people";

export default function DropAuditPage() {
  const { getToken, isLoaded } = useAuth();
  const params = useParams<{ loot: string }>();
  const lootId = params.loot;

  const [parties, setParties] = useState<Party[]>(peek<Party[]>(PARTIES_KEY) ?? []);
  const [pools, setPools] = useState<PartyLootPool[]>([]);
  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [dropTables, setDropTables] = useState<DropTables>(peek<DropTables>(DROPS_KEY) ?? {});
  const [settlements, setSettlements] = useState<VestigeSettlement[]>([]);
  const [debts, setDebts] = useState<SettlementDebt[]>([]);
  const [people, setPeople] = useState<Person[]>(peek<Person[]>(PEOPLE_KEY) ?? []);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    // Not before Clerk answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    // One token for the whole burst: getToken() can round-trip to Clerk.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, withToken),
          apiFetch<PartyLootPool[]>(POOLS_KEY, { method: "GET" }, withToken),
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          apiFetch<DropTables>(DROPS_KEY, { method: "GET" }, withToken),
          apiFetch<VestigeSettlement[]>(SETTLEMENTS_KEY, { method: "GET" }, withToken),
          apiFetch<SettlementDebt[]>(DEBTS_KEY, { method: "GET" }, withToken),
          // Only to NAME an act. Somebody an offset or a settlement names may have no seat left.
          apiFetch<Person[]>(PEOPLE_KEY, { method: "GET" }, withToken).catch(() => null),
        ]);
      })
      .then(
        ([
          partyResult,
          poolResult,
          bossResult,
          dropResult,
          settlementResult,
          debtResult,
          peopleResult,
        ]) => {
          setParties(partyResult);
          setPools(poolResult);
          setBosses(bossResult);
          setDropTables(dropResult);
          setSettlements(settlementResult);
          setDebts(debtResult);
          if (peopleResult) {
            setPeople(peopleResult);
            put(PEOPLE_KEY, peopleResult);
          }
          put(PARTIES_KEY, partyResult);
          put(BOSSES_KEY, bossResult);
          put(DROPS_KEY, dropResult);
          setState("loaded");
          reportDataReady();
        },
      )
      .catch(() => setState("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lootId, isLoaded]);

  // The Drop Log's own reading, filter and all: an Eternal piece is off that log entirely, so
  // leaving it in here would spend the coupon sales differently and report a gap the Settled tab
  // does not. See buildDropLog and isUntradeablePiece.
  const sellable = pools.map((pool) => ({
    ...pool,
    loot: pool.loot.filter((row) => !isUntradeablePiece(row, dropTables)),
  }));
  const log = buildDropLog(parties, sellable, dropTables, closedByHolder(settlements).closed);
  // The people list first, so somebody is named even after their seat has left every party. Seats
  // then win, because a seat carries the name as this account spells it. Same order as the Drop Log.
  const holderNames = new Map<string, string>();
  for (const person of people) holderNames.set(`person:${person.id}`, person.name);
  for (const party of parties) {
    for (const seat of foldSeats(party.seats)) holderNames.set(seat.key, seat.name);
  }
  const audit = buildDropAudit(
    lootId,
    log.entries,
    sellable,
    parties,
    new Map(bosses.map((b) => [b.bossKey, b])),
    settlements,
    debts,
    holderNames,
    bossLabel,
  );

  return (
    <main className="page">
      <p className="loot-back">
        <Link href="/bosses/drops">&larr; Drop Log</Link>
      </p>

      {state === "error" && <p>Couldn&apos;t load that drop.</p>}
      <PageSwap
        waiting={state === "loading"}
        placeholder={<p className="party-hint">Loading...</p>}
      >
        {state === "loaded" &&
          (audit ? (
            <DropAuditView audit={audit} />
          ) : (
            // Refused rather than half-drawn. See buildDropAudit.
            <p className="party-hint">That drop is not in the log.</p>
          ))}
      </PageSwap>
    </main>
  );
}
