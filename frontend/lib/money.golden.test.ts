import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { committedGolden, seeded } from "@/lib/golden";
import { goldenAccount } from "@/lib/golden-pages";
import { goldenJson, recorded, recording, resetRecording } from "@/lib/golden-record";
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
  foldSeats,
  couponMoney,
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

// The Drop Log's figures, recorded for the backend port. See docs/backend-arithmetic-plan.md.
//
// Runs the money the way app/bosses/drops/page.tsx and its cards do, over every page in the corpus
// and seeded mutations of each. Writes one entry fixture per page (the whole answer) and one fixture
// per module (what the others asked it, recorded at the module boundary by the mocks below).
//
// The corpus in the repo is invented (lib/golden-pages.ts). MONEY_PAGES_DIR runs an audit over real
// pages instead, writing to MONEY_GOLDEN_OUT and never to the repo.

const { record } = vi.hoisted(() => ({
  record: (name: string) => async (load: () => Promise<Record<string, unknown>>) =>
    (await import("@/lib/golden-record")).wrapModule(name, await load()),
}));
vi.mock("@/lib/piece-ledger", (load) => record("piece-ledger")(load));
vi.mock("@/lib/drop-split", (load) => record("drop-split")(load));
vi.mock("@/lib/loot", (load) => record("loot")(load));
vi.mock("@/lib/money", (load) => record("money")(load));
vi.mock("@/lib/wallet", (load) => record("wallet")(load));
vi.mock("@/lib/vestige-ledger", (load) => record("vestige-ledger")(load));
vi.mock("@/lib/ledger-fates", (load) => record("ledger-fates")(load));
vi.mock("@/lib/settlement", (load) => record("settlement")(load));
vi.mock("@/lib/boss-difficulty", (load) => record("boss-difficulty")(load));

const REPO = new URL("../../backend/money/src/jvmTest/resources/money-golden/", import.meta.url)
  .pathname;
const AUDIT = process.env.MONEY_PAGES_DIR;
const PAGES = AUDIT ?? "";

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
function figures(page: DropLogPage, books: SharedBook[]) {
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
    audits: audits(page, books),
  };
}

/** Every drop's history, the way app/bosses/drops/[loot]/page.tsx builds one. */
function audits(page: DropLogPage, books: SharedBook[]) {
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

type Case = { name: string; page: DropLogPage; books: SharedBook[] };

/** Invented accounts (lib/golden-pages.ts), each read by its owner and by its linked member. */
const ACCOUNTS = 12;

function corpus(): Case[] {
  if (!AUDIT)
    return Array.from({ length: ACCOUNTS }, (_, i) => goldenAccount(i + 1)).flatMap((a, i) => [
      { name: `owner-${i + 1}`, page: a.page, books: [] },
      { name: `member-${i + 1}`, page: a.member, books: a.books },
    ]);
  const files = readdirSync(PAGES)
    .filter((f) => f.endsWith(".page.json"))
    .sort();
  return files.map((file) => {
    const name = file.replace(/\.page\.json$/, "");
    const books = (() => {
      try {
        return JSON.parse(readFileSync(`${PAGES}/${name}.books.json`, "utf8")) as SharedBook[];
      } catch {
        return [];
      }
    })();
    return {
      name,
      page: JSON.parse(readFileSync(`${PAGES}/${file}`, "utf8")) as DropLogPage,
      books,
    };
  });
}

/**
 * A variant of one page: rows dropped, sales unmade, amounts and paid flags moved. Not a page anybody
 * had, which is the point: every branch the real one never reached, with the real one's shape.
 */
function mutate<T>(doc: T, random: () => number): T {
  const copy = structuredClone(doc) as Record<string, unknown>;
  const thin = (list: unknown) => (Array.isArray(list) ? list.filter(() => random() > 0.25) : list);
  for (const key of ["tranches", "payments", "settlements", "debts", "disposals"])
    if (key in copy) copy[key] = thin(copy[key]);
  const pools = (copy.pools ?? []) as { loot: Record<string, unknown>[] }[];
  for (const pool of pools)
    for (const loot of pool.loot) {
      const roll = random();
      if (roll < 0.1) {
        loot.saleAmount = null;
        loot.saleUsdCents = null;
      } else if (roll < 0.25 && typeof loot.saleAmount === "number") {
        loot.saleAmount = Math.round(loot.saleAmount * (0.5 + random()));
      }
      for (const payout of (loot.payouts ?? []) as { paid: boolean }[])
        if (random() < 0.15) payout.paid = !payout.paid;
    }
  for (const key of ["tranches", "payments", "debts", "disposals"])
    for (const row of (copy[key] ?? []) as { amount?: number | null }[])
      if (typeof row.amount === "number" && random() < 0.2)
        row.amount = Math.round(row.amount * (0.5 + random()));
  return copy as T;
}

const MUTATIONS = AUDIT ? Number(process.env.MONEY_MUTATIONS ?? 200) : 25;

describe("money golden fixtures", () => {
  it(
    "are what the Drop Log's figures and their modules answer today",
    () => {
      // An audit's real pages are large, so it keeps fewer and bigger calls, and writes each variant to
      // its own file as it goes: nothing waits in memory for the next.
      if (AUDIT) resetRecording(60, 300_000);
      else resetRecording(50, 12_000);
      const out = AUDIT ? process.env.MONEY_GOLDEN_OUT! : REPO;
      if (AUDIT) mkdirSync(out, { recursive: true });

      const texts = new Map<string, string>();
      for (const c of corpus()) {
        const random = seeded(c.name.length * 7919 + 1);
        for (let i = 0; i <= MUTATIONS; i += 1) {
          const page = i === 0 ? c.page : mutate(c.page, random);
          const books = i === 0 ? c.books : c.books.map((b) => mutate(b, random));
          const output = recording(() => goldenJson(figures(page, books)));
          const entry = `{"cases":[\n${JSON.stringify({ input: { page, books }, output })}\n]}\n`;
          if (AUDIT) writeFileSync(`${out}/entry-${c.name}-${i}.json`, entry);
          else if (i === 0) texts.set(`entry-${c.name}.json`, entry);
        }
      }
      // One file per function, so no module's fixture outgrows the repo's file size limit.
      for (const [fn, calls] of recorded()) {
        texts.set(`module-${fn}.json`, `{${JSON.stringify(fn)}:${JSON.stringify(calls)}}\n`);
      }

      for (const [name, text] of texts) {
        if (AUDIT) writeFileSync(`${out}/${name}`, text);
        else
          expect(committedGolden(name, text) === text, `${name}: run with UPDATE_GOLDEN=1`).toBe(
            true,
          );
      }
      // An audit runs for minutes over real pages, and must not be retried half written.
    },
    { timeout: AUDIT ? 3_600_000 : undefined, retry: AUDIT ? 0 : undefined },
  );
});
