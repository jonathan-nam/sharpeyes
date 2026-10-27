"use client";

import { PageSwap } from "@/components/page-swap";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DropAuditView } from "@/components/drop-audit";
import { apiFetch, failureText } from "@/lib/api";
import { Button } from "@/components/button";
import { LootSaleForm } from "@/components/loot-sale-form";
import { saleBodyOf } from "@/lib/loot";
import { sellersOf } from "@/lib/sale-logger";
import { useAuth } from "@/lib/use-auth";
import { bossLabel } from "@/lib/boss-difficulty";
import { peek, put } from "@/lib/cache";
import { reportDataReady } from "@/lib/rum";
import { buildDropAudit } from "@/lib/drop-audit";
import { buildDropLog, lootIdsOf, removable } from "@/lib/drop-log";
import { sharedHistory } from "@/lib/shared-history";
import { closedByHolder, foldSeats } from "@/lib/vestige-ledger";
import type { Boss } from "@/types/boss";
import type { DropTables } from "@/types/drop";
import type { PartyLootPool, SellLootBody } from "@/types/loot";
import type { Party, Person } from "@/types/party";
import type { SharedBook } from "@/types/page";
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
const SHARED_KEY = "/api/pages/shared-books";

export default function DropAuditPage() {
  const { getToken, isLoaded } = useAuth();
  const params = useParams<{ loot: string }>();
  const lootId = params.loot;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const [parties, setParties] = useState<Party[]>(peek<Party[]>(PARTIES_KEY) ?? []);
  const [pools, setPools] = useState<PartyLootPool[]>([]);
  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [dropTables, setDropTables] = useState<DropTables>(peek<DropTables>(DROPS_KEY) ?? {});
  const [settlements, setSettlements] = useState<VestigeSettlement[]>([]);
  const [debts, setDebts] = useState<SettlementDebt[]>([]);
  const [people, setPeople] = useState<Person[]>(peek<Person[]>(PEOPLE_KEY) ?? []);
  const [sharedBooks, setSharedBooks] = useState<SharedBook[]>([]);
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
          // A drop in somebody else's party, reached from your Drop Log. Additive, as it is there.
          apiFetch<SharedBook[]>(SHARED_KEY, { method: "GET" }, withToken).catch(() => []),
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
          sharedResult,
        ]) => {
          setParties(partyResult);
          setPools(poolResult);
          setBosses(bossResult);
          setDropTables(dropResult);
          setSettlements(settlementResult);
          setDebts(debtResult);
          setSharedBooks(sharedResult);
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

  // The Drop Log's own lists, shared books included, so a row opens to the figures it showed.
  const shared = sharedHistory(sharedBooks);
  const allParties = [...parties, ...shared.parties];
  const allPools = [...pools, ...shared.pools];
  const allSettlements = [...settlements, ...shared.settlements];
  const log = buildDropLog(allParties, allPools, dropTables, closedByHolder(allSettlements).closed);
  // The people list first, so somebody is named even after their seat has left every party. Seats
  // then win, because a seat carries the name as this account spells it. Same order as the Drop Log.
  const holderNames = new Map<string, string>();
  for (const person of people) holderNames.set(`person:${person.id}`, person.name);
  for (const [key, name] of shared.names) holderNames.set(key, name);
  for (const party of allParties) {
    for (const seat of foldSeats(party.seats)) holderNames.set(seat.key, seat.name);
  }
  const audit = buildDropAudit(
    lootId,
    log.entries,
    allPools,
    allParties,
    new Map(bosses.map((b) => [b.bossKey, b])),
    allSettlements,
    [...debts, ...shared.debts],
    holderNames,
    bossLabel,
  );

  // Your own pools only, as on the Drop Log. See `removable`.
  const entry = log.entries.find((e) => e.lootId === lootId);
  const canRemove = entry !== undefined && removable(entry, lootIdsOf(pools));
  // A sale is corrected in your own pools, by whoever logged the drop (loggerRefusal).
  const loot = pools.flatMap((pool) => pool.loot).find((l) => l.id === lootId);
  const party = entry && parties.find((p) => p.id === entry.partyId);
  const sale = loot && loot.recordedByYou !== false ? saleBodyOf(loot) : null;
  const ran = loot && party ? party.seats.filter((s) => loot.ranThatWeek.includes(s.id)) : [];

  async function write(path: string, options: RequestInit): Promise<boolean> {
    setBusy(true);
    setRefusal(null);
    try {
      await apiFetch(`/api/parties/${entry!.partyId}/loot/${lootId}${path}`, options, getToken);
      return true;
    } catch (e) {
      setRefusal(failureText(e, "That didn't save. Try again."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (await write("", { method: "DELETE" })) router.push("/bosses/drops");
  }

  async function correct(body: SellLootBody) {
    if (!(await write("/sale", { method: "PUT", body: JSON.stringify(body) }))) return;
    setEditing(false);
    setPools(await apiFetch<PartyLootPool[]>(POOLS_KEY, { method: "GET" }, getToken));
  }

  return (
    <main className="page">
      <p className="loot-back">
        <Link href="/bosses/drops">&larr; Drop Log</Link>
      </p>

      {state === "error" && <p>Couldn&apos;t load that drop. Reload to try again.</p>}
      <PageSwap
        waiting={state === "loading"}
        placeholder={<p className="party-hint">Loading...</p>}
      >
        {state === "loaded" &&
          (audit ? (
            <>
              <DropAuditView audit={audit} />
              {editing && sale && party ? (
                <LootSaleForm
                  ran={ran}
                  sellers={sellersOf(ran, party.yours === false)}
                  busy={busy}
                  labelled
                  initial={sale}
                  onSell={(body) => void correct(body)}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                (canRemove || (sale && party)) && (
                  <div className="loot-actions">
                    {sale && party && (
                      <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy}>
                        Edit Sale
                      </Button>
                    )}
                    {/* Two clicks, like every remove that loses something. */}
                    {canRemove && (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => (armed ? void remove() : setArmed(true))}
                        onBlur={() => setArmed(false)}
                      >
                        {armed ? "Confirm Remove" : "Remove"}
                      </Button>
                    )}
                  </div>
                )
              )}
              {refusal && <span className="split-error">{refusal}</span>}
            </>
          ) : (
            // Refused rather than half-drawn. See buildDropAudit.
            <p className="party-hint">This drop was deleted. Go back to the Drop Log.</p>
          ))}
      </PageSwap>
    </main>
  );
}
