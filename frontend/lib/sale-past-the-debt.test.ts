import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { heldOfYoursBy, outstandingOf, queueOf, stillAsking } from "./ledger-fates";
import { buildSettlement, decidedSales, moneyRows } from "./settlement";
import { settledTotals } from "./settled-log";
import {
  type Holder,
  type HolderLedger,
  answeredByHolder,
  answeredSalesByPair,
  boughtByHolder,
  couponMoney,
  holderLedgers,
  keptByHolder,
  outstanding,
  saleCredits,
  salesByHolder,
} from "./vestige-ledger";
import type { Wallet } from "./wallet";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";
import type { ProceedsDisposal } from "@/types/vestige";

// One sale bigger than the debt it answers, followed from the box it is typed into to the totals on
// the Settled View.
//
// The card's count box opens on the DEBT, so a night owing 120 suggests 120 against a market sale of
// 150. Prorating it by hand to fit is what the note under the form now tells you not to do, and the
// reason is here: the two entries are NOT equivalent downstream. The last case in this file is the
// 600m of your own money that the hand-prorated version reports nowhere.
//
// Every figure comes off the real pipeline, the way app/bosses/drops/(log)/layout.tsx assembles it, because
// the failure this pins is one of the surfaces disagreeing rather than one of them being wrong alone.

const M = 1_000_000;
const B = 1_000_000_000;
const VESTIGE = "vestige-of-erion";
const ORDER = new Map([["limbo", 6]]);
const SELF: Holder = { kind: "SELF", personId: null, characterName: null };
const OWEN: Holder = { kind: "PERSON", personId: "p-owen", characterName: null };
const OWEN_KEY = "person:p-owen";

const NO_WALLET: Wallet = {
  counterparties: [],
  owe: 0,
  owed: 0,
  net: 0,
  usd: { owe: 0, owed: 0, net: 0 },
  unreadable: 0,
  betweenOthers: 0,
  betweenMine: 0,
};

const seat = (id: string, name: string, mine: boolean): PartyMember => ({
  id,
  name,
  personId: mine ? null : "p-owen",
  personName: mine ? null : "Owen",
  characterId: mine ? `char-${id}` : null,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const SEATS = [seat("m1", "Marrow", true), seat("m2", "OwenChar", false)];

const party = (): Party => ({
  id: "pa",
  slug: "pa",
  characterId: "char-m1",
  solo: false,
  oneOff: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey: "limbo",
  difficulty: "HARD",
  minutes: null,
  members: SEATS,
  seats: SEATS,
  usualRoster: true,
  skippedThisPeriod: false,
  pendingLoot: 0,
  awaitingPayout: 0,
  settledLoot: 0,
  cleared: null,
  clearedByHand: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
});

/** A night you looted whole: 240 coupons over two seats, so 120 of them are Owen's. */
const coupon = (): Loot => ({
  id: "l1",
  dropKey: VESTIGE,
  customName: null,
  name: "Vestige of Erion Coupon",
  iconUrl: null,
  perMember: null,
  bossKey: "limbo",
  quantity: 240,
  difficulty: null,
  droppedOn: "2026-08-25",
  weekStart: "2026-08-20",
  status: "PENDING",
  saleAmount: null,
  amountBasis: null,
  splitMethod: null,
  sellerShares: null,
  sellerMemberId: null,
  takenByMemberId: null,
  soldAt: null,
  payouts: [],
  ranThatWeek: [],
  bundles: 3,
  bundlesBy: [{ memberId: "m1", bundles: 3 }],
});

/** One sale out of your pile, naming what of it was Owen's. */
const sale = (pieces: number, amount: number, theirs: number) => ({
  id: "t1",
  holder: SELF,
  pieces,
  amount,
  disposition: "SOLD",
  shares: [{ holder: OWEN, pieces: theirs }],
  soldAt: "2026-08-29T12:00:00Z",
});

/** The whole page's state, off one list of tranche rows, as the drops page assembles it. */
const account = (rows: ReturnType<typeof sale>[]) => {
  const pools: PartyLootPool[] = [{ partyId: "pa", loot: [coupon()] }];
  const ledgers = holderLedgers(
    outstanding([party()], pools, VESTIGE, ORDER),
    salesByHolder(rows),
    keptByHolder(rows),
    boughtByHolder(rows),
    undefined,
    undefined,
    answeredByHolder(rows),
    answeredSalesByPair(rows),
  );
  const settlement = (disposals: ProceedsDisposal[] = []) =>
    buildSettlement(
      ledgers,
      NO_WALLET,
      [],
      saleCredits(rows),
      new Map(),
      new Map(),
      new Set([OWEN_KEY]),
      answeredSalesByPair(rows),
      disposals,
    )[0]!;
  return { rows, ledgers, settlement };
};

const selfPile = (ledgers: HolderLedger[]) => ledgers.find((l) => l.holder.kind === "SELF")!;

/** What you actually did: sold 150 for 3b, of which 120 pieces were Owen's. */
const WHOLE = account([sale(150, 3 * B, 120)]);
/** What the card's placeholder talks you into: the same trade, prorated by hand to the debt. */
const PRORATED = account([sale(120, 2.4 * B, 120)]);
/** Nothing sold yet. */
const BEFORE = account([]);

describe("the Sale Ledger, on a sale bigger than the debt", () => {
  it("premise: the night owes Owen 120 of the 240 you looted", () => {
    expect(outstandingOf(selfPile(BEFORE.ledgers))).toBe(120);
    expect(queueOf(selfPile(BEFORE.ledgers)).owing.map((d) => d.lootId)).toEqual(["l1"]);
  });

  it("settles the pieces that were owed, and only those", () => {
    expect(outstandingOf(selfPile(WHOLE.ledgers))).toBe(0);
    const after = queueOf(selfPile(WHOLE.ledgers));
    expect(after.owing).toEqual([]);
    expect(after.answered).toBe(1);
  });

  it("is not a miscount, since the 30 over the debt were your own", () => {
    // The card's "N over" line is for a pile told more became of it than it ever held. 150 sold out
    // of 240 is not that, and the surplus needs no home.
    const pile = selfPile(WHOLE.ledgers);
    expect(pile.accounted).toBe(150);
    expect(Math.max(0, pile.accounted - pile.pieces)).toBe(0);
  });
});

describe("the Settlement Ledger, on the same sale", () => {
  it("holds Owen the 120 pieces' worth, never the whole lot", () => {
    // 120 of 150 at 3b is 2.4b. The 600m for your own 30 is not Owen's and never reaches his card.
    expect(WHOLE.settlement().holding).toBe(2.4 * B);
    expect(saleCredits(WHOLE.rows).get(OWEN_KEY)!.toThem).toBe(2.4 * B);
  });

  it("stops asking for the coupons it has already asked for in money", () => {
    // The debt is stated once, in one unit. Priced pieces come OFF the count, or the card asks twice
    // for one debt: once as 120 coupons and again as 2.4b.
    expect(BEFORE.settlement().piecesYouOwe).toBe(120);
    expect(WHOLE.settlement().piecesYouOwe).toBe(0);
    expect(WHOLE.settlement().piecesAnswered.theirs).toBe(120);
  });

  it("names the lot the money came out of, so the sale can be checked against the trade", () => {
    const [row] = saleCredits(WHOLE.rows).get(OWEN_KEY)!.sales;
    expect(row).toMatchObject({
      trancheId: "t1",
      pieces: 120,
      mesos: 2.4 * B,
      // What was actually typed, carried whole. This is the pair that makes 2.4b checkable.
      lot: { pieces: 150, amount: 3 * B },
    });
  });

  it("agrees with the Sale Ledger about the night, from either end", () => {
    const held = heldOfYoursBy(WHOLE.ledgers);
    const listed = queueOf(selfPile(WHOLE.ledgers), held)
      .owing.flatMap((n) => n.transfers)
      .reduce((sum, t) => sum + t.pieces, 0);
    expect(listed).toBe(outstandingOf(selfPile(WHOLE.ledgers), held));
    expect(WHOLE.settlement().owedDrops.reduce((sum, d) => sum + d.pieces, 0)).toBe(0);
  });
});

describe("settling the money, and what leaves the card", () => {
  const OFFSET: ProceedsDisposal = {
    id: "d1",
    holder: OWEN,
    amount: 2.4 * B,
    kind: "OFFSET",
    decidedAt: "2026-08-30",
  };

  it("discharges exactly the 2.4b, naming the sale it was made of", () => {
    const { discharges, discharged } = moneyRows(WHOLE.settlement([OFFSET]));
    expect(discharged).toBe(2.4 * B);
    expect(discharges[0]!.sales.map((s) => [s.trancheId, s.pieces, s.mesos])).toEqual([
      ["t1", 120, 2.4 * B],
    ]);
    // Nothing of yours is left waiting on a decision that was never about it.
    expect(WHOLE.settlement([OFFSET]).holding).toBe(0);
  });

  it("takes the sale off the Sale Ledger once its money is decided, and not before", () => {
    expect(stillAsking(WHOLE.rows, decidedSales(saleCredits(WHOLE.rows), []))).toHaveLength(1);
    expect(stillAsking(WHOLE.rows, decidedSales(saleCredits(WHOLE.rows), [OFFSET]))).toEqual([]);
  });
});

describe("the Settled View's money", () => {
  it("counts the whole lot as pooled, and the surplus as yours", () => {
    // The 30 pieces past the debt were your own coupons, so their 600m is your take. This is the
    // figure the Drop Ledger used to miss entirely for vestiges.
    expect(couponMoney(WHOLE.rows)).toEqual({ pooled: 3 * B, yourTake: 600 * M });
    expect(settledTotals([], couponMoney(WHOLE.rows))).toMatchObject({
      pooled: 3 * B,
      yourTake: 600 * M,
    });
  });

  it("REPORTS 600m LESS when the same trade is prorated by hand to the debt", () => {
    // The whole reason the note exists. Both entries settle Owen identically, so the Sale and
    // Settlement Ledgers cannot tell them apart, and nothing on either screen says anything is
    // missing. It is only here that the hand-prorated version is wrong: it says the sale fetched
    // 2.4b when it fetched 3b, and that NONE of it was yours.
    expect(PRORATED.settlement().holding).toBe(WHOLE.settlement().holding);
    expect(outstandingOf(selfPile(PRORATED.ledgers))).toBe(0);

    expect(couponMoney(PRORATED.rows)).toEqual({ pooled: 2.4 * B, yourTake: 0 });
    expect(couponMoney(WHOLE.rows).yourTake - couponMoney(PRORATED.rows).yourTake).toBe(600 * M);
  });
});

describe("the pieces step", () => {
  const source = readFileSync(join(__dirname, "..", "components", "piece-ledger.tsx"), "utf8");

  it("carries no help text", () => {
    // The bubble explaining the whole-sale entry was cut in the copy pass: never explain a control.
    expect(source).not.toContain("ledger-hint");
  });
});
