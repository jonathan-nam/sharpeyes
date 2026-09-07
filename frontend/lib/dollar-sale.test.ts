import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDropLog, groupDrops } from "./drop-log";
import { buildSettlement, isEmpty, offsetOf, settlementTotals, sharesOf } from "./settlement";
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
    // Nothing comes off a hop, so what they are sent is what they get.
    expect(split.shares.map((s) => s.nets)).toEqual(split.shares.map((s) => s.pay));
    expect(split.shares.map((s) => s.fee)).toEqual([0, 0]);
  });

  it("pays the figure everybody already worked out, and leaves the cent with the holder", () => {
    // $1000 three ways is $333.33. Rounding UP, which is the meso rule, would pay $333.34 and make
    // every number on the screen disagree with the division in the reader's head over a cent. The
    // dust goes to the holder instead, who is the one person not checking. See SplitInput.rounding.
    const split = splitOf(inDollars(), SEATS)!;
    expect(split.shares.map((s) => s.pay)).toEqual([33_333, 33_333]);
    expect(split.seller.keeps).toBe(33_334);
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
    expect(wallet.usd.owe).toBe(66_666);
    // Name order, because the two owe the same in both units: the meso key ties, then the dollar
    // key ties, and the name breaks it. See buildWallet's sort.
    expect(wallet.counterparties.map((c) => [c.name, c.owe, c.usd.owe])).toEqual([
      ["Bob", 0, 33_333],
      ["Steve", 0, 33_333],
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
    expect(steve.usd.owe).toBe(33_333);
  });
});

describe("what the settlement card does with it", () => {
  const cards = () => buildSettlement([], buildWallet([party()], pools([inDollars()])));

  it("carries the dollars in their own pair, outside every meso figure", () => {
    const steve = cards().find((row) => row.name === "Steve")!;
    expect(steve.usd.owe).toBe(33_333);
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
    expect(totals.usd.owe).toBe(66_666);
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

describe("collecting a dollar share", () => {
  // Somebody ELSE sold it and owes your seat, which is the ordinary shape and the one in prod. The
  // card has to offer the act that marks it received, or a debt is drawn with nothing to do about
  // it. `collectable` and `sharesOf` are what the Settle button is built out of, and neither reads
  // a currency, so this is a guard against one of them learning to.
  const theirSale = () =>
    inDollars({
      sellerMemberId: "m2",
      payouts: [
        { memberId: "m1", paid: false, paidAt: null, shares: 1 },
        { memberId: "m3", paid: false, paidAt: null, shares: 1 },
      ],
    });

  it("draws the card with the share pointed at you, and something to press", () => {
    const rows = buildSettlement([], buildWallet([party()], pools([theirSale()])));
    const steve = rows.find((r) => r.name === "Steve")!;
    expect(steve.usd.owed).toBe(33_333);
    // What `collectable` is: any line running towards you. Never the meso figure, which is zero.
    expect(steve.lines.some((line) => line.direction === "owed")).toBe(true);
    // And Settle resolves to your own payout row, so pressing it marks that share received.
    expect(sharesOf(steve)).toEqual([{ lootId: "l1", memberId: "m1" }]);
  });
});

describe("a card that runs both ways at once", () => {
  // The real card: Scanian owes a $333.33 share of the hammer, and you owe Scanian a meso share of
  // a grindstone. Every closing-action caption was written when a card could only be in one unit,
  // so Settle described the mesos alone and collected the dollars without saying so.
  const theirHammer = () =>
    inDollars({
      sellerMemberId: "m2",
      payouts: [
        { memberId: "m1", paid: false, paidAt: null, shares: 1 },
        { memberId: "m3", paid: false, paidAt: null, shares: 1 },
      ],
    });
  const myGrindstone = () =>
    inDollars({
      id: "l2",
      name: "Grindstone of Faith",
      saleAmount: 7_188_888_888,
      saleUsdCents: null,
      amountBasis: "LISTED",
      splitMethod: "FAIR",
      sellerMemberId: "m1",
      payouts: [
        { memberId: "m2", paid: false, paidAt: null, shares: 1 },
        { memberId: "m3", paid: false, paidAt: null, shares: 1 },
      ],
    });

  const card = () => {
    const pools = [{ partyId: "pa1", loot: [theirHammer(), myGrindstone()] }] as PartyLootPool[];
    return buildSettlement([], buildWallet([party()], pools)).find((r) => r.name === "Steve")!;
  };

  it("owes in one unit and is owed in the other, with neither figure standing for both", () => {
    const row = card();
    // What they owe you is dollars only, so every meso figure is zero and a caption built from
    // those figures had nothing true to say about the collecting half.
    expect([row.mesos, row.parts.shares]).toEqual([0, 0]);
    expect(row.usd.owed).toBe(33_333);
    expect(row.sharesYouOwe).toBeGreaterThan(0);
  });

  it("settles both units in one act, which is why the caption has to name both", () => {
    expect(
      sharesOf(card())
        .map((s) => s.lootId)
        .sort(),
    ).toEqual(["l1", "l2"]);
  });
});

describe("what the closing actions say they move", () => {
  const source = readFileSync(join(__dirname, "..", "components", "settlement-ledger.tsx"), "utf8");

  it("names the dollars Settle collects, which no meso figure on the card can", () => {
    expect(source).toContain(
      "row.usd.owed > 0 ? `collects ${formatDollars(row.usd.owed)}` : null,",
    );
  });

  it("names both units in what Mark Sent records, and offers it for a dollar debt at all", () => {
    expect(source).toContain("const sendable = owes > 0 || row.usd.owe > 0 || row.holding > 0;");
    expect(source).toContain("records ${movedBoth(owes, row.usd.owe)} sent to ${row.name}");
    // Side by side, never added: there is no rate in this app to add them at.
    expect(source).toContain('.join(" and ")');
  });
});
