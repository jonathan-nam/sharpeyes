import { describe, expect, it } from "vitest";
import { buildDropLog, groupDrops } from "./drop-log";
import { buildSettlement, isEmpty, offsetOf, settlementTotals } from "./settlement";
import { saleMoney, splitOf } from "./loot";
import { buildWallet } from "./wallet";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

// A drop sold for real money, from the split to the card it ends up on.
//
// The rule every case here is about: DOLLARS AND MESOS NEVER MEET. There is no rate in this app, so
// a total made of both would be a figure with no meaning stated as confidently as one with a
// meaning, which is the failure this repo exists to prevent. Two sums, always.

const member = (id: string, name: string, mine: boolean): PartyMember => ({
  id,
  name,
  personId: `person-${id}`,
  personName: null,
  characterId: mine ? `char-${id}` : null,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const SEATS = [
  member("m1", "Rune", true),
  member("m2", "Steve", false),
  member("m3", "Bob", false),
];

const party = (): Party =>
  ({
    id: "pa1",
    bossKey: "kaling",
    difficulty: "HARD",
    characterId: "char-m1",
    worldType: "INTERACTIVE",
    seats: SEATS,
    members: SEATS,
  }) as unknown as Party;

/** The hammer, sold for $1000 by your own seat, with two others owed a share. */
const inDollars = (over: Partial<Loot> = {}): Loot => ({
  id: "l1",
  dropKey: "exceptional-hammer-earrings",
  customName: null,
  name: "Exceptional Hammer (Earrings)",
  iconUrl: null,
  perMember: null,
  bossKey: "kaling",
  quantity: 1,
  difficulty: null,
  droppedOn: "2026-09-03",
  weekStart: "2026-09-03",
  status: "SOLD",
  // Null, and that is the point: the meso column is empty on a dollar sale, so anything that has
  // not been taught about cents reads "no price" rather than a price a thousand times too small.
  saleAmount: null,
  saleUsdCents: 100_000,
  amountBasis: "RECEIVED",
  splitMethod: "LAZY",
  sellerShares: 1,
  sellerMemberId: "m1",
  takenByMemberId: null,
  soldAt: "2026-09-04T10:00:00Z",
  payouts: [
    { memberId: "m2", paid: false, paidAt: null, shares: 1 },
    { memberId: "m3", paid: false, paidAt: null, shares: 1 },
  ],
  ranThatWeek: ["m1", "m2", "m3"],
  bundles: null,
  bundlesBy: [],
  ...over,
});

const pools = (loot: Loot[]): PartyLootPool[] => [{ partyId: "pa1", loot }] as PartyLootPool[];

describe("what a dollar sale splits into", () => {
  it("reads the price out of the cents column and says which unit it is", () => {
    expect(saleMoney(inDollars())).toEqual({ amount: 100_000, currency: "USD" });
  });

  it("takes no Auction House cut, because no Auction House was involved", () => {
    const split = splitOf(inDollars(), SEATS)!;
    expect(split.currency).toBe("USD");
    // $1000 three ways. Payouts round UP and the seller absorbs the dust, which is splitDrop's
    // existing rule and not a dollar one: 33334 + 33334 leaves the seller 33332.
    expect(split.shares.map((s) => s.pay)).toEqual([33_334, 33_334]);
    expect(split.seller.keeps).toBe(33_332);
    // Nothing comes off a hop either, so what they are sent is what they get.
    expect(split.shares.map((s) => s.nets)).toEqual([33_334, 33_334]);
    expect(split.shares.map((s) => s.fee)).toEqual([0, 0]);
  });

  it("comes to the whole price, so no cent is invented or lost", () => {
    const split = splitOf(inDollars(), SEATS)!;
    const paidOut = split.shares.reduce((sum, s) => sum + s.pay, 0);
    expect(split.seller.keeps + paidOut).toBe(100_000);
  });

  it("splits the same either method, which is why the form stops asking", () => {
    const fair = splitOf(inDollars({ splitMethod: "FAIR" }), SEATS)!;
    const lazy = splitOf(inDollars({ splitMethod: "LAZY" }), SEATS)!;
    expect(fair.shares.map((s) => s.pay)).toEqual(lazy.shares.map((s) => s.pay));
  });

  it("refuses the whole split rather than reading cents as mesos on an older build", () => {
    // What a tab open across the deploy holds: lib/cache.ts hands back the shape the API had when
    // the page last fetched, so a dollar sale arrives with neither price. splitOf declines.
    const cached = inDollars();
    delete (cached as { saleUsdCents?: number | null }).saleUsdCents;
    expect(saleMoney(cached)).toBeNull();
    expect(splitOf(cached, SEATS)).toBeNull();
  });
});

describe("where a dollar share lands in the wallet", () => {
  it("sums apart from the mesos and never into them", () => {
    const wallet = buildWallet([party()], pools([inDollars()]));
    expect(wallet.owe).toBe(0);
    expect(wallet.usd.owe).toBe(66_668);
    // Name order, because the two owe the same in both units: the meso key ties, then the dollar
    // key ties, and the name breaks it. See buildWallet's sort.
    expect(wallet.counterparties.map((c) => [c.name, c.owe, c.usd.owe])).toEqual([
      ["Bob", 0, 33_334],
      ["Steve", 0, 33_334],
    ]);
  });

  it("tags each line with the unit its own drop sold in", () => {
    const meso = inDollars({
      id: "l2",
      saleAmount: 9_000_000_000,
      saleUsdCents: null,
      payouts: [{ memberId: "m2", paid: false, paidAt: null, shares: 1 }],
    });
    const wallet = buildWallet([party()], pools([inDollars(), meso]));
    const steve = wallet.counterparties.find((c) => c.name === "Steve")!;
    expect(steve.lines.map((l) => l.currency).sort()).toEqual(["MESO", "USD"]);
    // One person, two debts, two units, and the card owes both without adding them.
    expect(steve.owe).toBeGreaterThan(0);
    expect(steve.usd.owe).toBe(33_334);
  });
});

describe("what the settlement card does with it", () => {
  const cards = () => buildSettlement([], buildWallet([party()], pools([inDollars()])));

  it("carries the dollars in their own pair, outside every meso figure", () => {
    const steve = cards().find((row) => row.name === "Steve")!;
    expect(steve.usd.owe).toBe(33_334);
    expect([steve.mesos, steve.sharesYouOwe, steve.owedByYou]).toEqual([0, 0, 0]);
  });

  it("draws a card at all when a dollar share is the only thing between you", () => {
    // The trap: every figure the filter reads is a meso one, so without this the card is dropped
    // and the share has nowhere to be marked paid. A debt nothing draws is a debt nobody collects.
    const steve = cards().find((row) => row.name === "Steve");
    expect(steve).toBeDefined();
    expect(isEmpty(steve!)).toBe(false);
  });

  it("totals the two units side by side", () => {
    const totals = settlementTotals(cards());
    expect([totals.owe, totals.owed]).toEqual([0, 0]);
    expect(totals.usd.owe).toBe(66_668);
  });

  it("will not offset a dollar share against a meso debt", () => {
    // An offset writes a signed row into settlement_debt, which is mesos, and comes off `mesos`,
    // which is mesos. Putting cents through it would take $333.34 off a meso debt and call the
    // difference settled.
    const steve = cards().find((row) => row.name === "Steve")!;
    const offset = offsetOf(steve);
    expect(offset.parts).toEqual([]);
    expect(offset.amount).toBe(0);
    expect(offset.offered).toBe(false);
  });
});

describe("what the totals over many sales come to", () => {
  const log = () => {
    const meso = inDollars({
      id: "l2",
      saleAmount: 9_000_000_000,
      saleUsdCents: null,
      payouts: [{ memberId: "m2", paid: false, paidAt: null, shares: 1 }],
    });
    return buildDropLog([party()], pools([inDollars(), meso]), {});
  };

  it("keeps the cents out of the meso column and states them beside it", () => {
    // The whole reason this pair exists. One 9b sale and one $1000 sale on one account: 9,000,000,000
    // and $1,000.00, never 9,000,100,000 of nothing.
    const totals = log().totals;
    expect(totals.pooled).toBe(9_000_000_000);
    expect(totals.usd.pooled).toBe(100_000);
    expect(totals.sold).toBe(2);
  });

  it("subtotals a group the same way, so the sections add up to the head", () => {
    const groups = groupDrops(log().entries, "month");
    expect(groups).toHaveLength(1);
    expect([groups[0]!.pooled, groups[0]!.usd.pooled]).toEqual([9_000_000_000, 100_000]);
  });
});
