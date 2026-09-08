import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDropLog } from "./drop-log";
import { buildSettledLog, consolidateSettled, orphansOf, settledTotals } from "./settled-log";
import { closedByHolder } from "./vestige-ledger";
import type { Holder } from "./vestige-ledger";
import type { DropTables } from "@/types/drop";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";
import type { VestigeSettlement } from "@/types/vestige";

const M = 1_000_000;
const VESTIGE = "vestige-of-erion";
const BRO: Holder = { kind: "PERSON", personId: "p-bro", characterName: null };
const NAMES = new Map([["person:p-bro", "Bro"]]);

/** The coupon table for the boss the fixtures run, which is what makes a row a PIECE drop. */
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
      untradeable: false,
      pieces: { INTERACTIVE: { HARD: 60 } },
      bundles: { INTERACTIVE: { HARD: 3 } },
    },
  ],
};

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
    // Bro bent down for all three stacks, so 30 of the 60 in his inventory are yours.
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

const pool = (loot: Loot[]): PartyLootPool => ({ partyId: "pa", loot });

const act = (over: Partial<VestigeSettlement> = {}): VestigeSettlement => ({
  id: "s1",
  holder: BRO,
  lootIds: ["n1"],
  unpaid: 0,
  settledAt: "2026-08-10T22:00:00Z",
  ...over,
});

/** The log the view is built on, exactly as the page builds it. */
const logOf = (loot: Loot[], settlements: VestigeSettlement[] = [], over: Partial<Party> = {}) =>
  buildDropLog(
    [party(over)],
    [pool(loot)],
    TABLES,
    closedByHolder(settlements.map((s) => ({ ...s, lootIds: s.lootIds }))).closed,
  ).entries;

describe("what the Settled View records", () => {
  it("records a drop that sold and paid out", () => {
    const rows = buildSettledLog(logOf([drop()]));
    expect(rows).toHaveLength(1);
    expect([rows[0]!.kind, rows[0]!.name, rows[0]!.settledOn]).toEqual([
      "MONEY",
      "Grindstone of Faith",
      "2026-08-07T10:00:00Z",
    ]);
  });

  it("keeps what the amount MEANS, not just the amount", () => {
    // A listed price and a received price are different quantities, one before the Auction House cut
    // and one after. A row showing the figure without its basis is two different facts drawn the
    // same way. See drop-log.ts.
    const rows = buildSettledLog(logOf([drop({ amountBasis: "RECEIVED" })]));
    expect([rows[0]!.sale?.amount, rows[0]!.sale?.basis]).toEqual([10_000 * M, "RECEIVED"]);
  });

  it("leaves out a drop still in the pool, and one sold whose share YOU still owe", () => {
    // The unpaid payout is the point of the second one. It used to carry a bare status of SOLD with
    // its only payout already ticked, which the server cannot produce (it derives the status from
    // the payouts) and which now reads as settled, correctly.
    const owing = drop({
      id: "l2",
      status: "SOLD",
      payouts: [{ memberId: "m2", paid: false, paidAt: null, shares: 1 }],
    });
    // PENDING means UNSOLD, so the row has to say so in full: a bare status override left a soldAt
    // and a paid payout on it, which the server cannot produce either.
    const pending = drop({
      id: "l1",
      status: "PENDING",
      soldAt: null,
      saleAmount: null,
      amountBasis: null,
      splitMethod: null,
      sellerMemberId: null,
      payouts: [],
    });
    const rows = buildSettledLog(logOf([pending, owing]));
    expect(rows).toEqual([]);
  });

  it("records a drop whose only unpaid share is between two OTHER people", () => {
    // The case this rule exists for. Somebody else sold it, you have been paid, and the share still
    // open is theirs to settle with a third person: they do it directly and nothing about it
    // reaches this account. Waiting on it means waiting for a fact nobody here can observe, and
    // ticking it to move the drop along would be recording a guess. See settledForYou.
    const seats = [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton"), theirs("m3", "Jared")];
    const theirSale = drop({
      status: "SOLD",
      sellerMemberId: "m2",
      ranThatWeek: ["m1", "m2", "m3"],
      payouts: [
        { memberId: "m1", paid: true, paidAt: "2026-08-07T11:00:00Z", shares: 1 },
        { memberId: "m3", paid: false, paidAt: null, shares: 1 },
      ],
    });
    const rows = buildSettledLog(logOf([theirSale], [], { members: seats, seats }));
    expect(rows.map((r) => r.name)).toEqual(["Grindstone of Faith"]);
  });

  it("still holds a drop open where the unpaid share is one YOU are owed", () => {
    // The mirror, and the reason this is not just "settled once you stop caring": a share running
    // towards you is one you can see arrive, so it goes on holding the drop open.
    const seats = [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton"), theirs("m3", "Jared")];
    const theirSale = drop({
      status: "SOLD",
      sellerMemberId: "m2",
      ranThatWeek: ["m1", "m2", "m3"],
      payouts: [
        { memberId: "m1", paid: false, paidAt: null, shares: 1 },
        { memberId: "m3", paid: true, paidAt: "2026-08-07T11:00:00Z", shares: 1 },
      ],
    });
    expect(buildSettledLog(logOf([theirSale], [], { members: seats, seats }))).toEqual([]);
  });

  it("records a drop that was taken, with no sale and no settlement date", () => {
    // Terminal the way a payout is: somebody has the item and nothing further is owed. There is no
    // act to date, because nothing was ever owed to settle.
    const taken = drop({ status: "TAKEN", takenByMemberId: "m2", soldAt: null, saleAmount: null });
    const rows = buildSettledLog(logOf([taken]));
    expect([rows[0]!.takenBy, rows[0]!.sale, rows[0]!.settledOn]).toEqual([
      "CreedBratton",
      null,
      null,
    ]);
  });

  it("names a taker who has since left the party", () => {
    // Off `seats` and never `members`. A seat that left still took the item.
    const gone = { ...theirs("m3", "Freeballynn"), guest: true };
    const taken = drop({ status: "TAKEN", takenByMemberId: "m3", soldAt: null, saleAmount: null });
    const rows = buildSettledLog(
      logOf([taken], [], { seats: [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton"), gone] }),
    );
    expect(rows[0]!.takenBy).toBe("Freeballynn");
  });

  it("records a coupon night by the act that closed it, not by its status", () => {
    // A piece drop is settled through the tranche ledger and never through a sale on its own row, so
    // its status stays PENDING for ever. Reading the status would file every coupon night the
    // account has ever had as unfinished.
    const rows = buildSettledLog(logOf([night()], [act()]), [act()], NAMES);
    expect(rows).toHaveLength(1);
    expect([rows[0]!.kind, rows[0]!.holderName, rows[0]!.pieces]).toEqual(["PIECES", "Bro", 30]);
  });

  it("leaves a coupon night out until somebody closes it", () => {
    expect(buildSettledLog(logOf([night()]), [], NAMES)).toEqual([]);
  });

  it("records a night closed with two people as two acts", () => {
    // One night's coupons sit in as many piles as there were people bending down, and closing the
    // books with Bro says nothing about Jared. Folding them would name one and drop the other.
    const jared: Holder = { kind: "PERSON", personId: "p-jared", characterName: null };
    const two = [act(), act({ id: "s2", holder: jared, settledAt: "2026-08-11T00:00:00Z" })];
    const rows = buildSettledLog(
      logOf([night()], two),
      two,
      new Map([...NAMES, ["person:p-jared", "Jared"]]),
    );
    expect(rows.map((r) => r.holderName)).toEqual(["Jared", "Bro"]);
    expect(new Set(rows.map((r) => r.lootId))).toEqual(new Set(["n1"]));
  });

  it("says what was written off, spread over the drops the act closed", () => {
    // A write-off is a decision, so it is said rather than absorbed. Per row, because a row is what
    // the reader is looking at.
    const two = [act({ lootIds: ["n1", "n2"], unpaid: 900 })];
    const rows = buildSettledLog(logOf([night(), night({ id: "n2" })], two), two, NAMES);
    expect(rows.map((r) => r.writtenOff)).toEqual([450, 450]);
  });

  it("adds a write-off back up to exactly what was entered", () => {
    // The odd meso goes to the first row rather than being lost. A total that does not add back up
    // is a wrong number wherever the reader happens to sum it.
    const three = [act({ lootIds: ["n1", "n2", "n3"], unpaid: 100 })];
    const rows = buildSettledLog(
      logOf([night(), night({ id: "n2" }), night({ id: "n3" })], three),
      three,
      NAMES,
    );
    expect(rows.reduce((sum, r) => sum + r.writtenOff, 0)).toBe(100);
  });

  it("carries the act's id, so a settlement can be taken back off", () => {
    const rows = buildSettledLog(logOf([night()], [act()]), [act()], NAMES);
    expect(rows[0]!.settlementId).toBe("s1");
  });

  it("puts both kinds in one list, newest finished first", () => {
    const rows = buildSettledLog(logOf([drop(), night()], [act()]), [act()], NAMES);
    expect(rows.map((r) => r.kind)).toEqual(["PIECES", "MONEY"]);
  });

  it("counts a settlement naming a drop the pool no longer has, rather than going quiet", () => {
    // A count that changed still gets said. See CLAUDE.md.
    const stale = [act({ lootIds: ["n1", "gone"] })];
    const entries = logOf([night()], stale);
    expect(buildSettledLog(entries, stale, NAMES)).toHaveLength(1);
    expect(orphansOf(entries, stale)).toBe(1);
  });
});

describe("the totals over what is finished", () => {
  it("counts the two kinds apart, because they do not add", () => {
    const taken = drop({ id: "l2", status: "TAKEN", takenByMemberId: "m2", soldAt: null });
    const rows = buildSettledLog(logOf([drop(), taken, night()], [act()]), [act()], NAMES);
    const totals = settledTotals(rows);
    expect([totals.nights, totals.sales, totals.taken]).toEqual([1, 1, 1]);
  });

  it("totals what there was to split, never the amounts as entered", () => {
    // 10b listed less the seller's 5% is 9.5b landed, which is the only cross-basis sum that means
    // one thing. Same total and same reason as the Drop Log's.
    const rows = buildSettledLog(logOf([drop()]));
    expect(settledTotals(rows).pooled).toBe(9_500 * M);
  });

  it("says what was written off across every act", () => {
    const two = [act({ lootIds: ["n1", "n2"], unpaid: 900 })];
    const rows = buildSettledLog(logOf([night(), night({ id: "n2" })], two), two, NAMES);
    expect(settledTotals(rows).writtenOff).toBe(900);
  });

  it("totals your own share of it, which the Drop Ledger used to state per month", () => {
    // Your side of the 9.5b there was to split, which is not half: you sold it, and splitOf pays the
    // seller for that. The Drop Ledger states no meso now, so this is the only place the figure is,
    // and it comes off the rows drawn under it rather than off a second reading.
    const one = buildSettledLog(logOf([drop()]));
    expect([one[0]!.sale!.yourTake, settledTotals(one).yourTake]).toEqual([
      4_628_205_128, 4_628_205_128,
    ]);
    const two = buildSettledLog(logOf([drop(), drop({ id: "l2" })]));
    expect(settledTotals(two).yourTake).toBe(2 * 4_628_205_128);
  });

  it("counts a split it cannot read, whose money is in neither total", () => {
    // A sale naming a seat that has left its party. Counted rather than left out: an absence
    // nothing says is the silent wrong number this app exists to prevent.
    const rows = buildSettledLog(logOf([drop({ sellerMemberId: "gone" })]));
    const totals = settledTotals(rows);
    expect([totals.unreadable, totals.sales]).toEqual([1, 1]);
    expect([totals.pooled, totals.yourTake]).toEqual([0, 0]);
  });

  it("counts no unreadable split where every sale divides", () => {
    expect(settledTotals(buildSettledLog(logOf([drop()]))).unreadable).toBe(0);
  });

  it("carries the coupon lots, which are on no row", () => {
    // A coupon night has no one price: its pieces sell in lots that name no night, so the money is
    // stated whole or not at all. Without it the view was every sale but the vestiges.
    const rows = buildSettledLog(logOf([drop()]));
    const withLots = settledTotals(rows, { pooled: 2_000 * M, yourTake: 1_200 * M });

    expect(withLots.pooled).toBe(9_500 * M + 2_000 * M);
    expect(withLots.yourTake).toBe(settledTotals(rows).yourTake + 1_200 * M);
    // And the counts are the rows', which coupon lots are not: a lot is not a settled night.
    expect([withLots.nights, withLots.sales]).toEqual([0, 1]);
  });

  it("is the rows alone when no coupons have sold", () => {
    const rows = buildSettledLog(logOf([drop()]));
    expect(settledTotals(rows, { pooled: 0, yourTake: 0 })).toEqual(settledTotals(rows));
  });
});

// A settlement usually closes several nights at once, so drawn flat it is a row per night saying the
// same thing about the same person on the same day, for ever.
describe("folding the nights one act closed", () => {
  it("folds an act's nights into one line", () => {
    const two = [act({ lootIds: ["n1", "n2"] })];
    const lines = consolidateSettled(
      buildSettledLog(logOf([night(), night({ id: "n2" })], two), two, NAMES),
    );
    expect(lines).toHaveLength(1);
    expect([lines[0]!.folded, lines[0]!.records.length]).toEqual([true, 2]);
  });

  it("adds the fold up to what its nights hold, so the line and the rows agree", () => {
    const two = [act({ lootIds: ["n1", "n2"], unpaid: 900 })];
    const rows = buildSettledLog(logOf([night(), night({ id: "n2" })], two), two, NAMES);
    const line = consolidateSettled(rows)[0]!;
    expect(line.pieces).toBe(line.records.reduce((sum, r) => sum + r.pieces, 0));
    expect(line.writtenOff).toBe(900);
  });

  it("keeps two acts apart, because they are two decisions", () => {
    // Folding them would put one date on both. Same night, two people, two acts.
    const jared: Holder = { kind: "PERSON", personId: "p-jared", characterName: null };
    const two = [act(), act({ id: "s2", holder: jared, settledAt: "2026-08-11T00:00:00Z" })];
    const lines = consolidateSettled(
      buildSettledLog(logOf([night()], two), two, new Map([...NAMES, ["person:p-jared", "Jared"]])),
    );
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => !l.folded)).toBe(true);
  });

  it("never folds a money drop, each having sold at its own price", () => {
    const rows = buildSettledLog(logOf([drop(), drop({ id: "l2" })]));
    const lines = consolidateSettled(rows);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => !l.folded)).toBe(true);
  });

  it("leaves a one-night act unfolded, a chevron onto one row opening onto itself", () => {
    const one = [act()];
    const lines = consolidateSettled(buildSettledLog(logOf([night()], one), one, NAMES));
    expect(lines[0]!.folded).toBe(false);
  });

  it("puts the fold where its first record sat, rather than at either end", () => {
    // The list is newest-finished first, so a fold that jumped to the top or the bottom would move
    // an act to a date it did not happen on.
    const two = [act({ lootIds: ["n1", "n2"] })];
    const rows = buildSettledLog(logOf([drop(), night(), night({ id: "n2" })], two), two, NAMES);
    const lines = consolidateSettled(rows);
    const firstNight = rows.findIndex((r) => r.kind === "PIECES");
    expect(lines[firstNight]!.records[0]).toBe(rows[firstNight]);
  });

  it("loses no record, so the fold can bring every one back", () => {
    const two = [act({ lootIds: ["n1", "n2"] })];
    const rows = buildSettledLog(logOf([drop(), night(), night({ id: "n2" })], two), two, NAMES);
    expect(consolidateSettled(rows).flatMap((l) => l.records)).toHaveLength(rows.length);
  });
});

// Settled is the last stage of a pipeline that runs one way, and nothing draws that as a rule: it is
// the absence of a control. Asserted against the source because there is no React render harness
// here, the same way the ledger's other JSX invariants are.
describe("Settled cannot be reopened", () => {
  const view = readFileSync(join(__dirname, "..", "components", "settled-view.tsx"), "utf8");
  const page = readFileSync(join(__dirname, "..", "app", "bosses", "drops", "page.tsx"), "utf8");

  it("offers no control on a settled row", () => {
    expect(view).not.toMatch(/Reopen/);
    expect(view).not.toMatch(/onUndo/);
  });

  /**
   * The one that matters. Closing a coupon pair writes one settlement PER PILE, so deleting a single
   * one leaves the night shut in their inventory and open in yours: Jonathan hit Reopen by accident
   * and 60 coupons came back onto the Sale Ledger with the other side still closed. There is no
   * half-undo because there is no undo.
   */
  it("sends no DELETE to the settlements endpoint", () => {
    const deletes = page.match(/SETTLEMENTS_KEY[^;]*method:\s*"DELETE"/g) ?? [];
    expect(deletes).toEqual([]);
  });
});
