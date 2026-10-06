import { describe, expect, it } from "vitest";
import {
  placeSales,
  type LedgerSeat,
  balances,
  entitlements,
  spendOldestFirst,
  spendSales,
  transferKey,
  transfersOf,
} from "./piece-ledger";

const seat = (name: string, looted: number, shares = 1): LedgerSeat => ({
  memberId: `m-${name}`,
  name,
  looted,
  shares,
});

/** The night this exists for: Extreme Kalos, six bundles of 30, four people. */
const kalos = (looted: [number, number, number, number]) => [
  seat("Rune", looted[0]),
  seat("Steve", looted[1]),
  seat("Bob", looted[2]),
  seat("Ana", looted[3]),
];

describe("what each seat was entitled to", () => {
  it("divides evenly when it divides", () => {
    const share = entitlements(180, kalos([120, 60, 0, 0]));
    expect([...share.values()]).toEqual([45, 45, 45, 45]);
  });

  it("hands the odd pieces out rather than losing them", () => {
    // 181 across four is 45.25 each. Somebody gets the 46th piece, and the four still add to 181.
    const share = entitlements(181, kalos([181, 0, 0, 0]));
    expect([...share.values()].reduce((a, b) => a + b, 0)).toBe(181);
    expect([...share.values()].sort((a, b) => b - a)).toEqual([46, 45, 45, 45]);
  });

  it.each([
    [7, 3],
    [100, 3],
    [181, 4],
    [1, 4],
    [359, 6],
    [0, 4],
  ])("always adds up to what dropped: %i across %i", (total, size) => {
    const seats = Array.from({ length: size }, (_, i) => seat(`s${i}`, 0));
    const share = entitlements(total, seats);
    expect([...share.values()].reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("gives a bigger weight a bigger entitlement", () => {
    const share = entitlements(180, [seat("Rune", 0, 2), seat("Steve", 0), seat("Bob", 0)]);
    expect(share.get("m-Rune")).toBe(90);
    expect(share.get("m-Steve")).toBe(45);
  });

  it("is the same answer twice, so a paid transfer does not move", () => {
    const seats = kalos([100, 81, 0, 0]);
    expect([...entitlements(181, seats)]).toEqual([...entitlements(181, seats)]);
  });
});

describe("who is over and who is short", () => {
  it("nets to zero, so the transfers can clear it exactly", () => {
    const position = balances(180, kalos([120, 60, 0, 0]));
    expect(position.map((p) => p.balance)).toEqual([-75, -15, 45, 45]);
    expect(position.reduce((sum, p) => sum + p.balance, 0)).toBe(0);
  });

  it("says nothing is owed when everybody took their share", () => {
    const position = balances(180, kalos([45, 45, 45, 45]));
    expect(position.every((p) => p.balance === 0)).toBe(true);
  });
});

describe("who owes whom, in pieces and never in mesos", () => {
  const night = (looted: [number, number, number, number], total = 180) => ({
    id: "kalos",
    weekStart: "2026-08-06",
    order: 1,
    total,
    seats: kalos(looted),
  });

  it("pairs whoever is over with whoever is short, and clears the whole imbalance", () => {
    // Rune took 120 of a 180 that divides 45 each, so 75 of them are other people's.
    const out = transfersOf(night([120, 60, 0, 0]));
    expect(out.map((t) => [t.from, t.to, t.pieces])).toEqual([
      ["Rune", "Bob", 45],
      ["Rune", "Ana", 30],
      ["Steve", "Ana", 15],
    ]);
    // Every piece that was somebody else's is in exactly one transfer.
    expect(out.reduce((sum, t) => sum + t.pieces, 0)).toBe(90);
  });

  it("says nothing at all when the night divided", () => {
    // Nothing to say beats a list of zeroes.
    expect(transfersOf(night([45, 45, 45, 45]))).toEqual([]);
  });

  it("carries no price, because only the holder can sell a coupon", () => {
    // The whole reason the apportioning went. What these pieces are worth is not visible from here:
    // the holder sells them at whatever they get, and a figure derived from anything else is a guess.
    const [first] = transfersOf(night([120, 60, 0, 0]));
    expect(Object.keys(first!).sort()).toEqual(["from", "fromId", "pieces", "to", "toId"]);
  });

  it("answers with one debtor's rows when asked for them, and the pairing does not move", () => {
    // Which pile is being drawn must not change who pays whom, or a drop split across two piles
    // would name a different creditor depending on which card you were looking at.
    const all = transfersOf(night([120, 60, 0, 0]));
    const rune = transfersOf(night([120, 60, 0, 0]), "m-Rune");
    expect(rune).toEqual(all.filter((t) => t.fromId === "m-Rune"));
  });

  it("is the same list twice, so a debt does not move between reads", () => {
    expect(transfersOf(night([181, 0, 0, 0]), undefined)).toEqual(
      transfersOf(night([181, 0, 0, 0])),
    );
  });

  it("keys a pair one way, however the row is redrawn", () => {
    expect(transferKey({ fromId: "a", toId: "b" })).toBe(transferKey({ fromId: "a", toId: "b" }));
    expect(transferKey({ fromId: "a", toId: "b" })).not.toBe(
      transferKey({ fromId: "b", toId: "a" }),
    );
  });
});

// A pair's debt is one running count and the nights behind it are a queue, so an answered figure
// answered the oldest of them. The alternative was a list that summed to 180 under a headline of 50.
describe("spending an answered count over the nights behind it", () => {
  const night = (id: string, droppedOn: string, pieces: number) => ({ id, droppedOn, pieces });

  it("clears the oldest nights first", () => {
    const out = spendOldestFirst(
      [night("a", "2026-08-13", 10), night("b", "2026-08-13", 30), night("c", "2026-08-14", 30)],
      40,
    );
    expect(out.map((n) => [n.id, n.pieces])).toEqual([
      ["a", 0],
      ["b", 0],
      ["c", 30],
    ]);
  });

  it("leaves the remainder on the night the credit runs out on", () => {
    expect(spendOldestFirst([night("a", "2026-08-13", 60)], 20)[0]!.pieces).toBe(40);
  });

  it("goes by the day the night FELL, not the order the rows are drawn in", () => {
    // The queue is drawn in the catalog's order so two bosses in one week never swap places, which
    // is not the order the nights happened in. A sale cannot come off a night that had not happened.
    const out = spendOldestFirst(
      [night("newest", "2026-08-14", 30), night("oldest", "2026-08-13", 30)],
      30,
    );
    expect(out.map((n) => [n.id, n.pieces])).toEqual([
      ["newest", 30],
      ["oldest", 0],
    ]);
  });

  it("returns a covered night at zero rather than dropping it", () => {
    // A night answered in money is finished, and closing its books is right. Dropping it would take
    // it out of settleThePair and leave it open for ever.
    expect(spendOldestFirst([night("a", "2026-08-13", 10)], 50)).toHaveLength(1);
  });

  it("adds up to what was owed less what was answered", () => {
    const nights = [
      night("a", "2026-08-13", 10),
      night("b", "2026-08-13", 30),
      night("c", "2026-08-14", 30),
    ];
    const left = spendOldestFirst(nights, 25).reduce((sum, n) => sum + n.pieces, 0);
    expect(left).toBe(70 - 25);
  });

  it("spends nothing it has not got, and never reads negative", () => {
    expect(spendOldestFirst([night("a", "2026-08-13", 10)], 0).map((n) => n.pieces)).toEqual([10]);
    expect(spendOldestFirst([night("a", "2026-08-13", 10)], -5).map((n) => n.pieces)).toEqual([10]);
  });

  it("orders one evening's nights by when they were LOGGED, not by their id", () => {
    // Three bosses on one night share a droppedOn, so the date cannot order them. The tie used to
    // fall to the loot id, a random uuid, and which of them kept a debt was decided by nothing:
    // Hard Baldrix went silent while Hard Kaling still asked for 30, purely because 28760ee5 sorts
    // before acd816fc. `recordedAt` is the order they actually happened in.
    //
    // The ids here run OPPOSITE to the logging order on purpose, so a spend that still reads them
    // would give the reverse answer and fail this.
    const evening = [
      { lootId: "zzz", droppedOn: "2026-08-23", recordedAt: "2026-08-23T01:56:00Z", pieces: 30 },
      { lootId: "mmm", droppedOn: "2026-08-23", recordedAt: "2026-08-23T04:17:00Z", pieces: 60 },
      { lootId: "aaa", droppedOn: "2026-08-23", recordedAt: "2026-08-23T04:46:00Z", pieces: 60 },
    ];

    // 85 spent: the 01:56 night whole, then 55 off the 04:17 one, and the last untouched.
    expect(spendOldestFirst(evening, 85).map((n) => [n.lootId, n.pieces])).toEqual([
      ["zzz", 0],
      ["mmm", 5],
      ["aaa", 60],
    ]);
  });

  it("puts a night with no recordedAt first, which is what a cached row meant", () => {
    // A row from before the field is eligible for everything, so it is also the oldest.
    const out = spendOldestFirst(
      [
        { lootId: "b", droppedOn: "2026-08-23", recordedAt: "2026-08-23T04:00:00Z", pieces: 10 },
        { lootId: "a", droppedOn: "2026-08-23", pieces: 10 },
      ],
      10,
    );
    expect(out.map((n) => [n.lootId, n.pieces])).toEqual([
      ["b", 10],
      ["a", 0],
    ]);
  });
});

// The eligibility rule the doc above has always claimed and never enforced. Without it every sale
// ever recorded is one undated pool, and it drains down the queue into nights that fell after it.
describe("a sale only reaching the nights that were on the books", () => {
  const night = (id: string, droppedOn: string, pieces: number, recordedAt?: string) => ({
    id,
    droppedOn,
    pieces,
    recordedAt,
  });

  it("does not answer a night logged after it", () => {
    // Hard Baldrix, and the reason the row read "Yours". You sell 60 of Bro's at 04:20 and log a
    // fresh night at 04:46: the sale cannot have been about coupons you had not picked up yet.
    const out = spendSales(
      [night("baldrix", "2026-08-23", 60, "2026-08-23T04:46:41Z")],
      [{ pieces: 60, recordedAt: "2026-08-23T04:20:12Z" }],
    );
    expect(out[0]!.pieces).toBe(60);
  });

  it("answers a night logged before it", () => {
    const out = spendSales(
      [night("malefic", "2026-08-23", 60, "2026-08-23T04:17:00Z")],
      [{ pieces: 60, recordedAt: "2026-08-23T04:20:12Z" }],
    );
    expect(out[0]!.pieces).toBe(0);
  });

  it("goes by the day it was LOGGED, not the day it fell", () => {
    // droppedOn is a date somebody typed. Logging a drop, selling, and logging another is one date
    // and three acts, and a bare day cannot put them in order.
    const out = spendSales(
      [
        night("before", "2026-08-23", 30, "2026-08-23T04:17:00Z"),
        night("after", "2026-08-23", 30, "2026-08-23T04:46:41Z"),
      ],
      [{ pieces: 60, recordedAt: "2026-08-23T04:20:12Z" }],
    );
    expect(out.map((n) => [n.id, n.pieces])).toEqual([
      ["before", 0],
      ["after", 30],
    ]);
  });

  it("leaves a sale that outruns its nights stranded rather than spilling it forward", () => {
    // The whole bug in one line. 500 sold against 30 of eligible debt used to roll on down the
    // queue and silence every later night; now the surplus simply has nowhere to go.
    const out = spendSales(
      [
        night("old", "2026-08-13", 30, "2026-08-13T00:00:00Z"),
        night("new", "2026-08-23", 60, "2026-08-23T04:46:41Z"),
      ],
      [{ pieces: 500, recordedAt: "2026-08-14T00:00:00Z" }],
    );
    expect(out.map((n) => [n.id, n.pieces])).toEqual([
      ["old", 0],
      ["new", 60],
    ]);
  });

  it("keeps a row cached from before the field eligible for everything", () => {
    // lib/cache.ts hands back whatever shape the API had when the page last fetched. Absent has to
    // mean what it meant when it was cached, and the next fetch corrects it.
    const out = spendSales(
      [night("cached", "2026-08-23", 60)],
      [{ pieces: 60, recordedAt: "2026-08-13T00:00:00Z" }],
    );
    expect(out[0]!.pieces).toBe(0);
  });

  it("spends the oldest sale first, so the leftovers land where they would have", () => {
    const nights = [
      night("old", "2026-08-13", 30, "2026-08-13T00:00:00Z"),
      night("new", "2026-08-20", 30, "2026-08-20T00:00:00Z"),
    ];
    const out = spendSales(nights, [
      { pieces: 30, recordedAt: "2026-08-25T00:00:00Z" },
      { pieces: 30, recordedAt: "2026-08-14T00:00:00Z" },
    ]);
    expect(out.map((n) => n.pieces)).toEqual([0, 0]);
  });

  it("returns every night, a covered one at zero, the way spendOldestFirst does", () => {
    const out = spendSales(
      [night("a", "2026-08-13", 10, "2026-08-13T00:00:00Z")],
      [{ pieces: 50, recordedAt: "2026-08-14T00:00:00Z" }],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.pieces).toBe(0);
  });

  it("spends nothing when there are no sales", () => {
    expect(spendSales([night("a", "2026-08-13", 10, "2026-08-13T00:00:00Z")], [])[0]!.pieces).toBe(
      10,
    );
  });
});

describe("placeSales", () => {
  const night = (lootId: string, weekStart: string, droppedOn: string, pieces: number) => ({
    lootId,
    weekStart,
    droppedOn,
    pieces,
    recordedAt: `${droppedOn}T01:00:00Z`,
  });
  const nights = [
    night("a", "2026-08-06", "2026-08-07", 60),
    night("b", "2026-08-13", "2026-08-14", 60),
    night("c", "2026-08-20", "2026-08-21", 60),
  ];
  const sales = [
    { pieces: 90, recordedAt: "2026-08-30T00:00:00Z" },
    { pieces: 50, recordedAt: "2026-08-31T00:00:00Z" },
  ];

  it("places each sale by the weeks of the nights it came off, newest first", () => {
    const placed = placeSales(nights, sales);
    expect([...placed.get(sales[0]!)!]).toEqual([
      ["2026-08-20", 60],
      ["2026-08-13", 30],
    ]);
    expect([...placed.get(sales[1]!)!]).toEqual([
      ["2026-08-13", 30],
      ["2026-08-06", 20],
    ]);
  });

  it("leaves what each night still owes exactly as spendSales does", () => {
    const placed = placeSales(nights, sales);
    const spent = spendSales(nights, sales);
    const taken = (lootId: string) =>
      [...placed.values()].reduce((sum, weeks) => {
        const week = nights.find((n) => n.lootId === lootId)!.weekStart;
        return sum + (weeks?.get(week) ?? 0);
      }, 0);
    for (const n of nights) {
      expect(n.pieces - spent.find((s) => s.lootId === n.lootId)!.pieces).toBe(taken(n.lootId));
    }
  });

  it("refuses a sale the nights cannot cover, rather than placing part of it", () => {
    const big = { pieces: 500, recordedAt: "2026-09-01T00:00:00Z" };
    expect(placeSales(nights, [big]).get(big)).toBeNull();
  });
});
