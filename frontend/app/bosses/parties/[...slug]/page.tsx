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
import { reportDataReady } from "@/lib/rum";
import {
  buildDropLog,
  couponsOutstandingByParty,
  isOutstanding,
  pieceStatusByParty,
} from "@/lib/drop-log";
import { useDropIcons } from "@/lib/drop-icons";
import { NOTHING_OUTSTANDING, poolLabel, summarize } from "@/lib/loot";
import { assignableDrops } from "@/lib/vestige-pickup";
import { behindByHolder, rotatingDrops, rotationFor } from "@/lib/loot-rotation";
import { shareConfig } from "@/lib/vestige-stacks";
import { closedByHolder } from "@/lib/vestige-ledger";
import { ownMember, partySizeLabel } from "@/lib/parties";
import type { Boss } from "@/types/boss";
import type { DropTables } from "@/types/drop";
import type { AddLootBody, Loot, PartyLootPool, SellLootBody } from "@/types/loot";
import type { VestigeSettlement } from "@/types/vestige";
import type { Party } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

const BOSSES_KEY = "/api/bosses";
const DROPS_KEY = "/api/bosses/drops";
const SETTLEMENTS_KEY = "/api/vestige-settlements";
// Every config, for the log below alone. buildDropLog skips a pool whose config it cannot find, and
// a coupon debt cancels against the OTHER nights with the same person, so a retired config or a solo
// pool left out of this list moves the figure this page draws for the party you are looking at. Same
// key as the Drop Log, so the two cannot disagree about what is owed. See partiesFor.
const PARTIES_KEY = "/api/parties?solo=include&retired=include";
const POOLS_KEY = "/api/parties/loot";
// The one drop whose nights are stated seat by seat here. Party View's own constant, same key.
const VESTIGE = "vestige-of-erion";
// Rows are keyed by their drop's id while they save. The picker is not a row, so it takes a name of
// its own. See lib/use-row-writes.ts.
const ADD_DROP = "add-drop";

export default function PartyPage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken, isLoaded } = useAuth();
  const params = useParams<{ slug: string[] }>();
  // The path as the server reads it: "rune/lomien", or one segment for a uuid, which is what an
  // older link carries. See backend PartySlug.kt.
  const slug = params.slug.join("/");

  const [party, setParty] = useState<Party | null>(null);
  const [loot, setLoot] = useState<Loot[]>([]);
  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [dropTables, setDropTables] = useState<DropTables>(peek<DropTables>(DROPS_KEY) ?? {});
  const [settlements, setSettlements] = useState<VestigeSettlement[]>(
    peek<VestigeSettlement[]>(SETTLEMENTS_KEY) ?? [],
  );
  const [parties, setParties] = useState<Party[]>(peek<Party[]>(PARTIES_KEY) ?? []);
  const [pools, setPools] = useState<PartyLootPool[]>(peek<PartyLootPool[]>(POOLS_KEY) ?? []);
  const [state, setState] = useState<LoadState>("loading");
  // The pool's picker draws them. See lib/drop-icons.ts.
  useDropIcons(dropTables);
  // Per drop, so marking one share paid does not grey out every other row in the pool. One write at
  // a time still, because each one refetches the pool. See lib/use-row-writes.ts.
  const { isSaving, write } = useRowWrites();
  const [error, setError] = useState<string | null>(null);

  const partyUrl = `/api/parties/by/${slug}`;
  // The pool is addressed by id, which the config answers with: the slug names the config, and only
  // it can say which one. Called from the writes below too, all of which are drawn once it is
  // loaded, which is what makes the assertion safe.
  const lootUrl = () => `/api/parties/${party!.id}/loot`;

  async function loadLoot(partyId: string, token?: string | null) {
    const result = await apiFetch<Loot[]>(
      `/api/parties/${partyId}/loot`,
      { method: "GET" },
      token !== undefined ? () => Promise.resolve(token) : getToken,
    );
    setLoot(result);
  }

  useEffect(() => {
    // Not before Clerk answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        const config = apiFetch<Party>(partyUrl, { method: "GET" }, withToken);
        return Promise.all([
          config,
          // The one read that waits on another: the pool is asked for by id, and the slug in the URL
          // is not one. Everything below it is asked for at the same time as the config itself.
          config.then((p) => loadLoot(p.id, token)),
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          // The whole catalog's drop tables, cached: it is a few dozen rows and the picker needs
          // whichever boss you switch to next.
          apiFetch<DropTables>(DROPS_KEY, { method: "GET" }, withToken),
          // What stops a closed debt still reading as owed here. See V52.
          apiFetch<VestigeSettlement[]>(SETTLEMENTS_KEY, { method: "GET" }, withToken),
          apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, withToken).catch(() => null),
          apiFetch<PartyLootPool[]>(POOLS_KEY, { method: "GET" }, withToken).catch(() => null),
        ]);
      })
      .then(
        ([partyResult, , bossResult, dropResult, settlementResult, partiesResult, poolResult]) => {
          setParty(partyResult);
          setBosses(bossResult);
          setDropTables(dropResult);
          setSettlements(settlementResult);
          put(BOSSES_KEY, bossResult);
          put(DROPS_KEY, dropResult);
          put(SETTLEMENTS_KEY, settlementResult);
          if (partiesResult) {
            setParties(partiesResult);
            put(PARTIES_KEY, partiesResult);
          }
          if (poolResult) {
            setPools(poolResult);
            put(POOLS_KEY, poolResult);
          }
          setState("loaded");
          reportDataReady();
        },
      )
      .catch(() => setState("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, isLoaded]);

  // Every mutation refetches the pool rather than patching it in place: status is derived from the
  // sale and the payout rows server side, so the server's answer is the only one that is right.
  async function mutate(key: string, path: string, options: RequestInit) {
    setError(null);
    try {
      await write(key, async () => {
        await apiFetch<unknown>(path, options, getToken);
        // Past the write, so a refetch that fails leaves the screen behind and not the write undone.
        // Saying "That didn't save." about one is what got a drop logged twice. See StaleAfterWrite.
        await readBack(() => loadLoot(party!.id));
      });
    } catch (e) {
      if (e instanceof StaleAfterWrite) setError(SAVED_BUT_STALE);
      else setError(e instanceof ApiError ? e.body : "That didn't save.");
    }
  }

  // Keyed by the drop being written, so only that row is drawn as saving.
  const add = (body: AddLootBody) =>
    mutate(ADD_DROP, lootUrl(), { method: "POST", body: JSON.stringify(body) });
  const sell = (lootId: string, body: SellLootBody) =>
    mutate(lootId, `${lootUrl()}/${lootId}/sale`, { method: "PUT", body: JSON.stringify(body) });
  const unsell = (lootId: string) =>
    mutate(lootId, `${lootUrl()}/${lootId}/sale`, { method: "DELETE" });
  const setTaken = (lootId: string, memberId: string | null) =>
    mutate(lootId, `${lootUrl()}/${lootId}/taken`, {
      method: "PUT",
      body: JSON.stringify({ memberId }),
    });
  const setPaid = (lootId: string, memberId: string, paid: boolean) =>
    mutate(lootId, `${lootUrl()}/${lootId}/payouts/${memberId}`, {
      method: "PUT",
      body: JSON.stringify({ paid }),
    });
  const remove = (lootId: string) => mutate(lootId, `${lootUrl()}/${lootId}`, { method: "DELETE" });
  // Who bent down for which stack, on one night. The same route Party View's panel writes, so a
  // correction made here and one made there cannot come out differently.
  const setBundles = (lootId: string, bundles: Record<string, number>) =>
    mutate(lootId, `${lootUrl()}/${lootId}/bundles`, {
      method: "PUT",
      body: JSON.stringify({ bundles }),
    });

  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  // Counted from the rows on screen rather than from the party's stored counters, which were read
  // one request earlier and go stale the moment something here is marked paid.
  //
  // Through the Drop Log's own reading of them, the same as the card that links here. Counting
  // every PENDING row instead made this page disagree with that card about the same party: a
  // coupon row never sells, so it was pending for ever here while the card left it out.
  const closed = closedByHolder(settlements).closed;
  // Built over every party, not just this one. A tranche answers a person rather than a night, so
  // what is left of it for this party's nights is only knowable against all of them: reading this
  // party alone would spend the whole budget here and report a debt smaller than it is.
  //
  // This party's own rows come from `loot`, which is refetched after every write here. The list in
  // `pools` was read on load and is a write behind by then.
  const everyPool = party
    ? [{ partyId: party.id, loot }, ...pools.filter((pool) => pool.partyId !== party.id)]
    : pools;
  const everyParty = party ? [party, ...parties.filter((p) => p.id !== party.id)] : parties;
  const log = party ? buildDropLog(everyParty, everyPool, dropTables, closed) : null;
  /** This party's own rows, which is what every figure below is about. */
  const mine = log?.entries.filter((entry) => entry.partyId === party?.id) ?? [];
  // What each coupon row says it is: a piece drop is PENDING for ever, because it never sells through
  // its own row, so the raw status read "In the pool" on every vestige stack this party ever dropped.
  // The same reading Party View's panels use, from the same place.
  const pieceStatus = party ? pieceStatusByParty(mine).get(party.id) : undefined;
  /**
   * What each seat was entitled to out of this party's coupon nights, and what they picked up.
   *
   * The gap between the two IS the debt the line above states, and until this was here the page
   * gave the figure with nothing behind it: "20 coupons owed" over a list of nights that each
   * looked the same. Both halves, per night, because neither follows from the other.
   *
   * The WHOLE pool, unlike Party View's, which is a row about one week. This page is where a debt
   * older than tonight is gone through, so narrowing it would hide the night being asked about.
   *
   * The night's pickup is correctable behind the pool's own Edit, and a SETTLED night is not: its
   * books are closed and the figures behind them have been paid against. The standing split carries
   * no onSave at all, because it is the party's rather than this pool's and belongs to its editor.
   */
  const stacks = (() => {
    if (!party) return undefined;
    const config = shareConfig(
      dropTables[party.bossKey],
      party.difficulty,
      party.worldType,
      VESTIGE,
      party.members,
    );
    if (!config) return undefined;
    return {
      dropKey: VESTIGE,
      config,
      entitledTitle: "Entitled each week",
      // See the pickup's own note: this page reckons a night against nothing rather than against
      // the account-wide balance Party View has in hand.
      behind: new Map<string, number>(),
      pickup: {
        // Not "Looted this week": these rows are the whole pool, and most of them are not this week.
        title: "Looted",
        // The odd stack rotates against every party's nights at once, which is the Party View
        // reckoning. Empty here opens an unanswered night's boxes on the balanced split instead of
        // on whoever is furthest behind account-wide: a worse first guess, never a stored one, and
        // nothing is written until the button is pressed.
        drops: assignableDrops(party, loot, {
          dropKey: VESTIGE,
          tradeable: true,
          behind: new Map<string, number>(),
        }),
        // Off the ledger's own notion of finished, which is the settlements and not this party's
        // arrangement. Same reading the row's "Settled" label comes from, so a night cannot be
        // history in one place and a box to type in two lines below it.
        locked: new Set(mine.filter((entry) => entry.closed).map((entry) => entry.lootId)),
        onSave: setBundles,
      },
    };
  })();

  /**
   * Who picked up which stacks of the rotating piece, over this party's whole pool.
   *
   * The write the rotation reads, and nothing else on the account produces one: the Drop Ledger
   * leaves pieces out, and the coupon's boxes only ever covered the coupon.
   *
   * Its own block for the reason Party View's is: `stacks` needs a coupon config, and Chaos Kalos
   * and Normal Kaling rotate a piece while dropping no coupon at all.
   *
   * The whole pool, unlike Party View's week, so a night older than tonight can still be answered.
   * That is what seeds a rotation nobody has ever recorded a week of.
   */
  const piecePickup = (() => {
    if (!party) return undefined;
    const drop = rotatingDrops(party, dropTables)[0];
    if (!drop) return undefined;
    const mode = party.difficulty ?? "";
    const rotation = rotationFor(
      party,
      loot,
      drop,
      drop.pieces?.[party.worldType]?.[mode] ?? 0,
      drop.bundles?.[party.worldType]?.[mode] ?? 0,
    );
    if (!rotation) return undefined;
    return {
      title: "Looted",
      drops: assignableDrops(party, loot, {
        dropKey: drop.dropKey,
        tradeable: false,
        behind: behindByHolder(rotation),
      }),
      onSave: setBundles,
    };
  })();
  const summary = summarize(loot);
  const poolLine = poolLabel(
    {
      // The log's own reading, which leaves out a coupon drop already in the right inventories.
      // summarize still answers for the other two: it splits sold from paid out, which the log's
      // totals do not.
      //
      // Counted off THIS party's rows. `log.totals` is the whole account now that the log is built
      // over every party, and putting that on this page would say the account's pool is this one's.
      pendingLoot: log ? mine.filter(isOutstanding).length : summary.pending,
      awaitingPayout: summary.awaitingPayout,
      settledLoot: summary.settled,
    },
    (party && couponsOutstandingByParty(mine).get(party.id)) || NOTHING_OUTSTANDING,
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
            {/* The character, the boss and the mode. Not the roster.

              What a config IS, in the order the URL says it: the character and the boss are the two
              halves that can never be edited, and the mode belongs with them because the pool is
              filtered by it (see ranAtThisMode). Several of your characters can run the same boss,
              so without the name the title does not say which config this is.

              It used to read "Chaos Kalos the Guardian with iPhone69C", naming the roster as it
              stands today. The pool under it is a season of nights and who ran each is that night's
              own fact (party_week_seat, and ranSeats divides by it), so the title promised a list
              filtered by those members and delivered one filtered by the mode.

              The character leads rather than trails, so it cannot be read as one more member: the
              strip directly below lists the roster, and a name on the end of this line is exactly
              the ambiguity just taken out of it. */}
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
              {[
                ownMember(party)?.name,
                bossLabel(bossByKey.get(party.bossKey)?.name ?? party.bossKey, party.difficulty),
              ]
                .filter((part): part is string => Boolean(part))
                .join(" · ")}
            </h1>
            <div className="party-card-head">
              {/* Your own character among them, unlike the strips on Party View, which put it in the
                header and list only the others. Here it is one of the shares. */}
              <RosterStrip members={party.members} />
              {/* This config is off every list, so this page is the only one that can say so. It is
                still reachable, and it has to be: an old drop is sold and paid out from here. What
                the word is for is the picker below, which would otherwise divide tonight's drop by
                the roster above without anything saying the party had ended. */}
              {party.retired && <span className="party-card-retired">Retired</span>}
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
              stacks={stacks}
              piecePickup={piecePickup}
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
