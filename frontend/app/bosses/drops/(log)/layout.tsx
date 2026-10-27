"use client";

import { formatPieces } from "@/lib/piece-ledger";
import { DropLogSkeleton } from "@/components/drop-log-skeleton";
import { PageSwap } from "@/components/page-swap";
import { useAuth } from "@/lib/use-auth";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { LogDrop } from "@/components/log-drop";
import { PieceLedger } from "@/components/piece-ledger";
import { SaleCards } from "@/components/sale-cards";
import { DropLogHead } from "@/components/drop-log-head";
import { SettlementStage } from "@/components/settlement-stage";
import { StackArrangement } from "@/components/stack-arrangement";
import { SettledView } from "@/components/settled-view";
import { buildSettledLog, orphansOf, settledTotals } from "@/lib/settled-log";
import {
  SAVED_BUT_STALE,
  StaleAfterWrite,
  apiAssetUrl,
  apiBlob,
  apiFetch,
  readBack,
  failureText,
} from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { reportDataReady } from "@/lib/rum";
import { shadowCompare } from "@/lib/money-shadow";
import { decidedSales, splittableDebts, yourPiles } from "@/lib/settlement";
import {
  type HeldOfYours,
  heldOfYoursBy,
  owedByCreditor,
  outstandingOf,
  stillAsking,
  worthDrawing,
} from "@/lib/ledger-fates";
import { settlementView, VESTIGE, vestigeOf } from "@/lib/settlement-view";
import {
  DEBTS_KEY,
  PEOPLE_KEY,
  POOLS_KEY,
  TRANCHES_KEY,
  useDropLogWrites,
} from "@/lib/use-drop-log-writes";
import {
  dropSections,
  saleCards,
  sectionFromPath,
  cardFromQuery,
  cardAnchor,
  sectionHref,
  shownSection,
} from "@/lib/drop-sections";
import {
  buildDropLog,
  foldRuns,
  forBoss,
  forCharacter,
  groupDrops,
  type RunFold,
  type DropLine,
  consolidate,
  couponNote,
  dropStatusLabel,
  foldNames,
  foldStatus,
  lootIdsOf,
  removable,
  type DropEntry,
  type DropGroup,
  type Grouping,
} from "@/lib/drop-log";
import { ArmedRemove } from "@/components/settlement-ledger";
import { formatDropped } from "@/lib/loot";
import { saleQueues } from "@/lib/bulk-sale";
import { useDropIcons } from "@/lib/drop-icons";
import { useSeatSprites } from "@/lib/seat-sprites";
import { useAccountSettings } from "@/lib/use-account-settings";
import {
  type Holder,
  SELF_KEY,
  closedByHolder,
  couponMoney,
  holderKey,
  paymentsSinceClosing,
  stillOpen,
  runningBalance,
  unanswered,
} from "@/lib/vestige-ledger";
import { showsMoney } from "@/lib/world";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { AddLootBody, Loot, LogDropBody, PartyLootPool } from "@/types/loot";
import type { DropLogPage, SharedBook } from "@/types/page";
import { SharedCards, type SharedWrites } from "@/components/shared-cards";
import { OthersSales } from "@/components/others-sales";
import { splitByLogger } from "@/lib/sale-logger";
import { useLive } from "@/lib/use-live";
import { sharedCard } from "@/lib/shared-book";
import { loggedTwice, withoutLoot } from "@/lib/duplicate-runs";
import { sharedHistory } from "@/lib/shared-history";
import { sharedPile } from "@/lib/shared-pile";
import type { ListingKit } from "@/components/settlement-listing";
import { figuresToReport, LISTINGS_KEY } from "@/lib/settlement-listings";
import type { SettlementListing } from "@/types/settlement-listing";
import type { Party, Person, SaveSharesBody } from "@/types/party";
import type {
  CorrectVestigeTrancheBody,
  ProceedsDisposal,
  SettlementDebt,
  VestigePayment,
  VestigeSettlement,
  VestigeTranche,
  VestigeTrancheShare,
} from "@/types/vestige";

// The history of what dropped, and what it made, and where a drop is logged. Every meso is
// lib/drop-log.ts's, which is splitOf()'s, which is splitDrop()'s. Nothing here adds anything up.

type LoadState = "loading" | "loaded" | "error";

// Every read below, in one request. The individual keys stay: they name the cache entries other
// pages seed from, and the resources this composes. See types/page.ts.
const PAGE_KEY = "/api/pages/drop-log";
// Other owners' books, cut to what they say about you. See lib/shared-book.ts.
const SHARED_KEY = "/api/pages/shared-books";
// How long the figures must sit still before they are reported. A sale's read-back lands in parts.
const FIGURES_SETTLE_MS = 1500;

// Solo pools included, and retired configs too: both hold drops whose configs are off every list,
// and buildDropLog skips a pool whose config it cannot find, so without these the log would quietly
// be missing them. Every page that reads a pool as a ledger asks the same, Party View included, or
// the two disagree about one debt. See partiesFor and drop-log-callers.test.ts.
const PARTIES_KEY = "/api/parties?solo=include&retired=include";
const BOSSES_KEY = "/api/bosses";
const DROPS_KEY = "/api/bosses/drops";
const CHARACTERS_KEY = "/api/characters";

/**
 * Offsets this tab has already tried to split, so a remount does not start one again.
 *
 * Module scope on purpose: see the comment on its use. A second tab has its own, which is why the
 * server refuses a share that is already discharged rather than trusting this.
 */
const SPLIT_ATTEMPTED = new Set<string>();

/**
 * The layout every stage's page sits in, so moving between them keeps what is loaded. The pages
 * themselves draw nothing: the stage is read off the path.
 */
export default function DropLog({ children }: { children: ReactNode }) {
  const { getToken, isLoaded } = useAuth();
  // This page sums across every party the server hands back, which is one world's. In a Heroic
  // world the money tiles would be three true zeroes, so they go, and so do the three stages that
  // only exist because something changed hands. See lib/drop-sections.ts.
  const trades = useAccountSettings()?.trades;
  const money = showsMoney(trades);

  const [parties, setParties] = useState<Party[]>(peek<Party[]>(PARTIES_KEY) ?? []);
  const [pools, setPools] = useState<PartyLootPool[]>([]);
  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [dropTables, setDropTables] = useState<DropTables>(peek<DropTables>(DROPS_KEY) ?? {});
  const [characters, setCharacters] = useState<Character[]>(
    peek<Character[]>(CHARACTERS_KEY) ?? [],
  );
  const [tranches, setTranches] = useState<VestigeTranche[]>([]);
  const [payments, setPayments] = useState<VestigePayment[]>([]);
  const [settlements, setSettlements] = useState<VestigeSettlement[]>([]);
  const [debts, setDebts] = useState<SettlementDebt[]>([]);
  const [disposals, setDisposals] = useState<ProceedsDisposal[]>([]);
  const [sharedBooks, setSharedBooks] = useState<SharedBook[]>([]);
  const [listings, setListings] = useState<SettlementListing[]>([]);
  const [people, setPeople] = useState<Person[]>(peek<Person[]>(PEOPLE_KEY) ?? []);

  // A drop names the party it fell in and links to it, which draws its seats. See
  // lib/seat-sprites.ts.
  useSeatSprites(parties);
  // The Add Drop form's own picker draws them. See lib/drop-icons.ts.
  useDropIcons(dropTables);
  const [state, setState] = useState<LoadState>("loading");
  const [character, setCharacter] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<Grouping>("month");
  const [boss, setBoss] = useState<string | null>(null);
  const router = useRouter();
  const section = sectionFromPath(usePathname()) ?? "drops";
  // A notification's View Settlement asks for one card. The route boundary in loading.tsx is the
  // Suspense this needs to prerender.
  const askedCard = cardFromQuery(useSearchParams().toString());
  const [error, setError] = useState<string | null>(null);
  // Every write the Sales and Settlement stages make, each patching the lists it moved. See
  // lib/use-drop-log-writes.ts.
  const writes = useDropLogWrites(getToken, (patch) => {
    if (patch.pools) setPools(patch.pools);
    if (patch.tranches) setTranches(patch.tranches);
    if (patch.payments) setPayments(patch.payments);
    if (patch.settlements) setSettlements(patch.settlements);
    if (patch.debts) setDebts(patch.debts);
    if (patch.disposals) setDisposals(patch.disposals);
    if (patch.people) setPeople(patch.people);
  });
  const { busy } = writes;

  /**
   * Writes into another owner's book, which is shared between the two of you (V88). Read back with
   * the whole page, since the book arrives through the shared books and not through your own lists.
   */
  const sharedWrites: SharedWrites = {
    busy,
    add: (personId, kind, amount, note) =>
      writes.track(async () => {
        await apiFetch<unknown>(
          `/api/shared-books/${encodeURIComponent(personId)}/${kind}`,
          { method: "POST", body: JSON.stringify({ amount, note: note || undefined }) },
          getToken,
        );
        await readBack(load);
      }),
    remove: (personId, kind, id) =>
      writes.track(async () => {
        await apiFetch<unknown>(
          `/api/shared-books/${encodeURIComponent(personId)}/${kind}/${encodeURIComponent(id)}`,
          { method: "DELETE" },
          getToken,
        );
        await readBack(load);
      }),
    // One press settling the pair both ways, in the owner's book and in one transaction. See
    // SharedBookRoutes.kt closeShared, which holds a member to shares of their own seats.
    close: (personId, kind, pots) =>
      writes.track(async () => {
        await apiFetch<unknown>(
          `/api/shared-books/${encodeURIComponent(personId)}/close/${kind === "OFFSET" ? "offset" : "sent"}`,
          { method: "POST", body: JSON.stringify(pots) },
          getToken,
        );
        await readBack(load);
      }),
  };

  /**
   * Every read this page needs, in one request. See types/page.ts for why it is one.
   *
   * Also the refetch after a write, so a write reads back the whole screen rather than the seven
   * lists the pools happen to touch. That is a request more honest than what it replaced: a sale
   * moves debts and disposals as well as pools.
   */
  async function load(token?: string | null) {
    const withToken = token !== undefined ? () => Promise.resolve(token) : getToken;
    const [page, books, posted] = await Promise.all([
      apiFetch<DropLogPage>(PAGE_KEY, { method: "GET" }, withToken),
      // Additive: a failure leaves out the other owners' cards and nothing of your own.
      apiFetch<SharedBook[]>(SHARED_KEY, { method: "GET" }, withToken).catch(() => []),
      // Additive too: a failure draws no listings, never a stale one.
      apiFetch<SettlementListing[]>(LISTINGS_KEY, { method: "GET" }, withToken).catch(() => []),
    ]);
    setSharedBooks(books);
    setListings(posted);

    setParties(page.parties);
    setPools(page.pools);
    setTranches(page.tranches);
    setPayments(page.payments);
    setSettlements(page.settlements);
    setDebts(page.debts);
    setDisposals(page.disposals);
    setBosses(page.bosses);
    setDropTables(page.drops);
    setCharacters(page.characters);
    setPeople(page.people);

    // The keys other pages seed from on their way in. Only the ones that were cached before, since
    // a key nobody peeks at is a payload kept alive for nothing.
    put(PARTIES_KEY, page.parties);
    put(BOSSES_KEY, page.bosses);
    put(DROPS_KEY, page.drops);
    put(CHARACTERS_KEY, page.characters);
    put(PEOPLE_KEY, page.people);
    return { page, books };
  }

  useEffect(() => {
    // Not before auth answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    // One token, one request. getToken() can round-trip to auth, so it is spent once either way.
    getToken()
      .then((token) => load(token))
      .then(({ page, books }) => {
        setState("loaded");
        reportDataReady();
        shadowCompare(page, books, getToken);
      })
      // The pools are never cached, so there is nothing to fall back to. One request also means
      // one outcome: the people list used to be allowed to fail on its own (it only NAMES a card),
      // and there is no longer a separate failure for it to have.
      .catch(() => setState("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  // To the asked card once it is drawn, and once per ask, so a refetch does not pull the page back.
  const scrolledTo = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (state !== "loaded" || section !== "settlement" || !askedCard) return;
    if (scrolledTo.current === askedCard) return;
    const card = document.getElementById(cardAnchor(askedCard));
    if (!card) return;
    scrolledTo.current = askedCard;
    card.scrollIntoView({ block: "start" });
  }, [state, section, askedCard]);

  /**
   * Logs the drop, then reads the log back.
   *
   * Both lists, not just the pools: a drop on a boss run alone opens a config for it, and without
   * that config the drop has no seats to be read against and would not appear at all.
   *
   * A coupon night with its split on screen goes to that party's own pool instead (see LogDrop).
   */
  async function logDrop(path: string, body: LogDropBody | AddLootBody) {
    setError(null);
    await writes.track(async () => {
      try {
        await apiFetch<unknown>(path, { method: "POST", body: JSON.stringify(body) }, getToken);
        // Past the POST the drop is in, whatever the read-back does. See StaleAfterWrite.
        await readBack(load);
      } catch (e) {
        // Not rethrown when the write landed: the throw is what keeps the picker loaded, and a picker
        // still loaded under the word "didn't save" is how the same drop was logged twice.
        if (e instanceof StaleAfterWrite) {
          setError(SAVED_BUT_STALE);
          return;
        }
        setError(failureText(e, "That didn't save. Try again."));
        throw e;
      }
    });
  }

  /** The party's standing coupon split, saved from the Add Drop form. Throws for the boxes to show. */
  async function saveShares(party: Party, shares: Map<string, number>) {
    await writes.track(async () => {
      await apiFetch<Party>(
        `/api/parties/${party.id}/shares`,
        {
          method: "PUT",
          body: JSON.stringify({ shares: Object.fromEntries(shares) } satisfies SaveSharesBody),
        },
        getToken,
      );
      await readBack(load);
    });
  }

  /**
   * Records who picked up which stacks of one drop.
   *
   * Answers with the pools rather than the row, for the same reason a tranche does: naming the
   * arrangement turns a drop nobody could be paid for into one that owes somebody, and every other
   * boss in that holder's queue is re-priced behind it.
   */
  async function bundlesWrite(partyId: string, lootId: string, bundles: Record<string, number>) {
    await writes.track(async () => {
      await apiFetch<Loot>(
        `/api/parties/${partyId}/loot/${lootId}/bundles`,
        { method: "PUT", body: JSON.stringify({ bundles }) },
        getToken,
      );
      setPools(await apiFetch<PartyLootPool[]>(POOLS_KEY, {}, getToken));
      // A night in somebody else's party arrives through the shared books, read with the page.
      if (!pools.some((pool) => pool.partyId === partyId)) await load();
    });
  }

  // A sale into somebody else's pool is read back with the whole page: the writes above refresh
  // your own pools, and theirs arrive through the shared books.
  const saleWrites = {
    ...writes,
    bulkSale: async (body: Parameters<typeof writes.bulkSale>[0]) => {
      await writes.bulkSale(body);
      await load().catch(() => {});
    },
    rowSale: async (...args: Parameters<typeof writes.rowSale>) => {
      await writes.rowSale(...args);
      await load().catch(() => {});
    },
    rowRemove: async (...args: Parameters<typeof writes.rowRemove>) => {
      await writes.rowRemove(...args);
      await load().catch(() => {});
    },
  };
  // Your own pools only: a drop in somebody else's book is theirs to remove.
  const ownLoot = lootIdsOf(pools);
  // A drop logged or sold by anybody in a party of yours, on screen without a reload.
  useLive(["loot", "settlement", "party"], () => load().catch(() => {}));

  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  const characterById = new Map(characters.map((c) => [c.id, c]));
  // Roster order, as /api/characters returns it (Characters.position). The same list the party
  // arrangements are ordered by, so one character sits in the same place on both screens.
  const characterOrder = characters.map((c) => c.id);
  // The ledger reads the WHOLE account, not the filtered log. A pile is one person's, spanning
  // every boss any of their characters loots for, so showing the part of it that falls in the
  // chosen month would price those bosses off a fraction of the sales that paid for them.
  // Other owners' books from your side, so a drop you ran in their party is in your log and your
  // settled record. Read-only: nothing below that writes is handed these.
  const shared = sharedHistory(sharedBooks);
  // A run in both your party and theirs counts once, as the owner's copy. Yours of it counts nowhere.
  const twice = loggedTwice(
    { parties, pools },
    {
      ...shared,
      ownerOf: new Map(sharedBooks.flatMap((b) => b.parties.map((p) => [p.id, b.ownerName]))),
    },
  );
  const counted = withoutLoot(pools, twice);
  const view = settlementView({
    parties,
    pools: counted,
    bosses,
    people,
    tranches,
    payments,
    settlements,
    debts,
    disposals,
  });
  const { closures, settled, ledgers, holderNames, offsetShares, credits } = view;
  const logParties = [...parties, ...shared.parties];
  const logPools = [...counted, ...shared.pools];
  const closedInLog = new Set([...closures.closed, ...closedByHolder(shared.settlements).closed]);
  // The whole log is kept alongside the filtered one so the toolbar does not come and go: which
  // controls exist is a property of the account, not of what the filter currently leaves.
  // With the tranches, so a night whose coupons you already sold is not asked for in coupons as
  // well as in money. The same subtraction the Settlement Ledger makes below. See V56.
  const whole = buildDropLog(logParties, logPools, dropTables, closedInLog);
  const log = forBoss(forCharacter(whole, character), boss);
  const { totals } = log;
  const groups = groupDrops(log.entries, grouping).map((group) => ({
    group,
    lines: consolidate(group.entries, characterOrder),
  }));

  // Only characters that actually have drops. A filter offering a name with nothing behind it
  // reads as a bug the first time it is picked.
  const withDrops = characters.filter((c) =>
    logParties.some(
      (p) => p.characterId === c.id && logPools.some((pool) => pool.partyId === p.id),
    ),
  );
  // The same for bosses, off the whole log so picking a character does not take bosses away.
  const loggedBosses = new Set(whole.entries.map((e) => e.bossKey));
  const bossesWithDrops = bosses.filter((b) => loggedBosses.has(b.bossKey));

  const partyById = new Map(parties.map((p) => [p.id, p]));
  /**
   * Offsets written before #514 as one entry over several shares, recorded as the rows they were.
   *
   * No control and nothing to press: they are not a decision anybody is making now, they are the
   * same act in the shape it should have been written in, and asking somebody to click through their
   * own history one entry at a time is asking them to do the migration by hand.
   *
   * `splittableDebts` refuses unless the shares reconstruct the entry EXACTLY, so a night that has
   * been deleted or a roster that has moved leaves the entry alone rather than rewriting it into rows
   * that do not add up. It also refuses while the pools are still arriving, which is what makes
   * running this on every render safe, and where another entry already names one of the shares, which
   * is a split whose rows landed and whose delete did not.
   */
  const pendingSplits = splittableDebts(debts, offsetShares);
  // Once per entry per TAB, set BEFORE the first write. The old entry is still splittable between its
  // rows landing and its own delete, so without this the next render would write them again.
  //
  // Module scope, not a ref: a ref is recreated when the component remounts, and StrictMode remounts
  // it on purpose. That is how one night got recorded twice. The second pass came back with a fresh
  // guard AND the debts the page had first fetched, so it could not see the row the first pass had
  // already written. Nothing here can be the last word on it, because two tabs share neither: the
  // index in V68 is. See splittableDebts.
  const splitKey = pendingSplits.map((s) => s.debt.id).join(",");
  useEffect(() => {
    const todo = pendingSplits.filter((s) => !SPLIT_ATTEMPTED.has(s.debt.id));
    if (todo.length === 0) return;
    for (const s of todo) SPLIT_ATTEMPTED.add(s.debt.id);
    void (async () => {
      for (const { debt, parts } of todo) {
        // The rows FIRST, the entry they replace last. A failure part way then counts the offset
        // twice, which is visible on the card and undone with an ×. The other order loses the act
        // and its payout links with nothing left to rebuild them from.
        //
        // Each row carries the ORIGINAL date, so this does not move a history entry to today. See
        // AddSettlementDebtRequest.incurredAt.
        for (const part of parts) {
          await writes.debtWrite(DEBTS_KEY, {
            method: "POST",
            body: JSON.stringify({
              holder: debt.holder,
              amount: -part.amount,
              note: debt.note ?? undefined,
              payouts: [{ lootId: part.lootId, memberId: part.memberId }],
              incurredAt: debt.incurredAt,
            }),
          });
        }
        await writes.debtWrite(`${DEBTS_KEY}/${debt.id}`, { method: "DELETE" });
      }
    })();
    // Keyed by WHICH entries are splittable, not by the arrays: `offsetShares` and `pendingSplits`
    // are rebuilt every render, so depending on them would re-enter on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitKey]);

  // What is finished. Off the WHOLE log rather than the filtered one, for the reason the ledgers
  // above are: this is the account's record, and a month's slice of it is not one.
  const settledRows = buildSettledLog(
    whole.entries,
    [...settlements, ...shared.settlements],
    new Map([...holderNames, ...shared.names]),
  );
  // The coupon lots with it: a coupon night has no one price, so its money arrives whole from the
  // tranche ledger or the view is every sale but the vestiges. See SettledTotals.pooled.
  const settledCounts = settledTotals(settledRows, couponMoney(tranches));
  const settledOrphans = orphansOf(whole.entries, [...settlements, ...shared.settlements]);
  // With the nights you logged in somebody else's party: whoever logged a night arranges it (see
  // stacksRefusal), and the shared books are where those arrive, from when you were linked.
  const yoursToArrange = shared.pools.map((pool) => ({
    ...pool,
    loot: pool.loot.filter((loot) => loot.recordedByYou === true),
  }));
  const open = unanswered(
    [...parties, ...shared.parties],
    [...counted, ...yoursToArrange],
    VESTIGE,
  );
  // Only the drops still open tilt the rotation: a debt that has been closed was compensated, so it
  // has no business suggesting against the same person forever. See V52.
  const behind = runningBalance(stillOpen(settled, closures.closed));
  const tranchesByHolder = new Map<string, VestigeTranche[]>();
  for (const tranche of tranches) {
    const key = holderKey(tranche.holder);
    tranchesByHolder.set(key, [...(tranchesByHolder.get(key) ?? []), tranche]);
  }
  // Split by the same line the money is netted against, so a receipt a closure already spent is
  // never a row in the arithmetic that no longer counts it. See Receipts.
  const paymentsByHolder = paymentsSinceClosing(payments, settlements);
  // Which sales are finished, which is the ones somebody has been paid out or offset for. The same
  // match the Settlement Ledger's discharge rows are drawn from, so one sale cannot be settled on
  // one screen and pending on the other. See decidedSales.
  const decided = decidedSales(credits, disposals);
  // The Sale Ledger is piles you can sell out of, which is yours. What somebody else owes is the
  // Settlement Ledger's to say, and only its, so the two never give two answers.
  //
  // A sale that is FINISHED does not hold a card open. It is off the card itself (see stillAsking),
  // so counting it here would keep a pile on the worklist to draw nothing on it.
  const recorded = (key: string) => {
    const receipts = paymentsByHolder.get(key);
    return (
      stillAsking(tranchesByHolder.get(key) ?? [], decided).length > 0 ||
      (receipts?.counted.length ?? 0) > 0 ||
      (receipts?.spent.length ?? 0) > 0
    );
  };
  const yours = yourPiles(ledgers);
  // What the OTHER piles are holding of yours, so your own pile's debt reads as what changes hands:
  // owing Owen 90 while he holds 20 of yours is 70. Netted per creditor, never across people. See owes.
  const heldOfYours = heldOfYoursBy(ledgers);
  // Of your own piles, the ones with something to answer. A pile that owes nobody is not drawn at
  // all: it is a count with no question on it, and this tab is the list of what is still open.
  const { drawn } = worthDrawing(yours, recorded, heldOfYours);
  // A pile held by somebody who signs in, which they sell from their own Sales tab (sharedPile).
  // Listed here read-only, netted the same way their card nets it: what they hold of yours less
  // what your pile owes them.
  const linkedKeys = new Set(people.flatMap((p) => (p.linked ? [`person:${p.id}`] : [])));
  const ownPile = yours[0];
  const theirPiles = ledgers
    .filter((ledger) => !ledger.closed && linkedKeys.has(holderKey(ledger.holder)))
    .map((ledger) => {
      const key = holderKey(ledger.holder);
      const owedThem = ownPile
        ? (owedByCreditor(ownPile).find((c) => c.key === key)?.pieces ?? 0)
        : 0;
      const held: HeldOfYours = new Map(owedThem > 0 ? [[SELF_KEY, owedThem]] : []);
      return { ledger, heldOfYours: held };
    })
    .filter((pile) => outstandingOf(pile.ledger, pile.heldOfYours) > 0);
  // The piles of interchangeable drops waiting to be priced. Yours: a lot is filed against the seat
  // that sold it, and only your own seats are ones you can name as seller. A partner's pile stays on
  // its rows, where each names its own seller.
  // Every pool you ran in, other owners' included, cut by who logged each drop: that is who sells it.
  // Yours go to the forms, the rest are listed. See lib/sale-logger.ts.
  const byLogger = splitByLogger(logPools);
  const { bulk, alone } = saleQueues(logParties, byLogger.yours, dropTables, SELF_KEY);
  const othersLog = saleQueues(logParties, byLogger.theirs, dropTables, SELF_KEY);
  const loggedByOthers = [...othersLog.bulk.flatMap((lot) => lot.queue), ...othersLog.alone];
  // The drops that price alone (an accessory, a hammer, a ring) come with them: yours for the same
  // reason a lot is, and one card each, because a queue of them could only guess which copy went.
  // Whether the sale boxes will draw anything, which decides with the coupon piles whether there is
  // an Outstanding Sales section at all. A heading over no cards is a heading over nothing.
  const anythingToPrice = money && (bulk.length > 0 || alone.length > 0);
  const vestigeIcon = vestigeOf(dropTables)?.iconUrl ?? null;
  const coupon = { iconUrl: vestigeIcon, name: vestigeOf(dropTables)?.name ?? null };

  const sections = dropSections(trades);
  const shown = shownSection(section, sections);
  // A stage this world does not carry, from a link or a toggle to Heroic while standing on one.
  useEffect(() => {
    if (shown !== section) router.replace(sectionHref(shown));
  }, [shown, section, router]);
  /**
   * Everything a pile card takes but the piles themselves.
   *
   * Two lists draw from it: the piles worth drawing, and a held-back one the reader asked for. Same
   * card either way, in a different place on the page, so the wiring cannot drift between them.
   */
  const pileCard = {
    heldOfYours,
    tranches: tranchesByHolder,
    decided,
    bossByKey,
    partyById,
    iconUrl: vestigeIcon,
    busy,
    // `shares` says how many of the pieces were somebody else's, so their part of what this lot
    // fetched lands on the Settlement Ledger. Empty is the whole sale being your own, which is every
    // tranche entered before V56. See saleCredits.
    onAddSale: (holder: Holder, pieces: number, amount: number, shares: VestigeTrancheShare[]) =>
      writes.saleWrite(TRANCHES_KEY, {
        method: "POST",
        body: JSON.stringify({ holder, pieces, amount, disposition: "SOLD", shares }),
      }),
    // No amount: a redemption realized nothing, where a sale for zero would price those pieces at
    // nothing. The server refuses the two disagreeing. See V46.
    onAddKept: (holder: Holder, pieces: number) =>
      writes.saleWrite(TRANCHES_KEY, {
        method: "POST",
        body: JSON.stringify({ holder, pieces, disposition: "KEPT" }),
      }),
    // Pieces of yours they took instead of selling, at a price somebody agreed. An amount like a
    // sale, and off the pile like a redemption. See V50.
    //
    // Shares like a sale too: whose coupons were taken is what puts the agreed price on their card,
    // and without it the pieces left the pile owing nobody. See V56.
    onAddBought: (holder: Holder, pieces: number, amount: number, shares: VestigeTrancheShare[]) =>
      writes.saleWrite(TRANCHES_KEY, {
        method: "POST",
        body: JSON.stringify({ holder, pieces, amount, disposition: "BOUGHT", shares }),
      }),
    onRemoveSale: (trancheId: string) =>
      writes.saleWrite(`${TRANCHES_KEY}/${trancheId}`, { method: "DELETE" }),
    onCorrectSale: (trancheId: string, amount: number) =>
      writes.saleWrite(`${TRANCHES_KEY}/${trancheId}/amount`, {
        method: "PUT",
        body: JSON.stringify({ amount } satisfies CorrectVestigeTrancheBody),
      }),
  };
  // Your pile in each book you share, drawn with the same card and written into THAT book: a coupon
  // sale out of it is the owner's ledger's row, which both of you read. See lib/shared-pile.ts.
  const sharedCards = sharedBooks.flatMap((book) => sharedCard(book, bosses) ?? []);
  const sharedPiles = sharedBooks
    .flatMap((book) => sharedPile(book, bosses) ?? [])
    .filter((pile) => outstandingOf(pile.ledger, pile.heldOfYours) > 0);

  // What every linked card holds, reported as it is drawn: the backend deletes a listing posted for
  // any other amount, and tells the payee when the payer's figure moves. Only once loaded and
  // between writes, so a figure from a write that has half landed is never reported.
  const figures =
    state === "loaded"
      ? figuresToReport(
          view.settlement,
          people.flatMap((person) => (person.linked ? [person.id] : [])),
          sharedCards,
        )
      : [];
  const figuresKey = JSON.stringify(figures);
  useEffect(() => {
    if (!isLoaded) return;
    if (busy || figures.length === 0) return;
    const timer = setTimeout(() => {
      apiFetch<SettlementListing[]>(
        `${LISTINGS_KEY}/figures`,
        { method: "POST", body: JSON.stringify({ figures }) },
        getToken,
      )
        .then(setListings)
        .catch(() => {});
    }, FIGURES_SETTLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [figuresKey, busy, isLoaded]);
  const listingKit: ListingKit = {
    listings,
    busy,
    post: (personId, amount, image) =>
      writes.track(async () => {
        setListings(
          await apiFetch<SettlementListing[]>(
            `${LISTINGS_KEY}/cards/${encodeURIComponent(personId)}?amount=${amount}`,
            { method: "POST", body: image, headers: { "Content-Type": image.type } },
            getToken,
          ),
        );
      }),
    remove: (id) =>
      writes.track(async () => {
        setListings(
          await apiFetch<SettlementListing[]>(
            `${LISTINGS_KEY}/${encodeURIComponent(id)}`,
            { method: "DELETE" },
            getToken,
          ),
        );
      }),
    image: (id) => apiBlob(`${LISTINGS_KEY}/${encodeURIComponent(id)}/image`, getToken),
  };
  const intoBook = (personId: string, path: string, init: RequestInit) =>
    writes.track(async () => {
      await apiFetch<unknown>(
        `/api/shared-books/${encodeURIComponent(personId)}/${path}`,
        init,
        getToken,
      );
      await readBack(load);
    });
  const tranche = (body: object): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
  // Whether either ledger has anything on it, which is what decides between its cards and one line
  // saying there are none. All three stages are always offered. See lib/drop-sections.ts.
  const hasSales =
    saleCards({
      unanswered: open.length,
      holders: drawn.length + sharedPiles.length + theirPiles.length,
      bulk: money ? bulk.length : 0,
      rows: money ? alone.length : 0,
    }) > 0;

  return (
    <main className="page">
      <DropLogHead />

      {state === "error" && <p>Couldn&apos;t load your drops. Reload to try again.</p>}
      {/* The page's own shape, not a line of text where a page will be. See DropLogSkeleton. */}
      <PageSwap waiting={state === "loading"} placeholder={<DropLogSkeleton />} shaped>
        {state === "loaded" && (
          <>
            {shown === "drops" && (
              <>
                {/* First on the tab, because it is what the tab is for. Nothing to log against with
                  no roster, and a picker of nobody is not worth holding the space for. */}
                {characters.length > 0 && (
                  <LogDrop
                    characters={characters}
                    bosses={bosses}
                    parties={parties}
                    dropTables={dropTables}
                    behind={behind}
                    busy={busy}
                    onLog={(body) => logDrop("/api/parties/loot", body)}
                    onLogToParty={(party, body) => logDrop(`/api/parties/${party.id}/loot`, body)}
                    onSaveShares={saveShares}
                  />
                )}
                {error && <p className="split-error">{error}</p>}

                {/* The count of drops stood here, in the last tile of a row that once held three.
                  The money tiles went to the Settled View when this page stopped stating a meso,
                  and the count has followed them: one tile in a three-up grid is two thirds of
                  nothing, and the list below already says what fell. */}

                {whole.totals.drops > 0 && (
                  <div className="party-toolbar">
                    {withDrops.length > 1 && (
                      <label className="droplog-filter">
                        <span className="stat-label">Character</span>
                        <select
                          className="split-input"
                          value={character ?? ""}
                          onChange={(e) => setCharacter(e.target.value || null)}
                        >
                          <option value="">All Characters</option>
                          {withDrops.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    {bossesWithDrops.length > 1 && (
                      <label className="droplog-filter">
                        <span className="stat-label">Boss</span>
                        <select
                          className="split-input"
                          value={boss ?? ""}
                          onChange={(e) => setBoss(e.target.value || null)}
                        >
                          <option value="">All Bosses</option>
                          {bossesWithDrops.map((b) => (
                            <option key={b.bossKey} value={b.bossKey}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    <label className="droplog-filter">
                      <span className="stat-label">Group</span>
                      <select
                        className="split-input"
                        value={grouping}
                        onChange={(e) => setGrouping(e.target.value as Grouping)}
                      >
                        <option value="month">Month</option>
                        <option value="week">Week</option>
                      </select>
                    </label>
                  </div>
                )}

                {/* The form to fix it is directly above, so this says what is here and nothing else. */}
                {whole.totals.drops === 0 && <p className="finder-empty">No drops yet. Add one.</p>}
                {/* Each filter only offers what has drops, but a character and a boss can still
                  have none in common. */}
                {whole.totals.drops > 0 && totals.drops === 0 && (
                  <p className="finder-empty">No matching drops.</p>
                )}

                {groups.map(({ group, lines }) => (
                  <GroupSection
                    key={group.key}
                    group={group}
                    lines={lines}
                    bossByKey={bossByKey}
                    characterById={characterById}
                    showCharacter={character === null}
                    own={ownLoot}
                    busy={writes.busy}
                    onRemove={saleWrites.rowRemove}
                  />
                ))}

                {twice.size > 0 && (
                  <ul className="ledger-notes">
                    {[...Map.groupBy(twice.values(), (owner) => owner)].map(([owner, rows]) => (
                      <li key={owner}>
                        {rows.length} {rows.length === 1 ? "drop" : "drops"} also in {owner}&apos;s
                        party, counted there.
                      </li>
                    ))}
                  </ul>
                )}

                {/* A split that cannot be read is money missing from a total, so it is said where the
                  totals are, which is the Settled View. Said here it named an absence from figures
                  this tab no longer states. */}
              </>
            )}

            {shown === "sales" && (
              <>
                {!hasSales && <p className="party-hint">No sales to record.</p>}
                {/* One heading over every card that takes a sale, which is the bulk sales AND the coupon
                  piles: both are "sold N for X". Titling only one of them said the other was a
                  statement rather than an entry. No rule under it either, because what follows is
                  more of the same thing and there is nothing there to divide. */}
                {/* Gated on what will actually draw, not on there being ledgers at all: a pile held
                  back for owing nobody leaves the heading standing over nothing. */}
                {(anythingToPrice ||
                  drawn.length > 0 ||
                  sharedPiles.length > 0 ||
                  theirPiles.length > 0) && (
                  <section className="loot-pool">
                    <h2 className="loot-pool-title">Outstanding Sales</h2>

                    {/* Only where there is money to talk about. A Heroic-only account trades nothing,
                      and both lists leave those pools out anyway. */}
                    {money && (
                      <SaleCards
                        page={{ parties: logParties, bosses, characters }}
                        bulk={bulk}
                        alone={alone}
                        writes={saleWrites}
                      />
                    )}

                    <PieceLedger ledgers={drawn} {...pileCard} />
                    {sharedPiles.map((pile) => (
                      <PieceLedger
                        key={pile.personId}
                        ledgers={[pile.ledger]}
                        yours
                        heldOfYours={pile.heldOfYours}
                        tranches={pile.tranches}
                        decided={pile.decided}
                        bossByKey={bossByKey}
                        partyById={new Map(logParties.map((p) => [p.id, p]))}
                        iconUrl={vestigeIcon}
                        busy={busy}
                        // The holder is the book's to set: always your person row in it.
                        onAddSale={(_holder, pieces, amount, shares) =>
                          intoBook(
                            pile.personId,
                            "tranches",
                            tranche({ pieces, amount, disposition: "SOLD", shares }),
                          )
                        }
                        onAddKept={(_holder, pieces) =>
                          intoBook(
                            pile.personId,
                            "tranches",
                            tranche({ pieces, disposition: "KEPT" }),
                          )
                        }
                        onAddBought={(_holder, pieces, amount, shares) =>
                          intoBook(
                            pile.personId,
                            "tranches",
                            tranche({ pieces, amount, disposition: "BOUGHT", shares }),
                          )
                        }
                        onRemoveSale={(id) =>
                          intoBook(pile.personId, `tranches/${encodeURIComponent(id)}`, {
                            method: "DELETE",
                          })
                        }
                      />
                    ))}
                    {theirPiles.map((pile) => (
                      <PieceLedger
                        key={holderKey(pile.ledger.holder)}
                        ledgers={[pile.ledger]}
                        heldOfYours={pile.heldOfYours}
                        tranches={tranchesByHolder}
                        decided={decided}
                        bossByKey={bossByKey}
                        partyById={new Map(logParties.map((p) => [p.id, p]))}
                        iconUrl={vestigeIcon}
                        busy={busy}
                      />
                    ))}
                  </section>
                )}

                <OthersSales
                  rows={money ? loggedByOthers : []}
                  bossByKey={bossByKey}
                  partyById={new Map(logParties.map((p) => [p.id, p]))}
                />

                {/* Last, and the one real boundary on this tab: every card above takes a sale, and this
                  one cannot be acted on for money at all. It names the nights whose arrangement
                  nobody has said, and nothing about them can be priced until somebody does. Still on
                  screen, because a drop that owes somebody and cannot say who is exactly what must
                  not be quietly dropped. */}
                <StackArrangement
                  drops={open}
                  partyById={partyById}
                  bossByKey={bossByKey}
                  behind={behind}
                  iconUrl={vestigeIcon}
                  busy={busy}
                  onSave={bundlesWrite}
                />
              </>
            )}

            {shown === "settlement" && (
              <SettlementStage
                page={{
                  parties,
                  bosses,
                  people,
                  tranches,
                  payments,
                  settlements,
                  drops: dropTables,
                }}
                view={view}
                writes={writes}
                sharedOwners={sharedBooks.flatMap((book) => book.ownerPersonId ?? [])}
                sharedCards={sharedCards}
                onShared={sharedWrites.add}
                listings={listingKit}
              />
            )}

            {shown === "settlement" && (
              <SharedCards
                cards={sharedCards}
                writes={sharedWrites}
                coupon={coupon}
                listings={listingKit}
              />
            )}

            {/* The end of the pipeline, and it only runs one way: nothing here is waiting on
              anybody, and nothing here can be taken back.

              A Reopen used to sit on every row and it undid HALF of a settlement. Closing a coupon
              pair was ONE act that wrote one row per inventory (Settle Both Sides, since removed), so deleting one of
              them left a night shut in their pile and open in yours: a user hit it by accident and
              60 coupons reappeared on the Sale Ledger with the other side still closed. A button
              whose one effect is to half-undo a paired act is a trap however it is labelled, the same
              reason Settle came off a card with nothing to collect. A settlement filed against the
              wrong night is corrected against the database. */}
            {shown === "settled" && (
              <SettledView
                rows={settledRows}
                totals={settledCounts}
                // The whole log's own count, which the Drop Ledger used to head itself with. It
                // counts every drop rather than the settled ones, so its tile says so in its note.
                logged={totals}
                money={money}
                orphans={settledOrphans}
                bossByKey={bossByKey}
                partyById={new Map(logParties.map((p) => [p.id, p]))}
              />
            )}
          </>
        )}
      </PageSwap>
      {children}
    </main>
  );
}

/** One month or one week of the log. */
function GroupSection({
  group,
  lines,
  bossByKey,
  characterById,
  showCharacter,
  own,
  busy,
  onRemove,
}: {
  group: DropGroup;
  /** The group's rows, already consolidated by the page. */
  lines: DropLine[];
  bossByKey: Map<string, Boss>;
  characterById: Map<string, Character>;
  showCharacter: boolean;
  /** See `removable`. */
  own: Set<string>;
  busy: boolean;
  onRemove: (entry: DropEntry) => Promise<void>;
}) {
  return (
    <section className="party-group">
      {/* The month, and nothing else. What it came to is the Settled View's, which is where every
          other figure about a sale went. */}
      <header className="droplog-group-head">
        <h2 className="party-group-name">{group.label}</h2>
      </header>
      <ul className="droplog-list">
        {lines.map((line) => (
          <DropRow
            key={line.key}
            line={line}
            bossByKey={bossByKey}
            characterById={characterById}
            showCharacter={showCharacter}
            own={own}
            busy={busy}
            onRemove={onRemove}
          />
        ))}
      </ul>
    </section>
  );
}

function DropRow({
  line,
  bossByKey,
  characterById,
  showCharacter,
  own,
  busy,
  onRemove,
}: {
  line: DropLine;
  bossByKey: Map<string, Boss>;
  characterById: Map<string, Character>;
  showCharacter: boolean;
  own: Set<string>;
  busy: boolean;
  onRemove: (entry: DropEntry) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const entry = line.entries[0]!;
  const boss = bossByKey.get(entry.bossKey ?? "") ?? null;
  const characterName = characterById.get(entry.characterId)?.name ?? null;
  const panelId = `droplog-runs-${line.key}`;

  // A fold names the drop and how many of it are yours, and nothing else. Which bosses and which
  // characters were a summary of the rows under the chevron, said in a form ("3 bosses", "2
  // characters") that answers neither "which" nor "how many each": the rows themselves do both.
  // Who it was run with was never here, for a stronger reason: a roster belongs to one night, so the
  // union across a fold names a party that never ran.
  const meta = line.folded
    ? []
    : [
        boss?.name,
        showCharacter ? characterName : null,
        formatDropped(entry.droppedOn),
        couponNote(entry),
        // This row IS the run when it stands alone: one night, one roster, and no chevron under it
        // to say so instead.
        ranWith(entry.ranWith),
      ].filter(Boolean);

  const status = foldStatus(line.entries);
  const runs = `${line.entries.length} runs`;
  const folds = foldRuns(line.entries);
  // A level is only worth the chevron when there is more than one character to tell apart.
  const heads = folds.length > 1;

  return (
    <li className={`droplog-row status-${entry.status.toLowerCase()}${open ? " is-open" : ""}`}>
      <div className="droplog-row-head">
        {line.iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(line.iconUrl)} alt="" />
        ) : (
          // No official art for this drop. An empty frame keeps the row aligned with the ones that
          // have it, as the loot pool does.
          <span className="loot-icon" aria-hidden="true" />
        )}

        <span className="droplog-title">
          <span className="droplog-name-line">
            {/* A fold's pieces came off several runs, so its name links to none of them: it would
                open whichever run happened to be first, which is one out of eleven. The runs below
                carry the links. What it has instead is the chevron. */}
            {line.folded ? (
              <>
                <span className="loot-name">
                  {line.name}
                  <span className="loot-count"> ×{formatPieces(line.yours)}</span>
                </span>
                <button
                  type="button"
                  className="party-row-toggle"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setOpen((o) => !o)}
                >
                  <span className="party-row-chevron" aria-hidden="true" />
                  <span className="visually-hidden">{open ? `Hide ${runs}` : `Show ${runs}`}</span>
                </button>
              </>
            ) : (
              // The drop's own history, not its party's: this row IS one drop, and the party it fell
              // in is every drop that boss ever gave you. The way back to the party is on that page.
              <Link href={`/bosses/drops/${entry.lootId}`} className="loot-name">
                {line.name}
                {line.yours > 1 && <span className="loot-count"> ×{formatPieces(line.yours)}</span>}
              </Link>
            )}
          </span>
          {/* A fold says none of this, so the element is not drawn empty either. */}
          {meta.length > 0 && <span className="loot-meta">{meta.join(" · ")}</span>}
        </span>

        <Stage label={status} statusClass={entry.status.toLowerCase()} />
        {/* A fold is several drops, so only a row that is one drop can be removed from here. */}
        {!line.folded && removable(entry, own) && (
          <ArmedRemove
            label={`Remove ${line.name}`}
            busy={busy}
            onRemove={() => {
              setRefusal(null);
              onRemove(entry).catch((e) =>
                setRefusal(failureText(e, "That didn't remove. Try again.")),
              );
            }}
          />
        )}
      </div>
      {refusal && <span className="split-error">{refusal}</span>}

      {line.folded && open && (
        <ul className="droplog-runs" id={panelId}>
          {/* Whose they are first, and only then which nights. A week of five bosses on six
              characters is thirty rows, and what is asked of a coupon fold is how many each.
              Skipped where there is one character: a chevron onto a single group opens onto
              itself. */}
          {heads
            ? folds.map((fold) => (
                <RunGroup
                  key={fold.key}
                  fold={fold}
                  name={characterById.get(fold.key)?.name ?? "–"}
                  panelId={`${panelId}-${fold.key}`}
                  bossByKey={bossByKey}
                />
              ))
            : line.entries.map((e) => (
                <RunRow
                  key={e.lootId}
                  entry={e}
                  boss={bossByKey.get(e.bossKey ?? "") ?? null}
                  characterName={characterById.get(e.characterId)?.name ?? null}
                  showCharacter={showCharacter}
                />
              ))}
        </ul>
      )}
    </li>
  );
}

/** One character's share of a fold, opening onto the nights it came off. */
function RunGroup({
  fold,
  name,
  panelId,
  bossByKey,
}: {
  fold: RunFold;
  name: string;
  panelId: string;
  bossByKey: Map<string, Boss>;
}) {
  const [open, setOpen] = useState(false);
  const runs = `${fold.entries.length} runs`;

  return (
    <li className={`droplog-character${open ? " is-open" : ""}`}>
      <div className="droplog-character-head">
        {/* The same pairing the drop's own row uses, so a chevron sits the same distance from the
            name it opens at both levels. The name links nowhere: these runs are several parties,
            and picking one of them to be the destination is picking whichever happened to be
            first. The runs carry the links. */}
        <span className="droplog-name-line">
          <span className="loot-name">
            {name}
            <span className="loot-count"> ×{formatPieces(fold.yours)}</span>
          </span>
          <button
            type="button"
            className="party-row-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="party-row-chevron" aria-hidden="true" />
            <span className="visually-hidden">
              {open ? `Hide ${name}'s ${runs}` : `Show ${name}'s ${runs}`}
            </span>
          </button>
        </span>

        <Stage
          label={foldStatus(fold.entries)}
          statusClass={fold.entries[0]!.status.toLowerCase()}
        />
      </div>

      {open && (
        <ul className="droplog-runs is-nested" id={panelId}>
          {fold.entries.map((e) => (
            <RunRow
              key={e.lootId}
              entry={e}
              boss={bossByKey.get(e.bossKey ?? "") ?? null}
              characterName={name}
              // Named by the row above, so a run under it would be saying it a second time.
              showCharacter={false}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** One row behind a fold: the run it came off, and the way into that party. */
function RunRow({
  entry,
  boss,
  characterName,
  showCharacter,
}: {
  entry: DropEntry;
  boss: Boss | null;
  characterName: string | null;
  showCharacter: boolean;
}) {
  const label = boss?.name ?? formatDropped(entry.droppedOn);
  const meta = [
    // Not said twice: where the label IS the date, there is no date left to put here.
    label === formatDropped(entry.droppedOn) ? null : formatDropped(entry.droppedOn),
    showCharacter ? characterName : null,
    couponNote(entry),
    // Per run, because the roster is the WEEK's: a fold spanning two months is two rosters, and the
    // line above can only name their union.
    ranWith(entry.ranWith),
  ].filter(Boolean);

  return (
    <li className="droplog-run">
      {/* No portrait: the drop's own icon is on the line above, and a second column of art told
          nobody which run this was that the boss name did not already say. */}
      {/* One run is one drop, so it opens that drop. See DropRow. */}
      <Link href={`/bosses/drops/${entry.lootId}`} className="loot-name">
        {/* The drop is named by the line above, so the run is named by its boss. Every run says its
            own, including a fold whose runs all came off one: the line above no longer names it,
            and eleven Kalos rows saying Kalos is the price of not asking the reader to remember it.
            The date is what is left where there is no boss. */}
        {label}
        {/* Yours, the same as the line above sums. Counting what fell here made a fold of 440
            open onto runs adding up to 900. */}
        {entry.yours > 1 && <span className="loot-count"> ×{formatPieces(entry.yours)}</span>}
      </Link>
      <span className="loot-meta">{meta.join(" · ")}</span>
      <Stage label={dropStatusLabel(entry)} statusClass={entry.status.toLowerCase()} />
    </li>
  );
}

/**
 * Who the drop was run with, as the meta says it.
 *
 * Past three the names become a count. Six of them ran the row wider than the page, and which six
 * is a question the party behind the link answers; that there were six is the one the row can.
 * Never an empty string: a solo names nobody and gets no segment at all.
 */
function ranWith(names: string[]): string | null {
  const said = foldNames(names, "others");
  return said === null ? null : `with ${said}`;
}

/**
 * The right of a line or a run: how far down the pipeline it has got.
 *
 * What it SOLD for used to be here, and it is the Settled View's now, per row and in the total. This
 * ledger is the first of four stages and says what fell; a figure here was the last stage's answer
 * printed on the first stage's list. See lib/drop-sections.ts.
 */
function Stage({ label, statusClass }: { label: string; statusClass: string }) {
  return (
    <span className="droplog-amounts">
      <span className={`loot-status is-${statusClass}`}>{label}</span>
    </span>
  );
}
