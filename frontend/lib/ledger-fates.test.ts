import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FATES,
  asksAnything,
  coversThePile,
  distributeSale,
  stillAsking,
  outstandingOf,
  owedByCreditor,
  owes,
  queueOf,
  roomFor,
  settledOf,
  worthDrawing,
} from "./ledger-fates";
import {
  type Holder,
  type HolderLedger,
  alsoHeldByYou,
  answeredByHolder,
  answeredSalesByPair,
  holderKey,
  holderLedgers,
  keptByHolder,
  outstanding,
  boughtByHolder,
  salesByHolder,
  unaccounted,
} from "./vestige-ledger";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

const M = 1_000_000;
const VESTIGE = "vestige-of-erion";
const ORDER = new Map([["limbo", 6]]);

const seat = (
  id: string,
  name: string,
  { mine = false, person = null as [string, string] | null } = {},
): PartyMember => ({
  id,
  name,
  personId: person?.[0] ?? null,
  personName: person?.[1] ?? null,
  characterId: mine ? `char-${id}` : null,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const party = (members: PartyMember[]): Party => ({
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
  members,
  seats: members,
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

const coupon = (quantity: number): Loot => ({
  id: "l1",
  dropKey: VESTIGE,
  customName: null,
  name: "Vestige of Erion Coupon",
  iconUrl: null,
  perMember: null,
  bossKey: "limbo",
  quantity,
  difficulty: null,
  droppedOn: "2026-08-06",
  weekStart: "2026-08-06",
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
  bundles: null,
  bundlesBy: [],
});

const pool = (loot: Loot[]): PartyLootPool => ({ partyId: "pa", loot });

/**
 * One sale, as answeredSalesByPair files it, dated late enough to reach every night in here.
 *
 * These fixtures' nights carry no `recordedAt`, which is a row from before the field and is eligible
 * for any sale. The eligibility rule has its own tests in piece-ledger.test.ts.
 */
const sold = (pieces: number, recordedAt = "2030-01-01T00:00:00Z") => [{ pieces, recordedAt }];

const SELF: Holder = { kind: "SELF", personId: null, characterName: null };
const BRO: Holder = { kind: "PERSON", personId: "p-bro", characterName: null };

/**
 * A night YOU looted all of: 60 pieces, half of them Bro's.
 *
 * Your own pile holding somebody else's pieces, which is the shape the fate list used to have no
 * answer for. A duo rather than a solo, because a solo owes nobody and the surplus never appears.
 *
 * Every aggregation comes off ONE list of tranche rows, the way the page builds them, so a rule that
 * counts a row twice cannot pass here by being handed two disagreeing maps.
 */
const yourPile = (
  kept = 0,
  bought = { pieces: 0, paid: 0 },
  /** A sale, and how many of its pieces it named as Bro's. See V56. */
  sold: { pieces: number; amount: number; theirs?: number } | null = null,
) => {
  const rows = [
    ...(kept > 0 ? [{ holder: SELF, pieces: kept, amount: null }] : []),
    ...(bought.pieces > 0
      ? [{ holder: SELF, pieces: bought.pieces, amount: bought.paid, disposition: "BOUGHT" }]
      : []),
    ...(sold
      ? [
          {
            holder: SELF,
            pieces: sold.pieces,
            amount: sold.amount,
            disposition: "SOLD",
            shares: sold.theirs ? [{ holder: BRO, pieces: sold.theirs }] : [],
          },
        ]
      : []),
  ];
  return holderLedgers(
    outstanding(
      [
        party([
          seat("m1", "Husky", { mine: true }),
          seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
        ]),
      ],
      [pool([{ ...coupon(60), bundles: 2, bundlesBy: [{ memberId: "m1", bundles: 2 }] }])],
      VESTIGE,
      ORDER,
    ),
    salesByHolder(rows),
    keptByHolder(rows),
    boughtByHolder(rows),
    undefined,
    undefined,
    answeredByHolder(rows),
    // As the page builds it. Left off, every sale reached the card as pieces attributed to NOBODY,
    // so the per-creditor half of the ledger was exercised by nothing in here.
    answeredSalesByPair(rows),
  )[0]!;
};

/**
 * A night that divided the way it fell: a duo, 60 in 2 stacks, one each.
 *
 * Nobody owes anybody, so `outstanding` drops it and `alsoHeldByYou` is what puts your 30 on the
 * card, which is the only reason the pile is drawn at all. The shape the card used to demand 30
 * pieces of typing for.
 */
const squarePile = () => {
  const parties = [
    party([
      seat("m1", "Husky", { mine: true }),
      seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
    ]),
  ];
  const pools = [pool([{ ...coupon(60), bundles: 2 }])];
  const queued = outstanding(parties, pools, VESTIGE, ORDER);
  // The premise: a square night owes nothing, so it is not in the queue at all.
  expect(queued).toHaveLength(0);
  return holderLedgers(alsoHeldByYou(parties, pools, VESTIGE, ORDER, queued), new Map())[0]!;
};

describe("the answers a pile can be given", () => {
  it("offers all three whoever is holding it", () => {
    // BOUGHT used to be somebody else's fate only. It is not about buying your own coupons, it is
    // about the pieces in a pile that are NOT the holder's, and your own inventory holds those.
    expect([...FATES]).toEqual(["SOLD", "KEPT", "BOUGHT"]);
  });

  it("stops a redemption at the holder's own share", () => {
    const mine = yourPile();
    expect([mine.pieces, mine.ownShare]).toEqual([60, 30]);
    expect(roomFor(mine, "KEPT")).toBe(30);
  });

  it("gives the purchase exactly what the redemption turns away", () => {
    const mine = yourPile();
    expect(roomFor(mine, "BOUGHT")).toBe(30);
  });

  it("bounds a sale only by what is still unanswered, since it names no owner", () => {
    expect(roomFor(yourPile(), "SOLD")).toBe(60);
  });

  it("counts rows already entered against all three, so three cannot walk past what one cannot", () => {
    const half = yourPile(30);
    expect(unaccounted(half)).toBe(30);
    expect(roomFor(half, "KEPT")).toBe(0);
    expect(roomFor(half, "SOLD")).toBe(30);
    expect(roomFor(half, "BOUGHT")).toBe(30);
  });
});

// The dead end this file exists to close. Your own card offered SOLD and KEPT, and KEPT stops at your
// own share, so the 30 pieces of Bro's in your inventory could only ever be sold: a pile you meant to
// keep sat at "30 of 60 accounted for" forever, with nothing on screen saying which answer was
// missing. Nobody may be forced to sell a coupon to make a count come out.
describe("whether the answers can account for the whole pile", () => {
  it("covers your own pile, which holds somebody else's pieces", () => {
    expect(coversThePile(yourPile())).toBe(true);
  });

  it("covers it after the redemption has taken your own share", () => {
    expect(coversThePile(yourPile(30))).toBe(true);
  });

  it("reaches nothing left to answer without a single sale", () => {
    const done = yourPile(30, { pieces: 30, paid: 750 * M });
    expect(unaccounted(done)).toBe(0);
    expect(coversThePile(done)).toBe(true);
  });

  it("covers somebody else's pile the same way", () => {
    const theirs = holderLedgers(
      outstanding(
        [
          party([
            seat("m1", "Husky", { mine: true }),
            seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
          ]),
        ],
        [pool([{ ...coupon(60), bundles: 2, bundlesBy: [{ memberId: "m2", bundles: 2 }] }])],
        VESTIGE,
        ORDER,
      ),
      new Map(),
    ).find((l) => l.holder.kind === "PERSON")!;
    expect(theirs.holder).toEqual(BRO);
    expect(coversThePile(theirs)).toBe(true);
  });
});

// A pile that owes nobody gets the same figures whatever it is told, because #354 left no debt
// derived from these rows. So the count is an instruction with no consequence, and 24 square nights
// asked for 1140 pieces of typing to move a figure nobody reads.
describe("whether the card has anything to ask", () => {
  it("asks nothing of a night that divided the way it fell", () => {
    const square = squarePile();
    expect(square.pieces).toBe(30);
    expect(owes(square)).toBe(0);
    // The pile is unaccounted for and that is fine: nothing turns on the answer.
    expect(unaccounted(square)).toBe(30);
    expect(asksAnything(square)).toBe(false);
  });

  it("still asks a pile that owes somebody, which is what the count is for", () => {
    const mine = yourPile();
    expect(owes(mine)).toBe(30);
    expect(asksAnything(mine)).toBe(true);
  });

  it("nets a creditor's own pieces off what you owe them, and nobody else's", () => {
    // The Sale Ledger's headline read 90 on a week where 70 changes hands: it summed what your pile
    // owes and never saw the 20 of yours the creditor is holding, which sits on THEIR pile.
    const mine = yourPile();
    const creditor = mine.drops[0]!.transfers[0]!.toId;

    expect(owes(mine, new Map([[creditor, 10]]))).toBe(20);
    // Per creditor: a stranger holding your coupons cannot pay down what you owe somebody else.
    expect(owes(mine, new Map([["person:p-nobody", 30]]))).toBe(30);
    // And floored there. A creditor holding MORE of yours than you owe them is a debt the other way
    // round, which is their own card's to say, not a credit against your other creditors.
    expect(owes(mine, new Map([[creditor, 200]]))).toBe(0);
    expect(asksAnything(mine, new Map([[creditor, 200]]))).toBe(false);
  });

  it("stops once the debt is bought out, whatever is left unentered", () => {
    // The 30 owed are answered. The other 30 are your own and nobody is waiting on them, so the
    // card has nothing left to ask even though half the pile has no row against it.
    const done = yourPile(0, { pieces: 30, paid: 750 * M });
    expect([owes(done), settledOf(done)]).toEqual([30, 30]);
    expect(unaccounted(done)).toBe(30);
    expect(asksAnything(done)).toBe(false);
  });

  it("counts the debt, not the pile, so 1150 of your own do not join the question", () => {
    // The complaint this exists for: a 10-piece debt read "0 of 1160 pieces accounted for".
    const mine = yourPile();
    expect(mine.pieces).toBe(60);
    expect(owes(mine)).toBe(30);
    expect(settledOf(mine)).toBe(0);
  });

  it("does not let a redemption answer a debt, since it is the holder's own share", () => {
    const kept = yourPile(30);
    expect(settledOf(kept)).toBe(0);
    expect(asksAnything(kept)).toBe(true);
  });

  it("does not let a sale that named nobody answer one, which is the trap", () => {
    // A sale of a mixed pile that says nothing about whose coupons went out has not paid anybody.
    // Counting it would report a debt discharged with no figure on the other person's card.
    const sold = yourPile(0, { pieces: 0, paid: 0 }, { pieces: 60, amount: 1_500 * M });
    expect(sold.soldPieces).toBe(60);
    expect(settledOf(sold)).toBe(0);
    expect(asksAnything(sold)).toBe(true);
  });

  it("lets a sale that NAMED the creditor answer one, since their money is on their card", () => {
    // #362 gave a sale out of your own pile the box that says whose pieces were in it, and V56 turns
    // that into mesos on their Settlement card. The debt is answered, in the other unit.
    const sold = yourPile(0, { pieces: 0, paid: 0 }, { pieces: 60, amount: 1_500 * M, theirs: 30 });
    expect([owes(sold), settledOf(sold)]).toEqual([30, 30]);
    expect(asksAnything(sold)).toBe(false);
  });

  it("answers only for the pieces a sale actually named", () => {
    // Half of what was owed, so the card still asks for the rest rather than reading as done.
    const part = yourPile(0, { pieces: 0, paid: 0 }, { pieces: 60, amount: 1_500 * M, theirs: 15 });
    expect([owes(part), settledOf(part)]).toEqual([30, 15]);
    expect(asksAnything(part)).toBe(true);
  });

  it("counts a purchase and a sale of somebody else's together, never one twice", () => {
    // The double-count this arithmetic invites: 20 taken at a price and 10 sold as theirs is 30, not
    // 50. Both routes are counted in answeredByHolder, which is why there is only one term.
    const both = yourPile(
      0,
      { pieces: 20, paid: 500 * M },
      { pieces: 40, amount: 1_000 * M, theirs: 10 },
    );
    expect([owes(both), settledOf(both)]).toEqual([30, 30]);
    expect(asksAnything(both)).toBe(false);
  });

  it("speaks up when more was entered than the pile holds, owed or not", () => {
    // A miscount is the one thing a quiet card may not swallow. 40 kept against a 30 pile.
    const over = holderLedgers(
      alsoHeldByYou(
        [
          party([
            seat("m1", "Husky", { mine: true }),
            seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
          ]),
        ],
        [pool([{ ...coupon(60), bundles: 2 }])],
        VESTIGE,
        ORDER,
        [],
      ),
      new Map(),
      keptByHolder([{ holder: SELF, pieces: 40, amount: null }]),
    )[0]!;
    expect([over.pieces, over.accounted]).toEqual([30, 40]);
    expect(owes(over)).toBe(0);
    expect(asksAnything(over)).toBe(true);
  });
});

// What the queue lists, which is the debts, and what it counts instead. The complaint that produced
// this: a pile of 1495 pieces off 30-odd nights, of which two owed anybody, drew 30-odd rows.
describe("the nights the card's queue lists", () => {
  /** One night under a pile: `to` is who it owes, or nobody. */
  const night = (
    lootId: string,
    {
      to = null as string | null,
      closed = false,
      pieces = 60,
      owed = 30,
      droppedOn = "2026-08-06",
      recordedAt = undefined as string | undefined,
    } = {},
  ) => ({
    lootId,
    partyId: `pa-${lootId}`,
    bossKey: "limbo",
    weekStart: "2026-08-06",
    droppedOn,
    recordedAt,
    looterName: "Husky",
    pieces,
    closed,
    transfers: to ? [{ fromId: "self", toId: "person:p-bro", from: "you", to, pieces: owed }] : [],
  });

  const pileOf = (drops: ReturnType<typeof night>[]): HolderLedger => ({
    holder: SELF,
    holderName: "you",
    pieces: drops.reduce((sum, d) => sum + d.pieces, 0),
    owedToYou: 0,
    received: 0,
    kept: 0,
    ownShare: 0,
    bought: { pieces: 0, paid: 0 },
    soldPieces: 0,
    answered: 0,
    answeredByCreditor: new Map(),
    closed: false,
    writtenOff: 0,
    accounted: 0,
    drops,
  });

  it("lists a night that owes somebody", () => {
    const { owing } = queueOf(pileOf([night("l1", { to: "Bro" })]));
    expect(owing.map((d) => d.lootId)).toEqual(["l1"]);
  });

  it("leaves out a night that divided the way it fell, which is most of them", () => {
    // The whole complaint. Nothing is derived from what became of those coupons, so the row carried
    // a boss, a looter, a week and no question, and there were thirty of them.
    const { owing } = queueOf(pileOf([night("l1"), night("l2"), night("l3", { to: "Bro" })]));
    expect(owing.map((d) => d.lootId)).toEqual(["l3"]);
  });

  it("counts what it left out rather than going quiet about it", () => {
    // A missing item beats a wrong count, and a count that changed still gets said. See CLAUDE.md.
    const { clean } = queueOf(pileOf([night("l1"), night("l2"), night("l3", { to: "Bro" })]));
    expect(clean).toBe(2);
  });

  it("leaves a closed night to the Settled View, without counting it as one that split clean", () => {
    // They are different facts, and a closed night's is now told in full one tab along: which act
    // closed it, who with, and what it wrote off. Counting it here as well would be two places to
    // disagree; counting it as CLEAN would say the debt never existed.
    const { owing, clean } = queueOf(
      pileOf([night("l1", { to: "Bro", closed: true }), night("l2")]),
    );
    expect([owing.length, clean]).toEqual([0, 1]);
  });

  it("has nothing to list for a pile that owes nobody at all", () => {
    const { owing, clean } = queueOf(pileOf([night("l1"), night("l2")]));
    expect([owing.length, clean]).toEqual([0, 2]);
  });

  it("counts the nights whose debt has been answered, rather than listing them", () => {
    // Jonathan's five rows. Their coupons were sold and priced months ago, the money is on Bro's
    // Settlement card, and the header above them already said nothing was outstanding. They were the
    // only kind of finished night still drawn.
    const pile = {
      ...pileOf([night("l1", { to: "Bro" }), night("l2", { to: "Bro" })]),
      answered: 60,
      answeredByCreditor: new Map([["person:p-bro", sold(60)]]),
    };
    const { owing, answered } = queueOf(pile);
    expect([owing.length, answered]).toEqual([0, 2]);
  });

  it("keeps the nights the answer did not reach, and only those", () => {
    // 30 each, so 60 owed against 30 answered: one night's worth is still somebody's. This used to
    // keep BOTH up, on the reasoning that a tranche names a person and never a boss so either could
    // be the part still owed. What that cost is the test below.
    const pile = {
      ...pileOf([night("l1", { to: "Bro" }), night("l2", { to: "Bro" })]),
      answered: 30,
      answeredByCreditor: new Map([["person:p-bro", sold(30)]]),
    };
    const { owing, answered } = queueOf(pile);
    expect([owing.map((d) => d.lootId), answered]).toEqual([["l1"], 1]);
  });

  it("does not put a night back up because a LATER one was logged", () => {
    // Jonathan's report. Five nights owing Bro 150, all answered by two sales, so the queue was
    // empty. One Hard Kaling entered that week owed 30 more, and all six came back including the
    // five already sold. A night that has been answered for is finished, and a night logged today
    // cannot un-finish it.
    const before = {
      ...pileOf([
        night("l1", { to: "Bro", owed: 10 }),
        night("l2", { to: "Bro", owed: 60 }),
        night("l3", { to: "Bro", owed: 60 }),
      ]),
      answered: 130,
      answeredByCreditor: new Map([["person:p-bro", sold(130)]]),
    };
    expect(queueOf(before).owing).toEqual([]);

    const after = {
      ...before,
      drops: [
        ...before.drops,
        // Logged after both sales, so neither can have come off it however new it is.
        night("l4", {
          to: "Bro",
          owed: 30,
          droppedOn: "2026-08-14",
          recordedAt: "2030-02-01T00:00:00Z",
        }),
      ],
    };
    expect(queueOf(after).owing.map((d) => d.lootId)).toEqual(["l4"]);
    expect(queueOf(after).answered).toBe(3);
  });

  it("answers the newest night first, whatever order the rows are drawn in", () => {
    // The queue is drawn in the catalog's order so two bosses in one week never swap places, which is
    // not the order the nights happened in. A sale is the evening's loot going to market, so the fold
    // reads the day it FELL and the oldest night is the one left owing. See spendSales.
    const pile = {
      ...pileOf([
        night("newest", { to: "Bro", owed: 30, droppedOn: "2026-08-14" }),
        night("oldest", { to: "Bro", owed: 30, droppedOn: "2026-08-13" }),
      ]),
      answered: 30,
      answeredByCreditor: new Map([["person:p-bro", sold(30)]]),
    };
    expect(queueOf(pile).owing.map((d) => d.lootId)).toEqual(["oldest"]);
  });

  it("never spends one creditor's answered coupons on a night owed to another", () => {
    // The cross-person netting `owes` refuses, one screen along. Bro's sold coupons cannot finish a
    // night Zaddy is owed, however square Bro's own side is.
    const owedZaddy = {
      ...night("l2", { to: "Zaddy" }),
      transfers: [
        { fromId: "self", toId: "character:zaddy", from: "you", to: "Zaddy", pieces: 30 },
      ],
    };
    const pile = {
      ...pileOf([night("l1", { to: "Bro" }), owedZaddy]),
      answered: 300,
      answeredByCreditor: new Map([["person:p-bro", sold(300)]]),
    };
    expect(queueOf(pile).owing.map((d) => d.lootId)).toEqual(["l2"]);
  });

  it("counts them answered when their own coupons cover the debt, not just a sale", () => {
    // The other way a pile comes to owe nothing: the creditor is holding as much of yours as you
    // are of theirs. `owes` nets per creditor, so the queue has to read the same figure the header
    // does or the two disagree about whether anything is left.
    const pile = pileOf([night("l1", { to: "Bro" })]);
    const { owing, answered } = queueOf(pile, new Map([["person:p-bro", 60]]));
    expect([owing.length, answered]).toEqual([0, 1]);
  });

  it("counts an answered night without counting the closed one beside it", () => {
    // Different facts: a closed night's books were shut by somebody deciding, an answered one's debt
    // was paid in money. The closed one is the Settled View's, so only the answered one is counted
    // here, and neither is listed.
    const pile = {
      ...pileOf([night("l1", { to: "Bro", closed: true }), night("l2", { to: "Bro" })]),
      answered: 60,
      answeredByCreditor: new Map([["person:p-bro", sold(60)]]),
    };
    const { answered, owing } = queueOf(pile);
    expect([owing.length, answered]).toEqual([0, 1]);
  });
});

describe("the figure the card's header states", () => {
  it("states the debt, not the pile", () => {
    // `holding 1495` stood here and was a number nobody could act on: the pile is mostly nights that
    // divided the way they fell, and the question was about 40 pieces.
    expect(outstandingOf(yourPile())).toBe(30);
  });

  it("comes down as the debt is answered, so it is the progress as well as the total", () => {
    // Which is what lets the second line saying "0 of 30 accounted for" go.
    expect(outstandingOf(yourPile(0, { pieces: 30, paid: 900 * M }))).toBe(0);
  });

  it("is zero for a pile that owes nobody, so the header says nothing", () => {
    expect(outstandingOf(squarePile())).toBe(0);
  });
});

// A pile that owes nobody is not a card. It is still a place a sale MAY be recorded, so it is held
// back rather than dropped: dropping it would re-break what alsoHeldByYou exists for.
describe("which of your own piles the ledger draws", () => {
  const none = () => false;

  it("holds back a pile with no debt and no rows", () => {
    const { drawn, quiet } = worthDrawing([squarePile()], none);
    expect(drawn).toHaveLength(0);
    expect(quiet).toHaveLength(1);
  });

  it("draws one that owes somebody", () => {
    const { drawn, quiet } = worthDrawing([yourPile()], none);
    expect(drawn).toHaveLength(1);
    expect(quiet).toHaveLength(0);
  });

  it("draws a settled one that has rows, so a mistyped tranche stays reachable", () => {
    // The debt is bought out, so it asks nothing. It is still a card, because the rows that made it
    // settled are corrected here and nowhere else.
    const done = yourPile(0, { pieces: 30, paid: 750 * M });
    expect(asksAnything(done)).toBe(false);
    expect(worthDrawing([done], () => true).drawn).toHaveLength(1);
    // And without them there would be nothing on it to correct.
    expect(worthDrawing([done], none).quiet).toHaveLength(1);
  });

  it("holds back a pile whose every night is closed, rows or no rows", () => {
    // It is finished, so it is the Settled View's, and a worklist that keeps drawing finished work is
    // not a worklist. Held back rather than dropped: a mistyped tranche re-prices what a settlement
    // was agreed on, and this card is still the only place one can be taken off.
    const done = { ...yourPile(), closed: true };
    expect(worthDrawing([done], () => true).quiet).toHaveLength(1);
    expect(worthDrawing([done], () => true).drawn).toHaveLength(0);
  });

  it("keeps a miscounted pile on screen even though it owes nothing", () => {
    const over = holderLedgers(
      alsoHeldByYou(
        [
          party([
            seat("m1", "Husky", { mine: true }),
            seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
          ]),
        ],
        [pool([{ ...coupon(60), bundles: 2 }])],
        VESTIGE,
        ORDER,
        [],
      ),
      new Map(),
      keptByHolder([{ holder: SELF, pieces: 40, amount: null }]),
    )[0]!;
    expect(owes(over)).toBe(0);
    expect(worthDrawing([over], none).drawn).toHaveLength(1);
  });
});

// A source test rather than a unit one: what went wrong was a condition in the JSX, not a figure.
// The option list is where the dead end was, so this is the line that must not come back.
const source = readFileSync(join(__dirname, "..", "components", "piece-ledger.tsx"), "utf8");

/** The picker itself, so a stray "SELF" elsewhere in the card cannot satisfy these. */
const picker = source.match(/<select[\s\S]*?<\/select>/);

describe("the picker the card draws", () => {
  it("draws an option per fate rather than a hand-written list", () => {
    expect(picker).not.toBeNull();
    expect(picker![0]).toContain("FATES.map");
  });

  it("gates no option on whose pile it is, which is what left yours unanswerable", () => {
    expect(picker![0]).not.toContain('!== "SELF"');
  });

  it("puts the count behind the question, so a square pile is not asked", () => {
    // The gate is the whole fix. Ungated, the count returns and every square night demands a
    // pile's worth of typing again. It is now the miscount alone: what is outstanding moves in the
    // header, so a second line restating it would be the same fact twice.
    expect(source).toMatch(/overEntered > 0 && \(\s*<span className="ledger-progress">/);
  });

  it("gates the form on the debt, so a pile that owes nobody is not asked to type", () => {
    expect(source).toMatch(/\{outstanding > 0 \? \(\s*<form/);
  });

  it("never gates it on the count, which is the pile and not the question", () => {
    // The near miss. `unaccounted` is the whole pile less what has been entered, so gating on it
    // hides the form on a pile that owes nobody AND on one that has simply been fully accounted
    // for, and re-breaks what alsoHeldByYou exists for: a Sale Ledger that will not admit you hold
    // the coupons cannot take the sale.
    expect(source).not.toContain("unaccounted(");
  });

  it("says the boxes are gone, and offers nothing that would open them again", () => {
    // The card states the position and takes no entry. A control that reopened the boxes went with
    // the one on the page: see the block below for what that costs.
    expect(source).toContain("No vestiges outstanding");
    expect(source).not.toMatch(/setEntering/);
    expect(source).not.toContain("Record a sale");
  });

  it("suggests the debt and never the pile, in either direction", () => {
    // A fallback to the room is a fallback to the whole unaccounted pile: settling 70 of 1495 left
    // the box offering 1425, which is the wrong question `outstanding` was put here to stop asking.
    expect(source).toContain("const suggested = Math.min(outstanding, room);");
    expect(source).not.toContain("outstanding > 0 ? outstanding : room");
  });

  it("words the purchase for the pile it is drawn on, since the directions are opposite claims", () => {
    // "they took mine" on your own pile says the reverse of what it would mean.
    expect(source).toContain("I took theirs, at a price");
    expect(source).toContain("they took mine, at a price");
  });
});

// A held-back pile has no way back. Both controls that asked for one were removed on request, so a
// pile of coupons that owes nobody is unsellable through the app until it owes somebody again, and a
// tranche mistyped on a settled pile can no longer be taken back off. Nothing in lib can see the
// Drop Log's own wiring, so the cost is pinned here: restoring either control means changing these.
const page = readFileSync(join(__dirname, "..", "app", "bosses", "drops", "page.tsx"), "utf8");

describe("the piles the ledger holds back", () => {
  it("offers no way to ask for one", () => {
    expect(page).not.toContain("Record a sale");
    expect(page).not.toContain("sellingOwn");
  });

  it("draws the drawn ones and nothing else", () => {
    expect(page).toMatch(/const \{ drawn \} = worthDrawing\(/);
    expect(page).not.toContain("revealed");
    expect([...page.matchAll(/<PieceLedger /g)]).toHaveLength(1);
  });

  it("keeps no half of the reveal behind, which would open boxes nothing asks for", () => {
    // The prop and the focus effect were one fact with the control. Left wired to a `false` nobody
    // sets, they are a card that opens its boxes for a reason no longer on screen.
    expect(source).not.toContain("forEntry");
    expect(source).not.toContain("focusEntry");
  });

  it("gates the heading on what will draw, not on there being ledgers at all", () => {
    // A heading over no cards is a heading over nothing, and holding a pile back is exactly what
    // empties the section underneath it. The revealed card is outside the section, so it is `drawn`
    // that decides, not the piles on screen.
    expect(page).not.toMatch(/anythingToPrice \|\| ledgers\.length > 0/);
    expect(page).toMatch(/anythingToPrice \|\| drawn\.length > 0/);
  });

  it("draws no card for somebody else's pile, whose debt is the Settlement Ledger's to state", () => {
    // The old per-holder history card. It survived only to un-type rows entered under an entry shape
    // that is gone, and stated no debt at all, so it read as a blank pane with a name on it.
    expect(page).not.toContain("TrancheHistory");
  });

  it("keeps a payment removable where it is entered, which is the Settlement Ledger", () => {
    // The history card was the one place a payment could be taken back. Deleting it without this
    // would leave a mistyped payment on the books with no way to reach it.
    const settlement = readFileSync(
      join(__dirname, "..", "components", "settlement-ledger.tsx"),
      "utf8",
    );
    expect(settlement).toContain("onRemovePayment");
    expect(page).toMatch(/onRemovePayment=\{\(paymentId\) =>/);
  });

  it("counts only what draws, so the empty line is not held off by a card nobody sees", () => {
    expect(page).toMatch(/holders: drawn\.length,/);
  });
});

// A sale is two numbers again: how many went and for how much. Who gets what comes off the debts the
// ledger already knows, which is what #362's per-creditor box asked the reader to work out.
describe("distributing a sale over the people it owes", () => {
  const bro = { key: "person:p-bro", name: "Bro", pieces: 70 };
  const jared = { key: "person:p-jared", name: "Jared", pieces: 20 };

  it("pays the debts off first, biggest first, and leaves the rest yours", () => {
    // 100 sold against 90 of debt: both settled, and 10 of the money is your own.
    const out = distributeSale(100, [jared, bro]);
    expect(out.map((s) => [s.creditor.name, s.pieces])).toEqual([
      ["Bro", 70],
      ["Jared", 20],
    ]);
  });

  it("stops at the sale, so a part-sale credits nobody for coupons still sitting there", () => {
    // 50 sold against 90 owed. The biggest debt takes it, and Jared's is untouched: crediting him a
    // slice of a sale that did not cover Bro would state money for pieces that never went.
    expect(distributeSale(50, [bro, jared])).toEqual([{ creditor: bro, pieces: 50 }]);
  });

  it("never credits a creditor past their own debt", () => {
    expect(distributeSale(500, [bro])).toEqual([{ creditor: bro, pieces: 70 }]);
  });

  it("gives the same answer whatever order the debts arrive in", () => {
    // The order is arbitrary between two creditors and has to be, so it is fixed rather than
    // incidental: nothing about the coupons themselves says whose went to market.
    expect(distributeSale(80, [bro, jared])).toEqual(distributeSale(80, [jared, bro]));
  });

  it("has nothing to say about a sale of nothing, or a pile that owes nobody", () => {
    expect(distributeSale(0, [bro])).toEqual([]);
    expect(distributeSale(50, [])).toEqual([]);
    // A creditor already square drops out rather than taking a zero share.
    expect(distributeSale(50, [{ ...bro, pieces: 0 }])).toEqual([]);
  });
});

describe("which recorded sales the card still draws a row for", () => {
  const SELF: Holder = { kind: "SELF", personId: null, characterName: null };
  const BRO: Holder = { kind: "PERSON", personId: "p-bro", characterName: null };
  const JARED: Holder = { kind: "PERSON", personId: "p-jared", characterName: null };

  const tranche = (id: string, shares?: { holder: Holder }[]) => ({ id, holder: SELF, shares });
  /** decidedSales' answer: which sales somebody has said what happens to the money of. */
  const decided = (...pairs: [string, Holder[]][]) =>
    new Map(pairs.map(([id, who]) => [id, new Set(who.map(holderKey))]));

  it("keeps one nobody has decided about, its money still sitting in your hands", () => {
    // Naming Bro is not settling with Bro: until somebody says whether the money is sent or comes
    // off his debt, the sale is the thing still to deal with.
    expect(stillAsking([tranche("t1", [{ holder: BRO }])], decided()).map((t) => t.id)).toEqual([
      "t1",
    ]);
  });

  it("drops one whose money has been paid out or offset, count and all", () => {
    // Jonathan's report. A finished sale is not this card's, and a count of them is not either: it
    // was still finished work standing on a worklist, one line further down.
    expect(stillAsking([tranche("t1", [{ holder: BRO }])], decided(["t1", [BRO]]))).toEqual([]);
  });

  it("keeps one settled with only one of the two people whose coupons were in it", () => {
    // One sale can hold two piles' worth, and each of them decides separately. Dropping it on the
    // first would take the second person's money off the only screen that says it is undecided.
    const both = [{ holder: BRO }, { holder: JARED }];
    expect(stillAsking([tranche("t1", both)], decided(["t1", [BRO]])).map((t) => t.id)).toEqual([
      "t1",
    ]);
  });

  it("keeps one that named nobody, which nothing can ever decide about", () => {
    // A plain sale of your own coupons, and a purchase from before shares existed. Neither owes
    // anybody, so no decision is coming, and no other screen carries the row.
    const shown = stillAsking([tranche("t1"), tranche("t2", [])], decided());
    expect(shown.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("keeps one whose only share is the pile's own holder, who is owed nothing", () => {
    // The same rule answeredSalesByPair applies. If the two disagreed, a sale could vanish from the card
    // while still asking on it, which is the one state neither screen can be corrected from.
    const shown = stillAsking([tranche("t1", [{ holder: SELF }])], decided(["t1", [SELF]]));
    expect(shown.map((t) => t.id)).toEqual(["t1"]);
  });

  it("takes the finished ones out without reordering what is left", () => {
    const shown = stillAsking(
      [
        tranche("t1"),
        tranche("t2", [{ holder: BRO }]),
        tranche("t3", [{ holder: BRO }]),
        tranche("t4", [{ holder: BRO }]),
      ],
      decided(["t2", [BRO]], ["t4", [BRO]]),
    );
    expect(shown.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("gives a sale back the moment the decision behind it is taken off", () => {
    // The way back, and the reason dropping a finished sale strands nothing. Undoing the offset on
    // the Settlement card puts the money in your hands undecided, and the row returns here.
    const sales = [tranche("t1", [{ holder: BRO }])];
    expect(stillAsking(sales, decided(["t1", [BRO]]))).toEqual([]);
    expect(stillAsking(sales, decided())).toEqual(sales);
  });
});

// The bug Jonathan reported, at its smallest: the Sale Ledger said Extreme Kalos owed Bro 60 while the
// Settlement Ledger said 20 off the same night. The fold here was ALL-OR-NOTHING, so a night whose
// credit could not finish it OUTRIGHT was drawn at its gross figure while the header above had already
// counted the answer. One night, one creditor, and the card contradicting itself.
describe("a night the answer only part covers", () => {
  /** 30 of the 60 in your inventory are Bro's, and a sale has named 20 of them. */
  const partly = () =>
    yourPile(0, { pieces: 0, paid: 0 }, { pieces: 20, amount: 400 * M, theirs: 20 });

  it("lists what is LEFT on the night, not what it started as", () => {
    const { owing } = queueOf(partly());
    expect(owing).toHaveLength(1);
    expect(owing[0]!.transfers.map((t) => t.pieces)).toEqual([10]);
  });

  it("adds up to the header over it", () => {
    const mine = partly();
    const listed = queueOf(mine)
      .owing.flatMap((n) => n.transfers)
      .reduce((sum, t) => sum + t.pieces, 0);
    expect(listed).toBe(outstandingOf(mine));
    expect(outstandingOf(mine)).toBe(10);
  });

  it("names the creditor for what is left, not for what was answered", () => {
    // The header's own words. It totalled the transfers itself and took off only their own coupons, so
    // it went on naming a debt a sale had already priced.
    expect(owedByCreditor(partly())).toEqual([{ key: "person:p-bro", name: "Bro", pieces: 10 }]);
  });

  it("still asks, because 10 pieces are still somebody else's", () => {
    expect(asksAnything(partly())).toBe(true);
    expect(settledOf(partly())).toBe(20);
  });

  it("folds the night once nothing is left on it, and counts it instead", () => {
    const done = yourPile(0, { pieces: 0, paid: 0 }, { pieces: 30, amount: 600 * M, theirs: 30 });
    const { owing, answered } = queueOf(done);
    expect([owing.length, answered]).toEqual([0, 1]);
    expect(outstandingOf(done)).toBe(0);
  });

  it("counts a creditor's own coupons in your inventory as the answer too", () => {
    // The credit `owes` has always netted, now reaching the rows as well. Bro holding 12 of yours
    // makes 12 of what you owe him nothing changing hands, so the night says 18 rather than 30.
    const held = new Map([["person:p-bro", 12]]);
    expect(queueOf(yourPile(), held).owing[0]!.transfers.map((t) => t.pieces)).toEqual([18]);
    expect(outstandingOf(yourPile(), held)).toBe(18);
  });

  it("stops a SECOND sale attributing pieces the first already answered", () => {
    // owedByCreditor is what feeds distributeSale, so netting the answer there is also what keeps one
    // debt from being answered twice: 30 were Bro's, 20 are priced, and 10 are left to name.
    expect(distributeSale(30, owedByCreditor(partly())).map((s) => s.pieces)).toEqual([10]);
  });

  it("keeps a purchase that named nobody answering the PILE, since V50 says it answers one in full", () => {
    // It cannot come off a night or a creditor: answeredSalesByPair refuses to guess whose pieces they
    // were, and naming one would discharge a debt against somebody who never agreed. So the header
    // falls and the rows do not, which is the safe direction for a worklist.
    const bought = yourPile(0, { pieces: 30, paid: 700 * M });
    expect(outstandingOf(bought)).toBe(0);
    expect(queueOf(bought).owing[0]!.transfers.map((t) => t.pieces)).toEqual([30]);
  });
});
