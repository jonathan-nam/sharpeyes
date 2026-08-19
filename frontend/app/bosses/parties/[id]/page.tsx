"use client";

import { PageSwap } from "@/components/page-swap";
import { useAuth } from "@/lib/use-auth";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { LootPool } from "@/components/loot-pool";
import { RosterStrip } from "@/components/roster-strip";
import { apiAssetUrl } from "@/lib/api";
import { bossLabel } from "@/lib/boss-difficulty";
import { preloadBossArt } from "@/lib/preload-boss-art";
import { useRowWrites } from "@/lib/use-row-writes";
import { ApiError, SAVED_BUT_STALE, StaleAfterWrite, apiFetch, readBack } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { buildDropLog, couponsOutstandingByParty, pieceStatusByParty } from "@/lib/drop-log";
import { useDropIcons } from "@/lib/drop-icons";
import { NOTHING_OUTSTANDING, poolLabel, summarize } from "@/lib/loot";
import { closedByHolder } from "@/lib/vestige-ledger";
import { otherMembers, partySizeLabel } from "@/lib/parties";
import type { Boss } from "@/types/boss";
import type { DropTables } from "@/types/drop";
import type { AddLootBody, Loot, SellLootBody } from "@/types/loot";
import type { VestigeSettlement } from "@/types/vestige";
import type { Party } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

const BOSSES_KEY = "/api/bosses";
const DROPS_KEY = "/api/bosses/drops";
const SETTLEMENTS_KEY = "/api/vestige-settlements";
// Rows are keyed by their drop's id while they save. The picker is not a row, so it takes a name of
// its own. See lib/use-row-writes.ts.
const ADD_DROP = "add-drop";

export default function PartyPage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken } = useAuth();
  const params = useParams<{ id: string }>();
  const partyId = params.id;

  const [party, setParty] = useState<Party | null>(null);
  const [loot, setLoot] = useState<Loot[]>([]);
  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [dropTables, setDropTables] = useState<DropTables>(peek<DropTables>(DROPS_KEY) ?? {});
  const [settlements, setSettlements] = useState<VestigeSettlement[]>(
    peek<VestigeSettlement[]>(SETTLEMENTS_KEY) ?? [],
  );
  const [state, setState] = useState<LoadState>("loading");
  // The pool's picker draws them. See lib/drop-icons.ts.
  useDropIcons(dropTables);
  // Per drop, so marking one share paid does not grey out every other row in the pool. One write at
  // a time still, because each one refetches the pool. See lib/use-row-writes.ts.
  const { isSaving, write } = useRowWrites();
  const [error, setError] = useState<string | null>(null);

  const partyUrl = `/api/parties/${partyId}`;
  const lootUrl = `${partyUrl}/loot`;

  async function loadLoot(token?: string | null) {
    const result = await apiFetch<Loot[]>(
      lootUrl,
      { method: "GET" },
      token !== undefined ? () => Promise.resolve(token) : getToken,
    );
    setLoot(result);
  }

  useEffect(() => {
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Party>(partyUrl, { method: "GET" }, withToken),
          loadLoot(token),
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          // The whole catalog's drop tables, cached: it is a few dozen rows and the picker needs
          // whichever boss you switch to next.
          apiFetch<DropTables>(DROPS_KEY, { method: "GET" }, withToken),
          // What stops a closed debt still reading as owed here. See V52.
          apiFetch<VestigeSettlement[]>(SETTLEMENTS_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([partyResult, , bossResult, dropResult, settlementResult]) => {
        setParty(partyResult);
        setBosses(bossResult);
        setDropTables(dropResult);
        setSettlements(settlementResult);
        put(BOSSES_KEY, bossResult);
        put(DROPS_KEY, dropResult);
        put(SETTLEMENTS_KEY, settlementResult);
        setState("loaded");
      })
      .catch(() => setState("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId]);

  // Every mutation refetches the pool rather than patching it in place: status is derived from the
  // sale and the payout rows server side, so the server's answer is the only one that is right.
  async function mutate(key: string, path: string, options: RequestInit) {
    setError(null);
    try {
      await write(key, async () => {
        await apiFetch<unknown>(path, options, getToken);
        // Past the write, so a refetch that fails leaves the screen behind and not the write undone.
        // Saying "That didn't save." about one is what got a drop logged twice. See StaleAfterWrite.
        await readBack(loadLoot);
      });
    } catch (e) {
      if (e instanceof StaleAfterWrite) setError(SAVED_BUT_STALE);
      else setError(e instanceof ApiError ? e.body : "That didn't save.");
    }
  }

  // Keyed by the drop being written, so only that row is drawn as saving.
  const add = (body: AddLootBody) =>
    mutate(ADD_DROP, lootUrl, { method: "POST", body: JSON.stringify(body) });
  const sell = (lootId: string, body: SellLootBody) =>
    mutate(lootId, `${lootUrl}/${lootId}/sale`, { method: "PUT", body: JSON.stringify(body) });
  const unsell = (lootId: string) =>
    mutate(lootId, `${lootUrl}/${lootId}/sale`, { method: "DELETE" });
  const setTaken = (lootId: string, memberId: string | null) =>
    mutate(lootId, `${lootUrl}/${lootId}/taken`, {
      method: "PUT",
      body: JSON.stringify({ memberId }),
    });
  const setPaid = (lootId: string, memberId: string, paid: boolean) =>
    mutate(lootId, `${lootUrl}/${lootId}/payouts/${memberId}`, {
      method: "PUT",
      body: JSON.stringify({ paid }),
    });
  const remove = (lootId: string) => mutate(lootId, `${lootUrl}/${lootId}`, { method: "DELETE" });

  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  // Counted from the rows on screen rather than from the party's stored counters, which were read
  // one request earlier and go stale the moment something here is marked paid.
  //
  // Through the Drop Log's own reading of them, the same as the card that links here. Counting
  // every PENDING row instead made this page disagree with that card about the same party: a
  // coupon row never sells, so it was pending for ever here while the card left it out.
  const closed = closedByHolder(settlements).closed;
  const log = party
    ? buildDropLog([party], [{ partyId: party.id, loot }], dropTables, closed)
    : null;
  // What each coupon row says it is: a piece drop is PENDING for ever, because it never sells through
  // its own row, so the raw status read "In the pool" on every vestige stack this party ever dropped.
  // The same reading Party View's panels use, from the same place.
  const pieceStatus = party ? pieceStatusByParty(log?.entries ?? []).get(party.id) : undefined;
  const summary = summarize(loot);
  const poolLine = poolLabel(
    {
      // The log's own reading, which leaves out a coupon drop already in the right inventories.
      // summarize still answers for the other two: it splits sold from paid out, which the log's
      // totals do not.
      pendingLoot: log?.totals.pending ?? summary.pending,
      awaitingPayout: summary.awaitingPayout,
      settledLoot: summary.settled,
    },
    (party && couponsOutstandingByParty(log?.entries ?? []).get(party.id)) || NOTHING_OUTSTANDING,
  );

  return (
    <main className="page">
      {/* Back where this page was reached from. A solo pool is not on Party View, so sending it
          there would be sending it to a list it is not in. */}
      <p className="loot-back">
        {party?.solo ? (
          <Link href="/bosses/drops">&larr; Drop Log</Link>
        ) : (
          <Link href="/bosses/parties">&larr; Party View</Link>
        )}
      </p>

      {state === "error" && <p>Couldn&apos;t load that party.</p>}
      <PageSwap
        waiting={state === "loading"}
        placeholder={<p className="party-hint">Loading...</p>}
      >
        {state === "loaded" && party && (
          <>
            {/* The boss and the roster ARE the title: there is nothing else it could be called. A
              solo pool has no roster to name, and "with" trailing off into nothing was what the
              same line drew for it. */}
            <h1 className="page-title">
              {/* The one place the page says which boss this is. Everything under it (the picker, the
                rows) belongs to the same boss, so it is said here or it is not said. */}
              {bossByKey.get(party.bossKey)?.iconUrl && (
                <img
                  className="boss-portrait"
                  src={apiAssetUrl(bossByKey.get(party.bossKey)!.iconUrl!)}
                  alt=""
                />
              )}
              {bossLabel(bossByKey.get(party.bossKey)?.name ?? party.bossKey, party.difficulty)}
              {!party.solo &&
                ` with ${otherMembers(party)
                  .map((m) => m.name)
                  .join(", ")}`}
            </h1>
            <div className="party-card-head">
              {/* Your own character among them, unlike the strips on Party View, which put it in the
                header and list only the others. Here it is one of the shares. */}
              <RosterStrip members={party.members} />
              <span className="party-card-size">{partySizeLabel(party.members.length)}</span>
            </div>

            {poolLine && (
              <p className={poolLine.done ? "party-loot-summary is-done" : "party-loot-summary"}>
                {poolLine.text}
              </p>
            )}

            {error && <p className="split-error">{error}</p>}

            <LootPool
              party={party}
              pieceStatus={pieceStatus}
              loot={loot}
              dropTables={dropTables}
              bossByKey={bossByKey}
              adding={isSaving(ADD_DROP)}
              isSaving={isSaving}
              onAdd={add}
              onSell={sell}
              onUnsell={unsell}
              onSetTaken={setTaken}
              onSetPaid={setPaid}
              onDelete={remove}
            />
          </>
        )}
      </PageSwap>
    </main>
  );
}
