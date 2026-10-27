import { describe, expect, it } from "vitest";
import { splitDrop } from "./drop-split";
import {
  divides,
  dropsInWeek,
  formatDropped,
  formatDroppedWithYear,
  memberFee,
  poolLabel,
  poolSize,
  saleBodyOf,
  splitOf,
  statusLabel,
  summarize,
  takenTally,
} from "./loot";
import type { Loot } from "@/types/loot";
import type { PartyMember } from "@/types/party";

const member = (id: string, name: string): PartyMember => ({
  id,
  name,
  personId: `person-${id}`,
  personName: null,
  characterId: null,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const party = [member("m1", "Rune"), member("m2", "Steve"), member("m3", "Bob")];

const sold = (over: Partial<Loot> = {}): Loot => ({
  id: "l1",
  dropKey: "grindstone-of-faith",
  customName: null,
  name: "Grindstone of Faith",
  iconUrl: "/drop-icons/grindstone-of-faith.png",
  perMember: null,
  bossKey: "limbo",
  quantity: 1,
  difficulty: null,
  droppedOn: "2026-07-20",
  weekStart: "2026-07-16",
  status: "SOLD",
  saleAmount: 9_500_000_000,
  amountBasis: "LISTED",
  splitMethod: "FAIR",
  sellerShares: 1,
  sellerMemberId: "m1",
  takenByMemberId: null,
  soldAt: "2026-07-21T10:00:00Z",
  payouts: [
    { memberId: "m2", paid: false, paidAt: null, shares: 1 },
    { memberId: "m3", paid: true, paidAt: "2026-07-21T11:00:00Z", shares: 1 },
  ],
  ranThatWeek: [],
  bundles: null,
  bundlesBy: [],
  ...over,
});

describe("splitOf", () => {
  it("hands the rates to splitDrop rather than computing anything itself", () => {
    // The check that matters: these figures are splitDrop's, not a second implementation's. Every
    // member pays the standard rate, because MVP tiers are not tracked.
    const loot = sold();
    const expected = splitDrop({
      amount: 9_500_000_000,
      amountIs: "listed",
      sellerFee: memberFee(),
      memberFees: [memberFee(), memberFee()],
      method: "fair",
    });

    const result = splitOf(loot, party)!;
    expect(result.shares.map((s) => s.pay)).toEqual(expected.members.map((m) => m.pay));
    expect(result.shares.map((s) => s.nets)).toEqual(expected.members.map((m) => m.nets));
    expect(result.seller).toEqual({
      memberId: "m1",
      name: "Rune",
      keeps: expected.sellerKeeps,
      paysOut: expected.sellerReceives - expected.sellerKeeps,
      shares: 1,
    });
  });

  it("carries who has already been paid onto the shares", () => {
    const result = splitOf(sold(), party)!;
    expect(result.shares.map((s) => [s.name, s.paid])).toEqual([
      ["Steve", false],
      ["Bob", true],
    ]);
  });

  it("reads a RECEIVED amount as what landed, not as a listing", () => {
    // On a received basis the seller's own fee has already been taken, so splitDrop must not take
    // it again. Pinning it here because the two bases differ by exactly one 5% hop.
    const listed = splitOf(sold({ amountBasis: "LISTED" }), party)!;
    const received = splitOf(sold({ amountBasis: "RECEIVED" }), party)!;
    expect(received.split.grossSale).toBeNull();
    expect(received.seller.keeps).toBeGreaterThan(listed.seller.keeps);
  });

  it("takes no Auction House cut off a drop a party member bought", () => {
    // Nothing was listed, so the price is the whole pot and the buyer holds it, exactly as a
    // received figure does. The payouts are still taxed, which is why the shares match too.
    const received = splitOf(sold({ amountBasis: "RECEIVED" }), party)!;
    const bought = splitOf(sold({ amountBasis: "BOUGHT" }), party)!;
    expect(bought.split.grossSale).toBeNull();
    expect(bought.seller.keeps).toBe(received.seller.keeps);
    expect(bought.shares.map((s) => s.pay)).toEqual(received.shares.map((s) => s.pay));
  });

  it("splits a buy into what the buyer keeps and what they hand over", () => {
    // The two figures the row shows, and the reason it shows both: they add up to the price the
    // buyer handed over, where a single payout does not, being grossed up for its receiver's fee.
    const result = splitOf(sold({ amountBasis: "BOUGHT" }), party)!;
    expect(result.seller.keeps + result.seller.paysOut).toBe(9_500_000_000);
    expect(result.seller.paysOut).toBe(result.shares.reduce((sum, s) => sum + s.pay, 0));
  });

  it("refuses a basis it cannot read rather than guessing at the fee", () => {
    // Defaulting an unknown basis to "received" would skip a 5% hop on a row a newer build wrote.
    expect(splitOf(sold({ amountBasis: "AUCTIONED" }), party)).toBeNull();
  });

  it("refuses a drop that is not sold", () => {
    expect(
      splitOf(sold({ saleAmount: null, sellerMemberId: null, status: "PENDING" }), party),
    ).toBeNull();
  });

  it("refuses rather than guessing when a payout names a seat the party does not have", () => {
    // A seat we cannot read means we cannot read its fee, and a share computed at the wrong rate
    // is the confident wrong number. Better to show nothing.
    const loot = sold({ payouts: [{ memberId: "gone", paid: false, paidAt: null, shares: 1 }] });
    expect(splitOf(loot, party)).toBeNull();
  });

  it("refuses when the seller is no longer a seat", () => {
    expect(splitOf(sold({ sellerMemberId: "gone" }), party)).toBeNull();
  });

  it("gives a solo seller nothing to send", () => {
    const loot = sold({ payouts: [] });
    const result = splitOf(loot, party)!;
    expect(result.shares).toEqual([]);
    expect(result.seller.keeps).toBe(result.split.sellerReceives);
  });

  it("reads a one-seat pool the same way whichever split method it stores", () => {
    // What lets the sell form on a solo pool drop the method select: with nobody to divide with,
    // both branches of splitDrop are the same arithmetic. Pinned here so hiding the control cannot
    // start hiding a choice that matters.
    const alone = [member("m1", "Rune")];
    const loot = sold({ payouts: [] });
    const fair = splitOf({ ...loot, splitMethod: "FAIR" }, alone)!;
    const lazy = splitOf({ ...loot, splitMethod: "LAZY" }, alone)!;

    expect(fair.split).toEqual(lazy.split);
    expect(fair.shares).toEqual([]);
    expect(fair.seller.keeps).toBe(fair.split.sellerReceives);
  });
});

describe("summarize", () => {
  it("counts what is unsold apart from what is sold and unsettled", () => {
    const loot = [
      sold({ id: "a", status: "PENDING" }),
      sold({ id: "b", status: "SOLD" }),
      sold({ id: "c", status: "SOLD" }),
      sold({ id: "d", status: "PAID_OUT" }),
    ];
    // The settled one is counted rather than ignored: a pool where everything is paid still has
    // drops in it, and reporting nothing made it look empty.
    expect(summarize(loot)).toEqual({ pending: 1, awaitingPayout: 2, settled: 1 });
  });

  it("counts a taken drop as done, the way a paid-out one is", () => {
    // A Heroic pool never sells, so nothing in it ever reaches PAID_OUT. Counting only that state
    // would report a party that had claimed a season of drops as having done nothing.
    const loot = [sold({ id: "a", status: "PENDING" }), sold({ id: "b", status: "TAKEN" })];
    expect(summarize(loot)).toEqual({ pending: 1, awaitingPayout: 0, settled: 1 });
  });
});

describe("statusLabel", () => {
  it("says what each state means for the person reading it", () => {
    expect(statusLabel("PENDING")).toBe("In the pool");
    expect(statusLabel("SOLD")).toBe("Awaiting payout");
    expect(statusLabel("PAID_OUT")).toBe("Settled");
    // Not "Settled". Nothing was paid, so there is no settlement to have happened.
    expect(statusLabel("TAKEN")).toBe("Taken");
  });
});

describe("takenTally", () => {
  const taken = (id: string, memberId: string | null, quantity = 1) =>
    sold({ id, status: memberId ? "TAKEN" : "PENDING", takenByMemberId: memberId, quantity });

  it("counts items per seat and lists every seat, zero included", () => {
    // The seat on zero is the seat this whole tally is for. Leaving it out until it has taken
    // something would hide the one person who is owed a turn.
    const tally = takenTally([taken("a", "m1"), taken("b", "m1"), taken("c", "m2")], party);
    expect(tally.map((t) => [t.name, t.taken])).toEqual([
      ["Rune", 2],
      ["Steve", 1],
      ["Bob", 0],
    ]);
  });

  it("counts items rather than rows", () => {
    // One row is one hammer or a stack of thirty coupons. Calling those the same turn is the
    // pooling-what-cannot-be-pooled mistake in a new place.
    const tally = takenTally([taken("a", "m1", 6), taken("b", "m2", 1)], party);
    expect(tally.find((t) => t.name === "Rune")?.taken).toBe(6);
    expect(tally.find((t) => t.name === "Steve")?.taken).toBe(1);
  });

  it("marks everybody on the fewest, so a tie stays a tie", () => {
    const tally = takenTally([taken("a", "m1")], party);
    expect(tally.filter((t) => t.up).map((t) => t.name)).toEqual(["Steve", "Bob"]);
  });

  it("leaves an unclaimed drop out of every count", () => {
    const tally = takenTally([taken("a", null), taken("b", "m1")], party);
    expect(tally.reduce((sum, t) => sum + t.taken, 0)).toBe(1);
  });

  it("does not credit a drop taken by somebody who has left", () => {
    // Attributing it to whoever is left would inflate a seat that never took it, which is a
    // confident wrong number about the one thing this tally exists to answer.
    const tally = takenTally([taken("a", "gone"), taken("b", "m1")], party);
    expect(tally.reduce((sum, t) => sum + t.taken, 0)).toBe(1);
    expect(tally.find((t) => t.name === "Rune")?.taken).toBe(1);
  });

  it("has everyone up in a pool nobody has claimed from", () => {
    expect(takenTally([], party).every((t) => t.up && t.taken === 0)).toBe(true);
  });
});

describe("formatDropped", () => {
  it("reads the date as written rather than through a timezone", () => {
    expect(formatDropped("2026-07-20")).toBe("20 Jul");
    expect(formatDropped("2026-01-01")).toBe("1 Jan");
  });

  it("gives back a month it cannot name rather than naming it undefined", () => {
    // Month 13 indexed past the end of the names and drew "40 undefined" on screen.
    expect(formatDropped("2026-13-40")).toBe("2026-13-40");
    expect(formatDropped("2026-00-01")).toBe("2026-00-01");
  });
});

describe("formatDroppedWithYear", () => {
  it("says the year, so two acts a year apart do not read the same", () => {
    expect(formatDroppedWithYear("2026-07-20")).toBe("20 Jul 2026");
    expect(formatDroppedWithYear("2025-07-20")).toBe("20 Jul 2025");
  });

  it("gives an unreadable date back whole rather than dressing it with a year", () => {
    expect(formatDroppedWithYear("not a date")).toBe("not a date");
    expect(formatDroppedWithYear("2026-13-40")).toBe("2026-13-40");
  });
});

describe("poolLabel", () => {
  const counts = (pendingLoot: number, awaitingPayout: number, settledLoot: number) => ({
    pendingLoot,
    awaitingPayout,
    settledLoot,
  });

  it("says nothing for a pool with nothing in it", () => {
    expect(poolLabel(counts(0, 0, 0))).toBeNull();
  });

  it("shows a fully settled pool rather than going silent", () => {
    // The bug this exists for: with only the outstanding counts, marking the last share paid
    // erased the pool from the row, and a party with a season of drops behind it read exactly
    // like one that had never dropped anything.
    expect(poolLabel(counts(0, 0, 3))).toEqual({ text: "3 settled", done: true });
  });

  it("gives the line to work that needs doing, not to what is finished", () => {
    // A settled count beside "1 awaiting payout" is noise next to a thing to go and do.
    expect(poolLabel(counts(0, 1, 9))).toEqual({ text: "1 awaiting payout", done: false });
    expect(poolLabel(counts(2, 0, 9))).toEqual({ text: "2 in the pool", done: false });
    expect(poolLabel(counts(2, 1, 9))).toEqual({
      text: "2 in the pool \u00b7 1 awaiting payout",
      done: false,
    });
  });

  it("marks the settled case as done so it can be drawn quietly", () => {
    expect(poolLabel(counts(0, 0, 1))?.done).toBe(true);
    expect(poolLabel(counts(1, 0, 1))?.done).toBe(false);
  });

  it("says the coupons in coupons, because a count of rows cannot", () => {
    // One row is one hammer or 180 coupons, and the row count leaves out the coupon drops that
    // came out even, so the two numbers are answering different questions.
    const owed = (toYou: number) => ({ toYou });
    expect(poolLabel(counts(0, 0, 0), owed(90))).toEqual({
      text: "90 coupons owed",
      done: false,
    });
    expect(poolLabel(counts(1, 0, 0), owed(90))).toEqual({
      text: "1 in the pool · 90 coupons owed",
      done: false,
    });
    // Nothing either way is silent, which is every party whose coupons went where they belong.
    expect(poolLabel(counts(0, 0, 3), owed(0))).toEqual({ text: "3 settled", done: true });
    // And being owed some is work, so a settled pool does not get the quiet line.
    expect(poolLabel(counts(0, 0, 3), owed(20))?.done).toBe(false);
  });

  it("says only what is owed to you, never what you are holding", () => {
    // The row carried "45 to hand over" for the ordinary night, the one you loot whole. What you
    // do about it is on the drop and in the Sale Ledger, and a list is not where it is read.
    expect(poolLabel(counts(0, 0, 0), { toYou: 0 })).toBeNull();
    // Which means a pool whose only outstanding thing is coupons of theirs in your inventory is
    // drawn as settled here. Deliberate: this line answers what to chase, not what to do.
    expect(poolLabel(counts(0, 0, 2), { toYou: 0 })).toEqual({ text: "2 settled", done: true });
  });
});

describe("poolSize", () => {
  it("counts every drop whatever state it is in", () => {
    // The way into a pool, so it must not vanish just because the work is done.
    expect(poolSize({ pendingLoot: 1, awaitingPayout: 2, settledLoot: 3 })).toBe(6);
    expect(poolSize({ pendingLoot: 0, awaitingPayout: 0, settledLoot: 4 })).toBe(4);
    expect(poolSize({ pendingLoot: 0, awaitingPayout: 0, settledLoot: 0 })).toBe(0);
  });
});

describe("splitOf reads the shares the sale was split on", () => {
  it("hands a pinned share count to splitDrop rather than assuming an even split", () => {
    const loot = sold({
      sellerShares: 2,
      payouts: [
        { memberId: "m2", paid: false, paidAt: null, shares: 3 },
        { memberId: "m3", paid: false, paidAt: null, shares: 1 },
      ],
    });
    const expected = splitDrop({
      amount: 9_500_000_000,
      amountIs: "listed",
      sellerFee: memberFee(),
      memberFees: [memberFee(), memberFee()],
      method: "fair",
      sellerShares: 2,
      memberShares: [3, 1],
    });

    const result = splitOf(loot, party)!;
    expect(result.shares.map((s) => s.pay)).toEqual(expected.members.map((m) => m.pay));
    expect(result.shares.map((s) => s.shares)).toEqual([3, 1]);
    expect(result.seller.shares).toBe(2);
    expect(result.seller.keeps).toBe(expected.sellerKeeps);
  });

  it("reads a row from before shares existed as an even split", () => {
    // sellerShares null is a sale recorded by an older build. One share each is what it was.
    const result = splitOf(sold({ sellerShares: null }), party)!;
    expect(result.seller.shares).toBe(1);
    expect(result.shares.every((s) => s.shares === 1)).toBe(true);
  });

  it("refuses a share count it cannot read rather than defaulting it to one", () => {
    for (const shares of [0, -1, 1.5, Number.NaN]) {
      const loot = sold({ payouts: [{ memberId: "m2", paid: false, paidAt: null, shares }] });
      expect(splitOf(loot, party)).toBeNull();
      expect(splitOf(sold({ sellerShares: shares }), party)).toBeNull();
    }
  });
});

describe("dropsInWeek", () => {
  const week = (id: string, weekStart: string) => sold({ id, weekStart });

  it("keeps the week on screen and leaves the rest to the party's own page", () => {
    // The row is about this week. The whole pool under it was a season of drops headed by tonight.
    const shown = dropsInWeek(
      [week("l1", "2026-08-06"), week("l2", "2026-07-16"), week("l3", "2026-08-06")],
      "2026-08-06",
    );

    expect(shown.map((l) => l.id)).toEqual(["l1", "l3"]);
  });

  it("shows the pool whole when nothing has named the week yet", () => {
    // Narrowing against a week we cannot name would be a guess about which drops belong to it.
    const loot = [week("l1", "2026-08-06"), week("l2", "2026-07-16")];

    expect(dropsInWeek(loot, null)).toEqual(loot);
  });

  it("keeps a row dated after the week rather than filing it under one that has gone", () => {
    // Nothing writes one, since a drop is stamped with the server's today. If something ever does,
    // the honest failure is showing it.
    expect(dropsInWeek([week("l1", "2026-08-13")], "2026-08-06").map((l) => l.id)).toEqual(["l1"]);
  });

  it("is empty where the week on screen holds nothing", () => {
    expect(dropsInWeek([week("l1", "2026-07-16"), week("l2", "2026-07-09")], "2026-08-06")).toEqual(
      [],
    );
  });
});

describe("divides", () => {
  it("is false where one seat ran, which is a drop nothing is owed off", () => {
    // The Drop Log records a run with nobody else, so its drop reads one seat even when the pool
    // it sits in is a party's. See ranWith on the server.
    expect(divides([member("m1", "Rune")])).toBe(false);
  });

  it("is false where nobody ran, rather than offering a split with no seats in it", () => {
    expect(divides([])).toBe(false);
  });

  it("is true where the party ran it", () => {
    expect(divides(party)).toBe(true);
  });
});

describe("saleBodyOf", () => {
  it("opens a correction on the sale as entered", () => {
    const loot = sold({
      sellerShares: 2,
      ranThatWeek: ["m1", "m2", "m3", "m4"],
      payouts: [
        { memberId: "m2", paid: false, paidAt: null, shares: 3 },
        { memberId: "m3", paid: true, paidAt: null, shares: 1 },
      ],
    });
    expect(saleBodyOf(loot)).toEqual({
      amount: 9_500_000_000,
      usdCents: undefined,
      amountBasis: "LISTED",
      splitMethod: "FAIR",
      sellerMemberId: "m1",
      // m4 ran and has no payout row, so it was on no share. One would hand it a share on save.
      shares: { m1: 2, m2: 3, m3: 1, m4: 0 },
    });
  });

  it("carries a dollar sale as cents and no mesos", () => {
    const body = saleBodyOf(
      sold({ saleAmount: null, saleUsdCents: 100_000, amountBasis: "RECEIVED" }),
    );
    expect(body?.usdCents).toBe(100_000);
    expect(body?.amount).toBe(0);
  });

  it("has nothing to correct on an unsold drop", () => {
    expect(
      saleBodyOf(sold({ soldAt: null, saleAmount: null, sellerMemberId: null, amountBasis: null })),
    ).toBeNull();
  });
});
