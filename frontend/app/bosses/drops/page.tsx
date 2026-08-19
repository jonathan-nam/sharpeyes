"use client";

import { DropLogSkeleton } from "@/components/drop-log-skeleton";
import { PageSwap } from "@/components/page-swap";
import { useAuth } from "@/lib/use-auth";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AddSettlement } from "@/components/add-settlement";
import { SettlementLedger } from "@/components/settlement-ledger";
import { SettlementSummary } from "@/components/settlement-summary";
import { LogDrop } from "@/components/log-drop";
import { LotSale } from "@/components/lot-sale";
import { PieceLedger } from "@/components/piece-ledger";
import { StackArrangement } from "@/components/stack-arrangement";
import { SettledView } from "@/components/settled-view";
import { buildSettledLog, orphansOf, settledTotals } from "@/lib/settled-log";
import {
  ApiError,
  SAVED_BUT_STALE,
  StaleAfterWrite,
  apiAssetUrl,
  apiFetch,
  readBack,
} from "@/lib/api";
import { bossLabel } from "@/lib/boss-difficulty";
import { peek, put } from "@/lib/cache";
import {
  type OffsetShare,
  buildSettlement,
  decidedSales,
  keptOfYours,
  settlementTotals,
  shareKey,
  yourPiles,
} from "@/lib/settlement";
import { heldOfYoursBy, stillAsking, worthDrawing } from "@/lib/ledger-fates";
import { buildWallet } from "@/lib/wallet";
import { type DropSectionKey, dropSections, saleCards, shownSection } from "@/lib/drop-sections";
import {
  buildDropLog,
  isUntradeablePiece,
  foldRuns,
  forCharacter,
  groupDrops,
  type RunAxis,
  type RunFold,
  type DropLine,
  consolidate,
  dropStatusLabel,
  foldNames,
  foldStatus,
  type DropEntry,
  type DropGroup,
  type Grouping,
} from "@/lib/drop-log";
import { formatDropped, splitOf } from "@/lib/loot";
import { type LotSaleBody, fungibleDropKeys, lotDrops } from "@/lib/lot-sale";
import { useDropIcons } from "@/lib/drop-icons";
import { useSeatSprites } from "@/lib/seat-sprites";
import { useAccountSettings } from "@/lib/use-account-settings";
import {
  type Holder,
  SELF_HOLDER,
  SELF_KEY,
  alsoHeldByYou,
  couponMoney,
  answeredByHolder,
  answeredByPair,
  boughtByHolder,
  foldSeats,
  holderKey,
  holderLedgers,
  closedByHolder,
  keptByHolder,
  outstanding,
  receivedByHolder,
  receivedSinceClosing,
  saleCredits,
  stillOpen,
  runningBalance,
  salesByHolder,
  unanswered,
} from "@/lib/vestige-ledger";
import { showsMoney } from "@/lib/world";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { Loot, LogDropBody, PartyLootPool, SettleBody } from "@/types/loot";
import type { Party, Person } from "@/types/party";
import type {
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

// Solo pools included, and retired configs too, which only the wallet also asks for: both hold
// drops whose configs are off every list, and buildDropLog skips a pool whose config it cannot
// find, so without these the log would quietly be missing them. See partiesFor.
const PARTIES_KEY = "/api/parties?solo=include&retired=include";
const POOLS_KEY = "/api/parties/loot";
// The Wallet's settle, reused rather than reimplemented: one act, one endpoint, one set of rows.
const SETTLE_KEY = "/api/parties/loot/settle";
const BOSSES_KEY = "/api/bosses";
const DROPS_KEY = "/api/bosses/drops";
const CHARACTERS_KEY = "/api/characters";
const TRANCHES_KEY = "/api/vestige-tranches";
const PAYMENTS_KEY = "/api/vestige-payments";
const SETTLEMENTS_KEY = "/api/vestige-settlements";
const DEBTS_KEY = "/api/settlement-debts";
const DISPOSALS_KEY = "/api/proceeds-disposals";
const PEOPLE_KEY = "/api/people";

// The stacking drop the piece ledger is for. One key, because one item behaves this way: a boss
// drops it in bundles that do not divide by looting alone. See lib/piece-ledger.ts.
const VESTIGE = "vestige-of-erion";

export default function DropLogPage() {
  const { getToken } = useAuth();
  // This page sums across every party the server hands back, which is one world's. In a Heroic
  // world the money tiles would be three true zeroes, so they go.
  const money = showsMoney(useAccountSettings()?.trades);

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
  const [people, setPeople] = useState<Person[]>(peek<Person[]>(PEOPLE_KEY) ?? []);

  // A drop names the party it fell in and links to it, which draws its seats. See
  // lib/seat-sprites.ts.
  useSeatSprites(parties);
  // The Add Drop form's own picker draws them. See lib/drop-icons.ts.
  useDropIcons(dropTables);
  const [state, setState] = useState<LoadState>("loading");
  const [character, setCharacter] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<Grouping>("month");
  const [runAxis, setRunAxis] = useState<RunAxis>("character");
  // Whether the reader has asked for the box that sells out of a pile nobody is owed anything from.
  const [sellingOwn, setSellingOwn] = useState(false);
  const [section, setSection] = useState<DropSectionKey>("drops");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(token?: string | null) {
    const withToken = token !== undefined ? () => Promise.resolve(token) : getToken;
    const [
      partyResult,
      poolResult,
      trancheResult,
      paymentResult,
      settlementResult,
      debtResult,
      disposalResult,
    ] = await Promise.all([
      apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, withToken),
      apiFetch<PartyLootPool[]>(POOLS_KEY, { method: "GET" }, withToken),
      apiFetch<VestigeTranche[]>(TRANCHES_KEY, { method: "GET" }, withToken),
      apiFetch<VestigePayment[]>(PAYMENTS_KEY, { method: "GET" }, withToken),
      apiFetch<VestigeSettlement[]>(SETTLEMENTS_KEY, { method: "GET" }, withToken),
      apiFetch<SettlementDebt[]>(DEBTS_KEY, { method: "GET" }, withToken),
      apiFetch<ProceedsDisposal[]>(DISPOSALS_KEY, { method: "GET" }, withToken),
    ]);
    setParties(partyResult);
    setPools(poolResult);
    setTranches(trancheResult);
    setPayments(paymentResult);
    setSettlements(settlementResult);
    setDebts(debtResult);
    setDisposals(disposalResult);
    put(PARTIES_KEY, partyResult);
  }

  useEffect(() => {
    // One token for the whole burst: getToken() can round-trip to auth.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          load(token),
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          // The whole catalog's drop tables, as the party page fetches them: a few dozen rows, and
          // the picker needs whichever boss is chosen next.
          apiFetch<DropTables>(DROPS_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          // Only to NAME a card. A person owed something whose seat has since left every party is
          // still owed it, and without this their card is titled with their id.
          apiFetch<Person[]>(PEOPLE_KEY, { method: "GET" }, withToken).catch(() => null),
        ]);
      })
      .then(([, bossResult, dropResult, characterResult, peopleResult]) => {
        setBosses(bossResult);
        setDropTables(dropResult);
        setCharacters(characterResult);
        if (peopleResult) {
          setPeople(peopleResult);
          put(PEOPLE_KEY, peopleResult);
        }
        put(BOSSES_KEY, bossResult);
        put(DROPS_KEY, dropResult);
        put(CHARACTERS_KEY, characterResult);
        setState("loaded");
      })
      // The pools are never cached, so there is nothing to fall back to.
      .catch(() => setState("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Logs the drop, then reads the log back.
   *
   * Both lists, not just the pools: a drop on a boss run alone opens a config for it, and without
   * that config the drop has no seats to be read against and would not appear at all.
   */
  async function logDrop(body: LogDropBody) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch<unknown>(
        "/api/parties/loot",
        { method: "POST", body: JSON.stringify(body) },
        getToken,
      );
      // Past the POST the drop is in, whatever the read-back does. See StaleAfterWrite.
      await readBack(load);
    } catch (e) {
      // Not rethrown when the write landed: the throw is what keeps the picker loaded, and a picker
      // still loaded under the word "didn't save" is how the same drop was logged twice.
      if (e instanceof StaleAfterWrite) {
        setError(SAVED_BUT_STALE);
        return;
      }
      setError(e instanceof ApiError ? e.body : "That didn't save.");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Records one tranche, or removes one.
   *
   * Both answer with the whole tally rather than the row touched, because the queue is re-spent
   * from all of it: a sale entered now can be what covers a boss cleared in July, and redrawing
   * from one row would be guessing at where its pieces landed.
   */
  async function saleWrite(path: string, options: RequestInit) {
    setBusy(true);
    try {
      setTranches(await apiFetch<VestigeTranche[]>(path, options, getToken));
    } catch (e) {
      // Thrown on, not shown here: the card that asked for it is a screen away from this page's
      // error line, and a refusal nobody is looking at is a refusal that did not happen.
      throw new Error(e instanceof ApiError ? e.body : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  /** The same, for closing a pile's books. See V52. */
  async function settlementWrite(path: string, options: RequestInit) {
    setBusy(true);
    try {
      setSettlements(await apiFetch<VestigeSettlement[]>(path, options, getToken));
    } catch (e) {
      throw new Error(e instanceof ApiError ? e.body : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Marks a person's unpaid SHARES paid, which is the other half of a settlement.
   *
   * The Wallet's own act, against the same payout rows, rather than a second way to mark a share
   * paid: two of those would disagree the first time one of them was changed. Answers with the
   * pools, so the rows redraw from what the server wrote.
   */
  async function settleShares(payouts: { lootId: string; memberId: string }[]) {
    if (payouts.length === 0) return;
    setBusy(true);
    try {
      const body: SettleBody = { payouts };
      setPools(
        await apiFetch<PartyLootPool[]>(
          SETTLE_KEY,
          { method: "POST", body: JSON.stringify(body) },
          getToken,
        ),
      );
    } catch (e) {
      throw new Error(e instanceof ApiError ? e.body : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  /** The same, for an entered debt. Its own state, because it touches no drop at all. See V56. */
  async function debtWrite(path: string, options: RequestInit) {
    setBusy(true);
    try {
      setDebts(await apiFetch<SettlementDebt[]>(path, options, getToken));
    } catch (e) {
      throw new Error(e instanceof ApiError ? e.body : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  /** The same, for deciding what became of money a sale of their coupons left you holding. See V61. */
  async function disposalWrite(path: string, options: RequestInit) {
    setBusy(true);
    try {
      setDisposals(await apiFetch<ProceedsDisposal[]>(path, options, getToken));
    } catch (e) {
      throw new Error(e instanceof ApiError ? e.body : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  /** The same, for a receipt. Its own state, because a payment changes no piece. See V51. */
  async function paymentWrite(path: string, options: RequestInit) {
    setBusy(true);
    try {
      setPayments(await apiFetch<VestigePayment[]>(path, options, getToken));
    } catch (e) {
      throw new Error(e instanceof ApiError ? e.body : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Prices a pile of one interchangeable drop across every pool it sits in.
   *
   * Answers with the pools, so the rows redraw from what the server actually wrote rather than from
   * the proposal that was confirmed. All of them or none: see lotSaleRoute.
   */
  async function lotSale(body: LotSaleBody) {
    setBusy(true);
    try {
      setPools(
        await apiFetch<PartyLootPool[]>(
          "/api/parties/loot/lot",
          { method: "POST", body: JSON.stringify(body) },
          getToken,
        ),
      );
    } catch (e) {
      // Thrown on rather than shown here, as a tranche is: the card that asked is what the reader
      // is looking at, and this page's error line is a screen away from it.
      throw new Error(e instanceof ApiError ? e.body : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Records who picked up which stacks of one drop.
   *
   * Answers with the pools rather than the row, for the same reason a tranche does: naming the
   * arrangement turns a drop nobody could be paid for into one that owes somebody, and every other
   * boss in that holder's queue is re-priced behind it.
   */
  async function bundlesWrite(partyId: string, lootId: string, bundles: Record<string, number>) {
    setBusy(true);
    try {
      await apiFetch<Loot>(
        `/api/parties/${partyId}/loot/${lootId}/bundles`,
        { method: "PUT", body: JSON.stringify({ bundles }) },
        getToken,
      );
      setPools(await apiFetch<PartyLootPool[]>(POOLS_KEY, {}, getToken));
    } catch (e) {
      throw new Error(e instanceof ApiError ? e.body : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  const characterById = new Map(characters.map((c) => [c.id, c]));
  // Roster order, as /api/characters returns it (Characters.position). The same list the party
  // arrangements are ordered by, so one character sits in the same place on both screens.
  const characterOrder = characters.map((c) => c.id);
  // The catalog's own order, which is what /api/bosses returns, so two bosses cleared in one week
  // never swap places in the queue and re-price each other. Shared with the fold that splits a
  // line's runs by boss, so a boss sits in the same place on both.
  const bossOrder = new Map(bosses.map((b, i) => [b.bossKey, i]));
  // The whole log is kept alongside the filtered one so the toolbar does not come and go: which
  // controls exist is a property of the account, not of what the filter currently leaves.
  const closures = closedByHolder(settlements);
  // Eternal pieces are left out of the log entirely. It is a history of what drops were WORTH and
  // who was paid, and a piece has no price, no sale and no settlement: it is settled by whose turn
  // it was to bend down, which the run says and this page cannot. They are still in the pool on
  // Party View, where the turn is answered for.
  const sellable = pools.map((pool) => ({
    ...pool,
    loot: pool.loot.filter((row) => !isUntradeablePiece(row, dropTables)),
  }));
  const whole = buildDropLog(parties, sellable, dropTables, closures.closed);
  const log = forCharacter(whole, character);
  const { totals } = log;
  // Lined here rather than inside each section, so the toolbar can ask whether anything folds at
  // all without consolidating the log a second time to find out.
  const groups = groupDrops(log.entries, grouping).map((group) => ({
    group,
    lines: consolidate(group.entries, characterOrder),
  }));
  const anyFolded = groups.some(({ lines }) => lines.some((l) => l.folded));

  // Only characters that actually have drops. A filter offering a name with nothing behind it
  // reads as a bug the first time it is picked.
  const withDrops = characters.filter((c) =>
    parties.some((p) => p.characterId === c.id && pools.some((pool) => pool.partyId === p.id)),
  );

  // The ledger reads the WHOLE account, not the filtered log. A pile is one person's, spanning
  // every boss any of their characters loots for, so showing the part of it that falls in the
  // chosen month would price those bosses off a fraction of the sales that paid for them.
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const settled = outstanding(parties, pools, VESTIGE, bossOrder);
  // Your own coupons from the nights that owed nobody anything, which the queue above leaves out.
  // They are yours to sell, so the card that takes a sale has to know you are holding them.
  const ledgers = holderLedgers(
    [...settled, ...alsoHeldByYou(parties, pools, VESTIGE, bossOrder, settled)],
    salesByHolder(tranches),
    keptByHolder(tranches),
    boughtByHolder(tranches),
    receivedByHolder(payments),
    closures,
    answeredByHolder(tranches),
    // The same pieces per creditor, which is what lets a night the sales already answered stay off
    // the queue when a later one is logged. See foldAnswered.
    answeredByPair(tranches),
  );
  // What other people owe you, in both units it can be owed in: pieces of yours they are holding,
  // and shares of a sale they made. Off the same two aggregations the ledger and the wallet already
  // run, so there is no third answer to keep in step.
  // Somebody a debt can name but no open drop does. Off the seats of every party, folded to their
  // people, which is the same fold every figure on this page is measured against.
  const holderNames = new Map<string, string>();
  // The people list first, so somebody who is owed something is named even after their seat has
  // left every party. Seats then win, because a seat carries the name as this account spells it.
  for (const person of people) holderNames.set(`person:${person.id}`, person.name);
  for (const party of parties) {
    for (const seat of foldSeats(party.seats)) holderNames.set(seat.key, seat.name);
  }
  const wallet = buildWallet(parties, pools);
  // The shares an offset discharged, resolved. Only the drops an offset actually names, because
  // splitting every loot row in every pool to answer for a handful would be a pass over the whole
  // account on every render.
  //
  // Off the pools, since an offset marks its shares PAID and they leave the wallet. See V58.
  const offsetShares = new Map<string, OffsetShare>();
  const wanted = new Set(debts.flatMap((d) => d.payouts.map((s) => s.lootId)));
  if (wanted.size > 0) {
    for (const pool of pools) {
      const party = partyById.get(pool.partyId);
      if (!party) continue;
      for (const loot of pool.loot) {
        if (!wanted.has(loot.id)) continue;
        const split = splitOf(loot, party.seats);
        if (split === null) continue;
        const boss = bossByKey.get(loot.bossKey ?? "");
        for (const share of split.shares) {
          offsetShares.set(shareKey(loot.id, share.memberId), {
            key: shareKey(loot.id, share.memberId),
            item: loot.name,
            iconUrl: loot.iconUrl,
            boss: boss ? bossLabel(boss.name, party.difficulty) : "Unknown boss",
            // Everybody the night paid out to, which is who was in it. Off the same split the share
            // came from, so the row cannot name a roster the figure was not divided by.
            members: split.shares.map((s) => s.name),
            on: loot.droppedOn,
            share: share.pay,
            sale: loot.saleAmount,
            partyId: pool.partyId,
          });
        }
      }
    }
  }
  // What sales of somebody else's coupons came to. Held rather than passed inline: the Sale Ledger's
  // fold reads the same figures, and two calls is two lists to fall out of step. See decidedSales.
  const credits = saleCredits(tranches);
  const settlement = buildSettlement(
    ledgers,
    wallet,
    debts,
    credits,
    // Only what no closure has already spoken for. A payment that settled a pile is spent, and
    // counting it again takes it off the next thing entered against that person. See #350.
    receivedSinceClosing(payments, settlements),
    holderNames,
    new Set(people.filter((p) => p.pinned).map((p) => `person:${p.id}`)),
    // The pieces a priced tranche already spoke for, per pair. `saleCredits` above is the money the
    // same rows came to, and passing one without the other is what had this card asking Bro for 130
    // coupons while the Sale Ledger, subtracting the 70 he had been sold, asked for 60.
    answeredByPair(tranches),
    // What has been decided about their money, and nothing more. An empty list means undecided,
    // which is the honest state for a sale nobody has said anything about. See V61.
    disposals,
  );
  // Nights that did not divide and that nobody has said the arrangement for. Above the ledger,
  // because until one is answered its pieces are missing from every figure below it.
  // The three tiles above the cards, off the cards themselves. See settlementTotals.
  const owedTotals = settlementTotals(settlement);
  // What is finished. Off the WHOLE log rather than the filtered one, for the reason the ledgers
  // above are: this is the account's record, and a month's slice of it is not one.
  const settledRows = buildSettledLog(whole.entries, settlements, holderNames);
  // The coupon lots with it: a coupon night has no one price, so its money arrives whole from the
  // tranche ledger or the view is every sale but the vestiges. See SettledTotals.pooled.
  const settledCounts = settledTotals(settledRows, couponMoney(tranches));
  const settledOrphans = orphansOf(whole.entries, settlements);
  const open = unanswered(parties, pools, VESTIGE);
  // Only the drops still open tilt the rotation: a debt that has been closed was compensated, so it
  // has no business suggesting against the same person forever. See V52.
  const behind = runningBalance(stillOpen(settled, closures.closed));
  const tranchesByHolder = new Map<string, VestigeTranche[]>();
  for (const tranche of tranches) {
    const key = holderKey(tranche.holder);
    tranchesByHolder.set(key, [...(tranchesByHolder.get(key) ?? []), tranche]);
  }
  const paymentsByHolder = new Map<string, VestigePayment[]>();
  for (const paid of payments) {
    const key = holderKey(paid.holder);
    paymentsByHolder.set(key, [...(paymentsByHolder.get(key) ?? []), paid]);
  }
  // Which sales are finished, which is the ones somebody has been paid out or offset for. The same
  // match the Settlement Ledger's discharge rows are drawn from, so one sale cannot be settled on
  // one screen and pending on the other. See decidedSales.
  const decided = decidedSales(credits, disposals);
  // The Sale Ledger is piles you can sell out of, which is yours. What somebody else owes is the
  // Settlement Ledger's to say, and only its, so the two never give two answers.
  //
  // A sale that is FINISHED does not hold a card open. It is off the card itself (see stillAsking),
  // so counting it here would keep a pile on the worklist to draw nothing on it.
  const recorded = (key: string) =>
    stillAsking(tranchesByHolder.get(key) ?? [], decided).length > 0 ||
    (paymentsByHolder.get(key)?.length ?? 0) > 0;
  const yours = yourPiles(ledgers);
  // What the OTHER piles are holding of yours, so your own pile's debt reads as what changes hands:
  // owing Bro 90 while he holds 20 of yours is 70. Netted per creditor, never across people. See owes.
  const heldOfYours = heldOfYoursBy(ledgers);
  // Of your own piles, the ones with something to answer. A pile that owes nobody is somewhere a sale
  // may be recorded and nothing else, so it waits behind the control that offers exactly that rather
  // than standing on screen with a count and no question.
  const { drawn, quiet } = worthDrawing(yours, recorded, heldOfYours);
  // A held-back pile, once asked for. Drawn where the control that asked for it stood, not folded in
  // above with the rest: appended there, a click at the foot of the page made a card appear further
  // up it and took away the thing that was clicked, and nothing on screen tied the two together.
  const revealed = sellingOwn ? quiet : [];
  // The piles of interchangeable drops waiting to be priced. Yours: a lot is filed against the seat
  // that sold it, and only your own seats are ones you can name as seller. A partner's pile stays on
  // its rows, where each names its own seller.
  const lots = lotDrops(parties, pools, fungibleDropKeys(dropTables), SELF_KEY);
  // Whether the lot boxes will draw anything, which decides with the coupon piles whether there is a
  // Record Sale section at all. A heading over no cards is a heading over nothing.
  const sellableLots = money && lots.length > 0;
  // The coupon's sprite, off whichever boss table carries it. Every table names the same drop.
  const vestigeIcon =
    Object.values(dropTables)
      .flat()
      .find((drop) => drop.dropKey === VESTIGE)?.iconUrl ?? null;

  // What fell, and what it was sold for, one at a time. Both halves are entered into rather than
  // read, so they stay on one page: a drop and the sale that prices it are the same evening's work.
  // See lib/drop-sections.ts for why the chosen tab is not drawn straight from state.
  const sections = dropSections();
  const shown = shownSection(section, sections);
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
      saleWrite(TRANCHES_KEY, {
        method: "POST",
        body: JSON.stringify({ holder, pieces, amount, disposition: "SOLD", shares }),
      }),
    // No amount: a redemption realized nothing, where a sale for zero would price those pieces at
    // nothing. The server refuses the two disagreeing. See V46.
    onAddKept: (holder: Holder, pieces: number) =>
      saleWrite(TRANCHES_KEY, {
        method: "POST",
        body: JSON.stringify({ holder, pieces, disposition: "KEPT" }),
      }),
    // Pieces of yours they took instead of selling, at a price somebody agreed. An amount like a
    // sale, and off the pile like a redemption. See V50.
    //
    // Shares like a sale too: whose coupons were taken is what puts the agreed price on their card,
    // and without it the pieces left the pile owing nobody. See V56.
    onAddBought: (holder: Holder, pieces: number, amount: number, shares: VestigeTrancheShare[]) =>
      saleWrite(TRANCHES_KEY, {
        method: "POST",
        body: JSON.stringify({ holder, pieces, amount, disposition: "BOUGHT", shares }),
      }),
    onRemoveSale: (trancheId: string) =>
      saleWrite(`${TRANCHES_KEY}/${trancheId}`, { method: "DELETE" }),
  };
  // Whether either ledger has anything on it, which is what decides between its cards and one line
  // saying there are none. All three tabs are always offered. See lib/drop-sections.ts.
  const hasSales =
    saleCards({
      unanswered: open.length,
      holders: drawn.length + revealed.length,
      lots: money ? lots.length : 0,
    }) > 0;

  return (
    <main className="page">
      <h1 className="page-title">Drop Log</h1>

      {state === "error" && <p>Couldn&apos;t load your drops.</p>}
      {/* The page's own shape, not a line of text where a page will be. See DropLogSkeleton. */}
      <PageSwap waiting={state === "loading"} placeholder={<DropLogSkeleton />} shaped>
        {state === "loaded" && (
          <>
            {sections.length > 1 && (
              <div className="basis-row droplog-sections" role="group" aria-label="Section">
                {sections.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className={shown === s.key ? "basis-tab active" : "basis-tab"}
                    aria-pressed={shown === s.key}
                    onClick={() => setSection(s.key)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            {shown === "drops" && (
              <>
                {/* First on the tab, because it is what the tab is for. Nothing to log against with
                  no roster, and a picker of nobody is not worth holding the space for. */}
                {characters.length > 0 && (
                  <LogDrop
                    characters={characters}
                    bosses={bosses}
                    dropTables={dropTables}
                    busy={busy}
                    onLog={logDrop}
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
                          <option value="">All characters</option>
                          {withDrops.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    {/* Only where something folds. Nothing else on the page has runs behind it, so
                      offered over a log of one-off drops it is a control that reorders nothing. */}
                    {anyFolded && (
                      <label className="droplog-filter">
                        <span className="stat-label">Runs by</span>
                        <select
                          className="split-input"
                          value={runAxis}
                          onChange={(e) => setRunAxis(e.target.value as RunAxis)}
                        >
                          <option value="character">Character</option>
                          <option value="boss">Boss</option>
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
                {totals.drops === 0 && <p className="finder-empty">No drops logged yet.</p>}

                {groups.map(({ group, lines }) => (
                  <GroupSection
                    key={group.key}
                    group={group}
                    lines={lines}
                    bossByKey={bossByKey}
                    characterById={characterById}
                    bossOrder={bossOrder}
                    runAxis={runAxis}
                    showCharacter={character === null}
                  />
                ))}

                {/* A split that cannot be read is money missing from a total, so it is said where the
                  totals are, which is the Settled View. Said here it named an absence from figures
                  this tab no longer states. */}
              </>
            )}

            {shown === "sales" && (
              <>
                {!hasSales && <p className="party-hint">No sales to record.</p>}
                {/* One heading over every card that takes a sale, which is the lot boxes AND the coupon
                  piles: both are "sold N for X". Titling only one of them said the other was a
                  statement rather than an entry. No rule under it either, because what follows is
                  more of the same thing and there is nothing there to divide. */}
                {/* Gated on what will actually draw, not on there being ledgers at all: a pile held
                  back for owing nobody leaves the heading standing over nothing. */}
                {(sellableLots || drawn.length > 0) && (
                  <section className="loot-pool">
                    <h2 className="loot-pool-title">Record Sale</h2>

                    {/* Only where there is money to talk about. A Heroic-only account trades nothing,
                      and lotDrops leaves those pools out anyway. */}
                    {money && (
                      <LotSale
                        drops={lots}
                        bossByKey={bossByKey}
                        partyById={partyById}
                        busy={busy}
                        onSell={lotSale}
                      />
                    )}

                    <PieceLedger ledgers={drawn} {...pileCard} />
                  </section>
                )}

                {/* The way back to a pile that owes nobody, and then the pile itself, in the one slot.
                  Holding coupons is not a task, so it is not a card until it is asked for, but they
                  are still yours to sell and a ledger that will not admit you hold them cannot take
                  the sale. After the cards rather than above them: it is the way to one more of the
                  same, not a heading over them.

                  The card replaces the control that asked for it. Somewhere else on the page it was
                  a pile of coupons appearing for no stated reason, which is how a reader ends up
                  asking what they just recorded. It focuses its own count box for the same reason. */}
                {quiet.length > 0 &&
                  (sellingOwn ? (
                    <PieceLedger ledgers={revealed} {...pileCard} forEntry />
                  ) : (
                    <button
                      type="button"
                      className="party-save"
                      onClick={() => setSellingOwn(true)}
                    >
                      Record a sale
                    </button>
                  ))}

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
              <section className="loot-pool">
                <h2 className="loot-pool-title">Record Settlement</h2>

                <SettlementSummary rows={settlement} totals={owedTotals} />

                <SettlementLedger
                  rows={settlement}
                  bossByKey={bossByKey}
                  partyById={partyById}
                  offsetShares={offsetShares}
                  iconUrl={vestigeIcon}
                  busy={busy}
                  // Every payment, not only the ones counted since closing: these are the rows as
                  // typed, and one entered against a closed boss is still one somebody may need back.
                  payments={paymentsByHolder}
                  onAddPayment={(holder: Holder, amount, note) =>
                    paymentWrite(PAYMENTS_KEY, {
                      method: "POST",
                      body: JSON.stringify({ holder, amount, note: note || undefined }),
                    })
                  }
                  onRemovePayment={(paymentId) =>
                    paymentWrite(`${PAYMENTS_KEY}/${paymentId}`, { method: "DELETE" })
                  }
                  onAddDebt={(holder: Holder, amount, note) =>
                    debtWrite(DEBTS_KEY, {
                      method: "POST",
                      body: JSON.stringify({ holder, amount, note: note || undefined }),
                    })
                  }
                  onRemoveDebt={(debtId) =>
                    debtWrite(`${DEBTS_KEY}/${debtId}`, { method: "DELETE" })
                  }
                  // Their pile, their purchase: they are keeping coupons that were yours and paying
                  // for them. V50's act with the sides swapped, which is why it needs no new shape.
                  // The tranche prices the pieces (they stop being a count) and puts the money on
                  // this card as `soldOfYours`, which comes off what you owe them.
                  //
                  // An ACT and never a netting. Their coupons only come off your debt if they agree
                  // to that, and they may want the mesos instead.
                  keptRows={keptOfYours(tranches)}
                  // What becomes of their money you are holding. An ACT, because the two things it
                  // can be end in different places and only the two of you can say which. See V61.
                  onDisposeProceeds={(holder: Holder, amount, kind) =>
                    disposalWrite(DISPOSALS_KEY, {
                      method: "POST",
                      body: JSON.stringify({ holder, amount, kind }),
                    })
                  }
                  onRemoveDisposal={(disposalId) =>
                    disposalWrite(`${DISPOSALS_KEY}/${disposalId}`, { method: "DELETE" })
                  }
                  onKeepPieces={(holder: Holder, pieces, amount) =>
                    saleWrite(TRANCHES_KEY, {
                      method: "POST",
                      body: JSON.stringify({
                        holder,
                        pieces,
                        amount,
                        disposition: "BOUGHT",
                        shares: [{ holder: SELF_HOLDER, pieces }],
                      }),
                    })
                  }
                  onRemoveKeep={(trancheId) =>
                    saleWrite(`${TRANCHES_KEY}/${trancheId}`, { method: "DELETE" })
                  }
                  // Two acts, because a closure is one PILE's decision and the pair has two piles:
                  // their nights close against them, yours against you. One button, since one
                  // handover finishes both and closing a single side is what put the figure UP.
                  //
                  // Sequential, not parallel: each answers with the whole list and the last answer
                  // wins, so racing them would redraw the card from whichever landed second.
                  onSettlePair={async (holder: Holder, theirs, yours) => {
                    if (theirs.length > 0) {
                      await settlementWrite(SETTLEMENTS_KEY, {
                        method: "POST",
                        // Nothing written off: a piece debt was never priced, so there is no
                        // shortfall to record. What they sent is on the receipts.
                        body: JSON.stringify({ holder, lootIds: theirs, unpaid: 0 }),
                      });
                    }
                    if (yours.length > 0) {
                      await settlementWrite(SETTLEMENTS_KEY, {
                        method: "POST",
                        body: JSON.stringify({ holder: SELF_HOLDER, lootIds: yours, unpaid: 0 }),
                      });
                    }
                  }}
                  onSettleShares={settleShares}
                  // Answers with the whole people list, like every other write on this page, so the
                  // pins redraw from what the server actually stored.
                  onPin={async (row, pinned) => {
                    if (row.holder.personId === null) return;
                    setBusy(true);
                    try {
                      const next = await apiFetch<Person[]>(
                        `${PEOPLE_KEY}/${row.holder.personId}/pinned`,
                        { method: "PUT", body: JSON.stringify({ pinned }) },
                        getToken,
                      );
                      setPeople(next);
                      put(PEOPLE_KEY, next);
                    } catch (e) {
                      throw new Error(e instanceof ApiError ? e.body : "That didn't save.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  // Two writes, and the ORDER matters. Settling first leaves the figure 139m too high
                  // if the offset then fails, which is visible and fixable with the box on the card.
                  // The other way round nets the same share twice, which is not visible at all.
                  onOffsetShares={async (holder: Holder, amount, name, payouts) => {
                    await settleShares(payouts);
                    await debtWrite(DEBTS_KEY, {
                      method: "POST",
                      body: JSON.stringify({
                        holder,
                        amount: -amount,
                        note: `offset against ${name}`,
                        // The very rows the settle above just marked paid, so the adjustment can name
                        // what discharged it a month later. See V58.
                        payouts,
                      }),
                    });
                  }}
                />

                {/* The way in for somebody with no card yet. A card is drawn for a person who already
                  owes you something, so the first debt of a relationship had nowhere to go. After
                  the cards, not above them: it is the way to one more of the same, the way Record a
                  sale is on the other tab. */}
                <AddSettlement
                  people={people}
                  busy={busy}
                  onAdd={(holder: Holder, amount, note) =>
                    debtWrite(DEBTS_KEY, {
                      method: "POST",
                      body: JSON.stringify({ holder, amount, note: note || undefined }),
                    })
                  }
                />

                {/* What the cards above do NOT cover, from the Wallet this tab replaced. A total that
                  is short must not read as a total that is complete. */}
                {(wallet.unreadable > 0 || wallet.betweenOthers > 0 || wallet.betweenMine > 0) && (
                  <ul className="ledger-notes">
                    {wallet.unreadable > 0 && (
                      <li className="loot-warn">
                        {wallet.unreadable} sold{" "}
                        {wallet.unreadable === 1 ? "drop names a seat" : "drops name a seat"} that
                        has left its party, so {wallet.unreadable === 1 ? "its" : "their"} split
                        cannot be read. Not counted above.
                      </li>
                    )}
                    {wallet.betweenOthers > 0 && (
                      <li>
                        {wallet.betweenOthers} unpaid{" "}
                        {wallet.betweenOthers === 1 ? "share is" : "shares are"} between two other
                        people, not yours to settle.
                      </li>
                    )}
                    {wallet.betweenMine > 0 && (
                      <li>
                        {wallet.betweenMine} unpaid{" "}
                        {wallet.betweenMine === 1 ? "share is" : "shares are"} between two of your
                        own characters, so there is nobody to settle with.
                      </li>
                    )}
                  </ul>
                )}
              </section>
            )}

            {/* The end of the pipeline, and it only runs one way: nothing here is waiting on
              anybody, and nothing here can be taken back.

              A Reopen used to sit on every row and it undid HALF of a settlement. Closing a coupon
              pair is ONE act that writes one row per inventory (see onSettlePair), so deleting one of
              them left a night shut in their pile and open in yours: Jonathan hit it by accident and
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
                partyById={partyById}
              />
            )}
          </>
        )}
      </PageSwap>
    </main>
  );
}

/** One month or one week of the log. */
function GroupSection({
  group,
  lines,
  bossByKey,
  characterById,
  bossOrder,
  runAxis,
  showCharacter,
}: {
  group: DropGroup;
  /** The group's rows, already consolidated by the page. */
  lines: DropLine[];
  bossByKey: Map<string, Boss>;
  characterById: Map<string, Character>;
  /** Boss keys in catalog order, which is what a fold split by boss is sorted by. */
  bossOrder: Map<string, number>;
  runAxis: RunAxis;
  showCharacter: boolean;
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
            bossOrder={bossOrder}
            runAxis={runAxis}
            showCharacter={showCharacter}
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
  bossOrder,
  runAxis,
  showCharacter,
}: {
  line: DropLine;
  bossByKey: Map<string, Boss>;
  characterById: Map<string, Character>;
  bossOrder: Map<string, number>;
  runAxis: RunAxis;
  showCharacter: boolean;
}) {
  const [open, setOpen] = useState(false);
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
        // The count on this row is your share, and this is who is holding it until they hand it
        // over. Without it the row reads as pieces you already have.
        entry.owedBy ? `${entry.owedBy} looted` : null,
        // This row IS the run when it stands alone: one night, one roster, and no chevron under it
        // to say so instead.
        ranWith(entry.ranWith),
      ].filter(Boolean);

  const status = foldStatus(line.entries);
  const runs = `${line.entries.length} runs`;
  const folds = foldRuns(line.entries, runAxis, bossOrder);
  // A level is only worth the chevron when there is more than one of them to tell apart. By
  // character it also goes when the log is already filtered to one: the name would head every fold
  // on the page with the name the filter above already carries.
  const heads = folds.length > 1 && (runAxis === "boss" || showCharacter);

  return (
    <li className={`droplog-row status-${entry.status.toLowerCase()}${open ? " is-open" : ""}`}>
      <div className="droplog-row-head">
        {line.folded ? (
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
        ) : (
          // The frame is kept so one drop's row lines up with a folded one's.
          <span className="party-row-toggle is-empty" aria-hidden="true" />
        )}

        {line.iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(line.iconUrl)} alt="" />
        ) : (
          // No official art for this drop. An empty frame keeps the row aligned with the ones that
          // have it, as the loot pool does.
          <span className="loot-icon" aria-hidden="true" />
        )}

        <span className="droplog-title">
          {/* A fold's pieces came off several runs, so its name links to none of them: it opened
              whichever party happened to be first, which is one run out of eleven. The runs below
              carry the links. */}
          {line.folded ? (
            <span className="loot-name">
              {line.name}
              <span className="loot-count"> x{line.yours}</span>
            </span>
          ) : (
            <Link href={`/bosses/parties/${entry.partyId}`} className="loot-name">
              {line.name}
              {line.yours > 1 && <span className="loot-count"> x{line.yours}</span>}
            </Link>
          )}
          {/* A fold says none of this, so the element is not drawn empty either. */}
          {meta.length > 0 && <span className="loot-meta">{meta.join(" · ")}</span>}
        </span>

        <Stage label={status} statusClass={entry.status.toLowerCase()} />
      </div>

      {line.folded && open && (
        <ul className="droplog-runs" id={panelId}>
          {/* Whose they are first, or which boss paid them, and only then which nights. A week of
              five bosses on six characters is thirty rows, and what is asked of a coupon fold is
              how many each. Skipped where there is one of them to tell apart: a chevron onto a
              single group opens onto itself, and the run rows name it themselves. */}
          {heads
            ? folds.map((fold) => (
                <RunGroup
                  key={fold.key ?? ""}
                  fold={fold}
                  name={foldName(fold, runAxis, bossByKey, characterById)}
                  panelId={`${panelId}-${fold.key ?? "none"}`}
                  bossByKey={bossByKey}
                  characterById={characterById}
                  runAxis={runAxis}
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

/**
 * What a fold's head is called, per the axis it is split down.
 *
 * A boss the catalog no longer carries, or a row filed with no boss at all, still has runs under it
 * and a count to state. Naming it for what it is beats dropping the rows, which is the silent
 * undercount this log exists to avoid.
 */
function foldName(
  fold: RunFold,
  runAxis: RunAxis,
  bossByKey: Map<string, Boss>,
  characterById: Map<string, Character>,
): string {
  if (runAxis === "boss") {
    if (fold.key === null) return "No boss";
    return bossByKey.get(fold.key)?.name ?? "Unknown boss";
  }
  return characterById.get(fold.key ?? "")?.name ?? "Unknown character";
}

/** One character's, or one boss's, share of a fold, opening onto the nights it came off. */
function RunGroup({
  fold,
  name,
  panelId,
  bossByKey,
  characterById,
  runAxis,
}: {
  fold: RunFold;
  name: string;
  panelId: string;
  bossByKey: Map<string, Boss>;
  characterById: Map<string, Character>;
  runAxis: RunAxis;
}) {
  const [open, setOpen] = useState(false);
  const runs = `${fold.entries.length} runs`;

  return (
    <li className={`droplog-character${open ? " is-open" : ""}`}>
      <div className="droplog-character-head">
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

        {/* The name links nowhere: these runs are several parties, and picking one of them to be
            the destination is picking whichever happened to be first. The runs carry the links. */}
        <span className="loot-name">
          {name}
          <span className="loot-count"> x{fold.yours}</span>
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
              characterName={
                runAxis === "boss" ? (characterById.get(e.characterId)?.name ?? null) : name
              }
              // Named by the row above, so a run under it would be saying it a second time. Which
              // side that is depends on the axis, so the run names the other one.
              nameBy={runAxis === "boss" ? "character" : "boss"}
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
  nameBy = "boss",
}: {
  entry: DropEntry;
  boss: Boss | null;
  characterName: string | null;
  showCharacter: boolean;
  /** Which side of the run labels it. The other one is named by the head above, or by the meta. */
  nameBy?: RunAxis;
}) {
  const byBoss = nameBy === "boss";
  const label = byBoss
    ? (boss?.name ?? formatDropped(entry.droppedOn))
    : (characterName ?? formatDropped(entry.droppedOn));
  const meta = [
    // Not said twice: where the label IS the date, there is no date left to put here.
    label === formatDropped(entry.droppedOn) ? null : formatDropped(entry.droppedOn),
    byBoss ? (showCharacter ? characterName : null) : null,
    entry.owedBy ? `${entry.owedBy} looted` : null,
    // Per run, because the roster is the WEEK's: a fold spanning two months is two rosters, and the
    // line above can only name their union.
    ranWith(entry.ranWith),
  ].filter(Boolean);

  return (
    <li className="droplog-run">
      {/* No portrait: the drop's own icon is on the line above, and a second column of art told
          nobody which run this was that the boss name did not already say. */}
      <Link href={`/bosses/parties/${entry.partyId}`} className="loot-name">
        {/* The drop is named by the line above, so the run is named by whichever side the head over
            it is not. Every run says its own, including a fold whose runs all came off one: the line
            above no longer names it, and eleven Kalos rows saying Kalos is the price of not asking
            the reader to remember it. The date is what is left where there is neither. */}
        {label}
        {/* Yours, the same as the line above sums. Counting what fell here made a fold of 440
            open onto runs adding up to 900. */}
        {entry.yours > 1 && <span className="loot-count"> x{entry.yours}</span>}
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
