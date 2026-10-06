import { describe, expect, it } from "vitest";
import { bossLabel } from "./boss-difficulty";
import { buildDropAudit } from "./drop-audit";
import { buildDropLog } from "./drop-log";
import { buildSettledLog } from "./settled-log";
import { closedByHolder } from "./vestige-ledger";
import type { Holder } from "./vestige-ledger";
import type { Boss } from "@/types/boss";
import type { DropTables } from "@/types/drop";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";
import type { SettlementDebt, VestigeSettlement } from "@/types/vestige";

// The same fixtures the Settled tab's tests run on, because this page is what those rows open. Two
// of the tests below check the two files agree about a figure rather than only that each is
// self-consistent: they read the same drop and they are what a reader compares.

const M = 1_000_000;
const VESTIGE = "vestige-of-erion";
const BRO: Holder = { kind: "PERSON", personId: "p-bro", characterName: null };
const NAMES = new Map([["person:p-bro", "Bro"]]);

const TABLES: DropTables = {
  limbo: [
    {
      dropKey: VESTIGE,
      name: "Vestige of Erion Coupon",
      iconUrl: null,
      perMember: null,
      worlds: null,
      quantity: 1,
      fungible: false,
      pieces: { INTERACTIVE: { HARD: 60 } },
      bundles: { INTERACTIVE: { HARD: 3 } },
    },
  ],
};

const BOSSES = new Map<string, Boss>([
  ["limbo", { bossKey: "limbo", name: "Limbo", reset: "WEEKLY", iconUrl: null, difficulties: [] }],
]);

const mine = (id: string, name: string): PartyMember => ({
  id,
  name,
  personId: null,
  personName: null,
  characterId: `char-${id}`,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const theirs = (id: string, name: string): PartyMember => ({
  id,
  name,
  personId: "p-bro",
  personName: "Bro",
  characterId: null,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const party = (over: Partial<Party> = {}): Party => ({
  id: "pa",
  slug: "pa",
  characterId: "char-m1",
  solo: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey: "limbo",
  difficulty: "HARD",
  minutes: null,
  members: [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton")],
  seats: [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton")],
  looterMemberId: null,
  usualRoster: true,
  skippedThisPeriod: false,
  oneOff: false,
  pendingLoot: 0,
  awaitingPayout: 0,
  settledLoot: 0,
  cleared: null,
  clearedByHand: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  ...over,
});

const drop = (over: Partial<Loot> = {}): Loot => ({
  id: "l1",
  dropKey: "grindstone-of-faith",
  customName: null,
  name: "Grindstone of Faith",
  iconUrl: null,
  perMember: null,
  bossKey: "limbo",
  quantity: 1,
  difficulty: null,
  droppedOn: "2026-08-06",
  weekStart: "2026-08-06",
  status: "PAID_OUT",
  saleAmount: 10_000 * M,
  amountBasis: "LISTED",
  splitMethod: "FAIR",
  sellerShares: 1,
  sellerMemberId: "m1",
  takenByMemberId: null,
  soldAt: "2026-08-07T10:00:00Z",
  payouts: [{ memberId: "m2", paid: true, paidAt: "2026-08-07T11:00:00Z", shares: 1 }],
  ranThatWeek: ["m1", "m2"],
  bundles: null,
  bundlesBy: [],
  ...over,
});

/** A coupon night the partner looted the lot of: 60 pieces, 30 of them yours. */
const night = (over: Partial<Loot> = {}): Loot =>
  drop({
    id: "n1",
    dropKey: VESTIGE,
    name: "Vestige of Erion Coupon",
    quantity: 60,
    bundles: 3,
    bundlesBy: [{ memberId: "m2", bundles: 3 }],
    status: "PENDING",
    soldAt: null,
    saleAmount: null,
    amountBasis: null,
    splitMethod: null,
    sellerMemberId: null,
    payouts: [],
    ...over,
  });

const act = (over: Partial<VestigeSettlement> = {}): VestigeSettlement => ({
  id: "s1",
  holder: BRO,
  lootIds: ["n1"],
  unpaid: 0,
  settledAt: "2026-08-10T22:00:00Z",
  ...over,
});

const debt = (over: Partial<SettlementDebt> = {}): SettlementDebt => ({
  id: "d1",
  holder: BRO,
  amount: 4_000 * M,
  note: null,
  payouts: [],
  incurredAt: "2026-08-09T09:00:00Z",
  ...over,
});

const pools = (loot: Loot[]): PartyLootPool[] => [{ partyId: "pa", loot }];

/** The audit exactly as the page builds it: the Drop Log's own reading, then this file over it. */
function auditOf(
  loot: Loot[],
  {
    settlements = [],
    debts = [],
    over = {},
    lootId = loot[0]!.id,
  }: {
    settlements?: VestigeSettlement[];
    debts?: SettlementDebt[];
    over?: Partial<Party>;
    lootId?: string;
  } = {},
) {
  const parties = [party(over)];
  const log = buildDropLog(parties, pools(loot), TABLES, closedByHolder(settlements).closed);
  return buildDropAudit(
    lootId,
    log.entries,
    pools(loot),
    parties,
    BOSSES,
    settlements,
    debts,
    NAMES,
    bossLabel,
  );
}

const kinds = (loot: Loot[], opts?: Parameters<typeof auditOf>[1]) =>
  auditOf(loot, opts)?.events.map((e) => e.kind);

describe("what one drop's history says", () => {
  it("reads a sold drop as dropped, then sold, then paid", () => {
    expect(kinds([drop()])).toEqual(["DROPPED", "SOLD", "PAID"]);
  });

  it("names the boss with the party's difficulty, and who was there", () => {
    const first = auditOf([drop()])!.events[0]!;
    expect(first.kind === "DROPPED" && [first.boss, first.at, first.ranWith]).toEqual([
      "Hard Limbo",
      "2026-08-06",
      ["CreedBratton"],
    ]);
  });

  it("keeps what the sale amount MEANS, not just the amount", () => {
    // A listed price and a received one are quantities either side of the Auction House fee. A row
    // that shows the figure without its basis draws two different facts the same way.
    const sold = auditOf([drop({ amountBasis: "RECEIVED" })])!.events.find(
      (e) => e.kind === "SOLD",
    )!;
    expect(sold.kind === "SOLD" && [sold.amount, sold.basis]).toEqual([10_000 * M, "RECEIVED"]);
  });

  it("says what there was to split and your side of it, as the Settled row does", () => {
    const log = buildDropLog([party()], pools([drop()]), TABLES);
    const settled = buildSettledLog(log.entries)[0]!;
    const sold = auditOf([drop()])!.events.find((e) => e.kind === "SOLD")!;
    expect(sold.kind === "SOLD" && [sold.pooled, sold.yourTake]).toEqual([
      settled.sale!.pooled,
      settled.sale!.yourTake,
    ]);
  });

  it("dates a share by when it was marked paid, not by when the drop sold", () => {
    const paid = auditOf([drop()])!.events.find((e) => e.kind === "PAID")!;
    expect([paid.at, paid.kind === "PAID" && paid.who]).toEqual([
      "2026-08-07T11:00:00Z",
      "CreedBratton",
    ]);
  });

  it("puts a share nobody has paid at the end, with no date on it", () => {
    const unpaid = drop({
      status: "SOLD",
      payouts: [{ memberId: "m2", paid: false, paidAt: null, shares: 1 }],
    });
    const events = auditOf([unpaid])!.events;
    expect(events.map((e) => e.kind)).toEqual(["DROPPED", "SOLD", "OWED"]);
    expect(events.at(-1)!.at).toBeNull();
  });

  it("records a taken drop as taken, owing nobody and dating nothing", () => {
    const taken = drop({ status: "TAKEN", takenByMemberId: "m2", soldAt: null, saleAmount: null });
    const events = auditOf([taken])!.events;
    expect(events.map((e) => e.kind)).toEqual(["DROPPED", "TAKEN"]);
    expect(events[1]!.at).toBeNull();
  });
});

// The page was a list of acts and nothing else: where the drop stands, whose config it fell on and
// which world that is were all in hand and none of them drawn. They are facts off the entry and the
// party, so what these pin is that no reading of them was invented on the way through.
describe("what the page says about the drop itself", () => {
  it("carries the state the row that links here was showing", () => {
    expect(auditOf([drop()])!.status).toBe("PAID_OUT");
    expect(auditOf([night()])!.status).toBe("PENDING");
  });

  it("names the config's own character and its world", () => {
    const audit = auditOf([drop()])!;
    expect([audit.character, audit.worldType]).toEqual(["mechyfechy", "INTERACTIVE"]);
  });

  it("still names the character on a week that character sat out", () => {
    // `members` is one week's roster and can be anybody. `seats` is every seat the config ever had,
    // which is the only list the config's own character is certainly on.
    const audit = auditOf([drop()], { over: { members: [theirs("m2", "CreedBratton")] } })!;
    expect(audit.character).toBe("mechyfechy");
  });

  it("says nothing rather than guessing when no seat is the config's character", () => {
    const audit = auditOf([drop()], { over: { characterId: "char-gone" } })!;
    expect(audit.character).toBeNull();
  });

  it("carries the week as the server reckoned it, not a week read off the date", () => {
    expect(auditOf([drop({ droppedOn: "2026-08-09" })])!.weekStart).toBe("2026-08-06");
  });

  it("counts your share of a divided night apart from what fell", () => {
    // The whole point of carrying both: the Drop Log row that opens this page counts the night as
    // 30 and the pool counts it as 60, and the page used to show only the second.
    const audit = auditOf([night()])!;
    expect([audit.yours, audit.quantity]).toEqual([30, 60]);
  });

  it("makes the two counts equal on a drop that did not divide", () => {
    // What lets the header drop back to a plain count: there is no share to state.
    const audit = auditOf([drop()])!;
    expect(audit.yours).toBe(audit.quantity);
  });
});

describe("an offset and the share it discharged", () => {
  it("is one act, not a payment as well", () => {
    // The offset marked the payout PAID, which is its bookkeeping and not a second thing that
    // happened. Drawn as both, one share came off the debt twice on screen. See V58.
    const events = auditOf([drop()], {
      debts: [debt({ payouts: [{ lootId: "l1", memberId: "m2" }] })],
    })!.events;
    expect(events.map((e) => e.kind)).toEqual(["DROPPED", "SOLD", "OFFSET"]);
  });

  it("carries the same figure the Settlement Ledger's own row does", () => {
    // `share.pay` on both, which is what the ledger discharges. `nets` is the same share after the
    // fee on the transfer, and quoting one where the other page quotes the other is two answers.
    const offset = auditOf([drop()], {
      debts: [debt({ payouts: [{ lootId: "l1", memberId: "m2" }] })],
    })!.events.find((e) => e.kind === "OFFSET")!;
    expect(offset.kind === "OFFSET" && [offset.who, offset.at]).toEqual([
      "Bro",
      "2026-08-09T09:00:00Z",
    ]);
    expect(offset.kind === "OFFSET" && offset.amount).toBeGreaterThan(0);
  });

  it("ignores an offset against a different drop", () => {
    const events = auditOf([drop()], {
      debts: [debt({ payouts: [{ lootId: "somewhere-else", memberId: "m2" }] })],
    })!.events;
    expect(events.map((e) => e.kind)).toEqual(["DROPPED", "SOLD", "PAID"]);
  });
});

describe("a coupon night", () => {
  it("reads as dropped, looted, then settled", () => {
    expect(kinds([night()], { settlements: [act()] })).toEqual(["DROPPED", "HELD", "SETTLED"]);
  });

  it("says whose hands the coupons are in, and how many are yours", () => {
    const held = auditOf([night()])!.events.find((e) => e.kind === "HELD")!;
    expect(held.kind === "HELD" && [held.other, held.pieces, held.yours]).toEqual([
      "CreedBratton",
      30,
      true,
    ]);
  });

  // The same night the other way round, which is the ordinary one: you bend down for all three
  // stacks. Read off `owedBy` alone this page drew no HELD row at all, and headed itself "In the
  // pool" over 30 coupons that were Bro's.
  const yourNight = (over: Partial<Loot> = {}) =>
    night({ bundlesBy: [{ memberId: "m1", bundles: 3 }], ...over });

  it("says so where it is YOU holding somebody else's share", () => {
    const held = auditOf([yourNight()])!.events.find((e) => e.kind === "HELD")!;
    expect(held.kind === "HELD" && [held.other, held.pieces, held.yours]).toEqual([
      "Bro",
      30,
      false,
    ]);
  });

  it("heads itself with what is left to do, in the Drop Ledger's own words", () => {
    // A coupon night never sells, so its raw status is PENDING for ever and "In the pool" was a
    // permanent label that said nothing. The badge on the row that links here says these.
    expect(auditOf([yourNight()])!.stage).toBe("To hand over");
    expect(auditOf([night()])!.stage).toBe("Owed");
    expect(auditOf([drop()])!.stage).toBe("Settled");
  });

  it("states no price, however much its coupons later sold for", () => {
    // Pieces sell in lots that name no night, and the machinery that apportioned a lot back over
    // the nights it covered was deleted on purpose. See lib/piece-ledger.ts.
    const events = auditOf([night()], { settlements: [act()] })!.events;
    expect(events.some((e) => e.kind === "SOLD")).toBe(false);
  });

  it("spreads a write-off the way the Settled tab spreads it", () => {
    const two = [night(), night({ id: "n2", droppedOn: "2026-08-13", weekStart: "2026-08-13" })];
    const closing = act({ lootIds: ["n1", "n2"], unpaid: 101 });
    const log = buildDropLog([party()], pools(two), TABLES, closedByHolder([closing]).closed);
    const settled = buildSettledLog(log.entries, [closing], NAMES);

    for (const lootId of ["n1", "n2"]) {
      const row = settled.find((r) => r.lootId === lootId)!;
      const event = auditOf(two, { settlements: [closing], lootId })!.events.find(
        (e) => e.kind === "SETTLED",
      )!;
      expect(event.kind === "SETTLED" && event.writtenOff).toEqual(row.writtenOff);
    }
  });
});

describe("what it refuses to draw", () => {
  it("answers with nothing for a drop the log does not have", () => {
    expect(auditOf([drop()], { lootId: "never-existed" })).toBeNull();
  });

  it("leaves the shares off a sale whose split cannot be read", () => {
    // splitOf refuses the whole drop when a payout names a seat that has left, so there is no
    // share to state. "Paid 0" is the confident wrong number this repo exists to prevent.
    const gone = drop({
      payouts: [{ memberId: "m9", paid: true, paidAt: "2026-08-07T11:00:00Z", shares: 1 }],
    });
    const events = auditOf([gone])!.events;
    expect(events.map((e) => e.kind)).toEqual(["DROPPED", "SOLD"]);
    const sold = events[1]!;
    expect(sold.kind === "SOLD" && [sold.pooled, sold.yourTake]).toEqual([null, null]);
  });

  it("says a retired config rather than linking to it", () => {
    // Its pool is kept and Party View does not list it, so there is nowhere for the link to go.
    expect(auditOf([drop()], { over: { retired: true } })!.partyRetired).toBe(true);
    expect(auditOf([drop()])!.partyRetired).toBe(false);
  });
});
