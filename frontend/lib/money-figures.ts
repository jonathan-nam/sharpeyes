import { bossLabel } from "@/lib/boss-difficulty";
import { buildDropAudit } from "@/lib/drop-audit";
import { buildDropLog } from "@/lib/drop-log";
import { loggedTwice, withoutLoot } from "@/lib/duplicate-runs";
import {
  FATES,
  heldOfYoursBy,
  outstandingOf,
  owedByCreditor,
  queueOf,
  roomFor,
  stillAsking,
  worthDrawing,
} from "@/lib/ledger-fates";
import { saleQueues } from "@/lib/lot-sale";
import { splitByLogger } from "@/lib/sale-logger";
import {
  bossesOfSales,
  decidedSales,
  moneyRows,
  nightsOfSales,
  offsetOf,
  type OffsetShare,
  owedByYouShares,
  type Settlement,
  settleThePair,
  shareKey,
  sliceActToWeek,
  splittableDebts,
  undecidedSales,
  weekSplit,
  yourPiles,
} from "@/lib/settlement";
import { buildSettledLog, orphansOf, settledTotals } from "@/lib/settled-log";
import { settlementView, VESTIGE } from "@/lib/settlement-view";
import { sharedCard } from "@/lib/shared-book";
import { sharedHistory } from "@/lib/shared-history";
import { sharedPile } from "@/lib/shared-pile";
import {
  closedByHolder,
  couponMoney,
  foldSeats,
  holderKey,
  type HolderLedger,
  paymentsSinceClosing,
  runningBalance,
  SELF_KEY,
  stillOpen,
  unanswered,
} from "@/lib/vestige-ledger";
import type { DropLogPage, SharedBook } from "@/types/page";
import type { VestigePayment, VestigeTranche } from "@/types/vestige";

// The money the Drop Log page and its cards draw, composed from frontend/lib exactly as they do. The
// spec of what the backend serves (backend/money DropLogFigures.kt): the golden fixtures record it and
// lib/money-shadow.ts compares it against the server. Goes once those screens read the server instead.
// See docs/backend-arithmetic-plan.md.

/** A share an offset named whose drop has since been deleted, as SettlementCard draws it. */
const deletedShare = (lootId: string, memberId: string): OffsetShare => ({
  key: shareKey(lootId, memberId),
  lootId: "",
  memberId,
  item: "A drop that has been deleted",
  iconUrl: null,
  boss: "",
  members: [],
  on: "",
  weekStart: "",
  share: 0,
  sale: null,
  currency: "MESO",
  partyId: "",
});

/** What one SettlementCard asks of the library for its row. */
function card(
  row: Settlement,
  receipts: { counted: VestigePayment[] },
  offsetShares: Map<string, OffsetShare>,
) {
  const money = moneyRows(row, receipts.counted);
  const acts = money.discharges.map((act) => {
    const nights = act.payouts.map(
      (p) => offsetShares.get(shareKey(p.lootId, p.memberId)) ?? deletedShare(p.lootId, p.memberId),
    );
    return { act, nights, split: weekSplit(row, act, nights) };
  });
  const weeks = [...new Set(acts.flatMap(({ split }) => (split ? [...split.keys()] : [])))]
    .sort()
    .reverse();
  return {
    money,
    offset: offsetOf(row),
    undecided: undecidedSales(row),
    theirUndecided: undecidedSales({ sales: row.salesHeldByThem, holding: row.heldByThem }),
    owedByYou: owedByYouShares(row),
    pair: settleThePair(row),
    bosses: bossesOfSales(row),
    nights: nightsOfSales(row),
    acts,
    slices: weeks.map((week) => acts.map((a) => sliceActToWeek(row, a.act, a.nights, week))),
  };
}

/** What one PieceLedger card asks of the library for its pile. */
function pileCard(
  ledger: HolderLedger,
  held: Map<string, number>,
  tranches: VestigeTranche[],
  decided: Map<string, Set<string>>,
) {
  return {
    asking: stillAsking(tranches, decided).map((t) => t.id),
    room: FATES.map((fate) => roomFor(ledger, fate)),
    outstanding: outstandingOf(ledger, held),
    owed: owedByCreditor(ledger, held),
    queue: queueOf(ledger, held),
  };
}

/** The money the Drop Log page and its cards draw, off one account's two payloads. */
export function dropLogFigures(page: DropLogPage, books: SharedBook[]) {
  const shared = sharedHistory(books);
  const twice = loggedTwice(
    { parties: page.parties, pools: page.pools },
    {
      ...shared,
      ownerOf: new Map(books.flatMap((b) => b.parties.map((p) => [p.id, b.ownerName]))),
    },
  );
  const counted = withoutLoot(page.pools, twice);
  const view = settlementView({ ...page, pools: counted });
  const { closures, settled, ledgers, holderNames, offsetShares, credits } = view;
  const logParties = [...page.parties, ...shared.parties];
  const logPools = [...counted, ...shared.pools];
  const closedInLog = new Set([...closures.closed, ...closedByHolder(shared.settlements).closed]);
  const log = buildDropLog(logParties, logPools, page.drops, closedInLog);
  const allSettlements = [...page.settlements, ...shared.settlements];
  const settledRows = buildSettledLog(
    log.entries,
    allSettlements,
    new Map([...holderNames, ...shared.names]),
  );
  const paymentsByHolder = paymentsSinceClosing(page.payments, page.settlements);
  const decided = decidedSales(credits, page.disposals);
  const tranchesByHolder = new Map<string, VestigeTranche[]>();
  for (const t of page.tranches)
    tranchesByHolder.set(holderKey(t.holder), [
      ...(tranchesByHolder.get(holderKey(t.holder)) ?? []),
      t,
    ]);
  const recorded = (key: string) => {
    const receipts = paymentsByHolder.get(key);
    return (
      stillAsking(tranchesByHolder.get(key) ?? [], decided).length > 0 ||
      (receipts?.counted.length ?? 0) > 0 ||
      (receipts?.spent.length ?? 0) > 0
    );
  };
  const yours = yourPiles(ledgers);
  const heldOfYours = heldOfYoursBy(ledgers);
  const { drawn } = worthDrawing(yours, recorded, heldOfYours);
  const linkedKeys = new Set(page.people.flatMap((p) => (p.linked ? [`person:${p.id}`] : [])));
  const ownPile = yours[0];
  const theirPiles = ledgers
    .filter((ledger) => !ledger.closed && linkedKeys.has(holderKey(ledger.holder)))
    .map((ledger) => {
      const owedThem = ownPile
        ? (owedByCreditor(ownPile).find((c) => c.key === holderKey(ledger.holder))?.pieces ?? 0)
        : 0;
      return { ledger, heldOfYours: new Map(owedThem > 0 ? [[SELF_KEY, owedThem]] : []) };
    })
    .filter((pile) => outstandingOf(pile.ledger, pile.heldOfYours) > 0);
  const sharedPiles = books.map((book) => sharedPile(book, page.bosses));
  const byLogger = splitByLogger(logPools);
  const pileOf = (ledger: HolderLedger) => tranchesByHolder.get(holderKey(ledger.holder)) ?? [];
  return {
    twice,
    view,
    sharedCards: books.map((book) => sharedCard(book, page.bosses)),
    sharedPiles,
    log,
    settledRows,
    settledTotals: settledTotals(settledRows, couponMoney(page.tranches)),
    orphans: orphansOf(log.entries, allSettlements),
    unanswered: unanswered(page.parties, counted, VESTIGE),
    behind: runningBalance(stillOpen(settled, closures.closed)),
    paymentsByHolder,
    decided,
    drawn,
    heldOfYours,
    theirPiles,
    pendingSplits: splittableDebts(page.debts, offsetShares),
    sales: {
      yours: saleQueues(logParties, byLogger.yours, page.drops, SELF_KEY),
      theirs: saleQueues(logParties, byLogger.theirs, page.drops, SELF_KEY),
    },
    cards: view.settlement.map((row) =>
      card(row, paymentsByHolder.get(row.key) ?? { counted: [] }, offsetShares),
    ),
    piles: [
      ...drawn.map((ledger) => pileCard(ledger, heldOfYours, pileOf(ledger), decided)),
      ...theirPiles.map((p) => pileCard(p.ledger, p.heldOfYours, pileOf(p.ledger), decided)),
      ...sharedPiles.map((p) =>
        p
          ? pileCard(
              p.ledger,
              p.heldOfYours,
              p.tranches.get(holderKey(p.ledger.holder)) ?? [],
              p.decided,
            )
          : null,
      ),
    ],
    audits: dropAudits(page, books),
  };
}

/** Every drop's history, the way app/bosses/drops/[loot]/page.tsx builds one. */
export function dropAudits(page: DropLogPage, books: SharedBook[]) {
  const shared = sharedHistory(books);
  const parties = [...page.parties, ...shared.parties];
  const pools = [...page.pools, ...shared.pools];
  const settlements = [...page.settlements, ...shared.settlements];
  const log = buildDropLog(parties, pools, page.drops, closedByHolder(settlements).closed);
  const names = new Map<string, string>();
  for (const person of page.people) names.set(`person:${person.id}`, person.name);
  for (const [key, name] of shared.names) names.set(key, name);
  for (const party of parties)
    for (const seat of foldSeats(party.seats)) names.set(seat.key, seat.name);
  const bosses = new Map(page.bosses.map((b) => [b.bossKey, b]));
  const debts = [...page.debts, ...shared.debts];
  return log.entries.map((e) =>
    buildDropAudit(
      e.lootId,
      log.entries,
      pools,
      parties,
      bosses,
      settlements,
      debts,
      names,
      bossLabel,
    ),
  );
}
