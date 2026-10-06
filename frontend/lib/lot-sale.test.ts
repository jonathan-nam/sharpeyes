import { describe, expect, it } from "vitest";
import {
  evenShares,
  fungibleDropKeys,
  lotDrops,
  lotQueue,
  lotRosters,
  lotSaleBody,
  priceLot,
  proposeLot,
  rowSales,
} from "./lot-sale";
import { largestRemainder } from "./piece-ledger";
import { SELF_KEY } from "./vestige-ledger";
import type { BossDrop, DropTables } from "@/types/drop";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

const M = 1_000_000;
const B = 1_000_000_000;
const STONE = "grindstone-of-faith";
const BOX = "eternal-armor-of-desire-box";
const RING = "ring-of-restraint-4";
const COUPON = "vestige-of-erion";

const seat = (id: string, name: string, { mine = false, shares = 1 } = {}): PartyMember => ({
  id,
  name,
  personId: null,
  personName: null,
  characterId: mine ? `char-${id}` : null,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares,
});

const party = (
  id: string,
  bossKey: string,
  members: PartyMember[],
  over: Partial<Party> = {},
): Party => ({
  id,
  slug: id,
  characterId: members[0]!.characterId ?? `char-${members[0]!.id}`,
  solo: false,
  oneOff: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey,
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
  ...over,
});

const drop = (
  id: string,
  dropKey: string,
  droppedOn: string,
  ran: string[],
  over: Partial<Loot> = {},
): Loot => ({
  id,
  dropKey,
  customName: null,
  name: dropKey === STONE ? "Grindstone of Faith" : "Eternal Armor of Desire Box",
  iconUrl: null,
  perMember: null,
  bossKey: "limbo",
  quantity: 1,
  difficulty: null,
  droppedOn,
  weekStart: droppedOn,
  status: "PENDING",
  saleAmount: null,
  amountBasis: null,
  splitMethod: null,
  sellerShares: null,
  sellerMemberId: null,
  takenByMemberId: null,
  soldAt: null,
  payouts: [],
  ranThatWeek: ran,
  bundles: null,
  bundlesBy: [],
  ...over,
});

const pool = (partyId: string, loot: Loot[]): PartyLootPool => ({ partyId, loot });

const catalogDrop = (
  dropKey: string,
  fungible: boolean,
  over: Partial<BossDrop> = {},
): BossDrop => ({
  dropKey,
  name: dropKey,
  iconUrl: null,
  perMember: null,
  worlds: null,
  quantity: 1,
  fungible,
  pieces: {},
  bundles: {},
  ...over,
});

/** Your character and one stranger, in two parties on two bosses. */
const duo = () => [seat("m1", "Husky", { mine: true }), seat("m2", "Rune")];

describe("which drops are sold as a lot", () => {
  it("reads the catalog rather than a list of its own", () => {
    const tables: DropTables = {
      limbo: [catalogDrop(STONE, true), catalogDrop("whisper-of-the-source", false)],
      baldrix: [catalogDrop(STONE, true), catalogDrop("oath-of-death", false)],
    };
    expect(fungibleDropKeys(tables)).toEqual(new Set([STONE]));
  });

  it("is one answer per item however many bosses list it", () => {
    // The flag sits on the item, so a drop in two tables must not depend on which was read.
    const tables: DropTables = {
      limbo: [catalogDrop(BOX, true)],
      kaling: [catalogDrop(BOX, true)],
    };
    expect([...fungibleDropKeys(tables)]).toEqual([BOX]);
  });
});

describe("the queue a lot is drawn from", () => {
  const parties = [party("p1", "limbo", duo()), party("p2", "kaling", duo())];
  const pools = [
    pool("p1", [drop("l2", STONE, "2026-08-06", ["m1", "m2"])]),
    pool("p2", [drop("l1", STONE, "2026-07-30", ["m1", "m2"])]),
  ];

  it("is oldest first, across parties", () => {
    expect(lotQueue(parties, pools, STONE, SELF_KEY).map((r) => r.lootId)).toEqual(["l1", "l2"]);
  });

  it("names your own seat as the seller, and opens every seat on one share", () => {
    const [first] = lotQueue(parties, pools, STONE, SELF_KEY);
    expect(first?.sellerMemberId).toBe("m1");
    expect(evenShares(first?.ran ?? [])).toEqual({ m1: 1, m2: 1 });
  });

  it("splits evenly whatever stack ratio the party is on", () => {
    // Rune's 2 is an entitlement to the vestige stacks, which is the only thing that column says.
    // Reading it here sold a pile of grindstones 1:2 off a set of boxes that opened even.
    const carried = [seat("m1", "Husky", { mine: true }), seat("m2", "Rune", { shares: 2 })];
    const queue = lotQueue(
      [party("p1", "limbo", carried)],
      [pool("p1", [drop("l1", STONE, "2026-07-30", ["m1", "m2"])])],
      STONE,
      SELF_KEY,
    );
    expect(lotSaleBody(STONE, 1, "RECEIVED", "FAIR", queue).rows[0]?.shares).toEqual({
      m1: 1,
      m2: 1,
    });
  });

  it("splits evenly whatever the week itself was pinned on", () => {
    const carried = [seat("m1", "Husky", { mine: true }), seat("m2", "Rune", { shares: 1 })];
    const queue = lotQueue(
      [party("p1", "limbo", carried)],
      [pool("p1", [drop("l1", STONE, "2026-07-30", ["m1", "m2"], { sharesThatWeek: { m2: 2 } })])],
      STONE,
      SELF_KEY,
    );
    expect(lotSaleBody(STONE, 1, "RECEIVED", "FAIR", queue).rows[0]?.shares).toEqual({
      m1: 1,
      m2: 1,
    });
  });

  it("leaves out a row that has already sold", () => {
    const sold = [
      pool("p1", [drop("l1", STONE, "2026-07-30", ["m1"], { soldAt: "2026-08-01T00:00:00Z" })]),
    ];
    expect(lotQueue(parties, sold, STONE, SELF_KEY)).toEqual([]);
  });

  it("leaves out another drop entirely", () => {
    expect(lotQueue(parties, pools, BOX, SELF_KEY)).toEqual([]);
  });

  it("leaves out a week you did not run, since the sale could not name you as seller", () => {
    const guestWeek = [pool("p1", [drop("l1", STONE, "2026-07-30", ["m2"])])];
    expect(lotQueue(parties, guestWeek, STONE, SELF_KEY)).toEqual([]);
  });

  it("leaves out a Heroic pool, where nothing is sold at all", () => {
    const heroic = [party("p1", "limbo", duo(), { worldType: "HEROIC" })];
    expect(
      lotQueue(heroic, [pool("p1", [drop("l1", STONE, "2026-07-30", ["m1"])])], STONE, SELF_KEY),
    ).toEqual([]);
  });
});

describe("the drops that price alone", () => {
  const tables: DropTables = {
    limbo: [
      catalogDrop(STONE, true),
      catalogDrop(RING, false),
      catalogDrop(COUPON, false, { pieces: { INTERACTIVE: { HARD: 60 } } }),
    ],
  };
  const fungible = fungibleDropKeys(tables);
  const parties = [party("p1", "limbo", duo())];
  const rows = (loot: Loot[], over: Party[] = parties) =>
    rowSales(over, [pool("p1", loot)], tables, fungible, SELF_KEY).map((r) => r.lootId);

  it("holds a ring, which has its own price and no queue that could name a copy", () => {
    expect(rows([drop("l1", RING, "2026-07-30", ["m1", "m2"])])).toEqual(["l1"]);
  });

  it("leaves out an interchangeable drop, which is a lot instead", () => {
    // The two lists must not overlap: a grindstone offered here as well would be two ways to price
    // one row, and whichever was used second would overwrite the first.
    expect(rows([drop("l1", STONE, "2026-07-30", ["m1", "m2"])])).toEqual([]);
  });

  it("leaves out a coupon stack, which divides by count and is settled in tranches", () => {
    expect(rows([drop("l1", COUPON, "2026-07-30", ["m1", "m2"], { quantity: 60 })])).toEqual([]);
  });

  it("holds a drop typed by hand, which no catalog row calls interchangeable", () => {
    const freeText = drop("l1", RING, "2026-07-30", ["m1", "m2"], {
      dropKey: null,
      customName: "Something new",
      name: "Something new",
      bossKey: null,
    });
    expect(rows([freeText])).toEqual(["l1"]);
  });

  it("is oldest first, and carries the seller and the even split a lot row does", () => {
    const found = rowSales(
      parties,
      [
        pool("p1", [
          drop("l2", RING, "2026-08-06", ["m1", "m2"]),
          drop("l1", RING, "2026-07-30", ["m1", "m2"]),
        ]),
      ],
      tables,
      fungible,
      SELF_KEY,
    );
    expect(found.map((r) => r.lootId)).toEqual(["l1", "l2"]);
    expect(found[0]?.sellerMemberId).toBe("m1");
    expect(evenShares(found[0]?.ran ?? [])).toEqual({ m1: 1, m2: 1 });
  });

  it("shares the lot queue's own rules about what is sellable", () => {
    const sold = drop("l1", RING, "2026-07-30", ["m1"], { soldAt: "2026-08-01T00:00:00Z" });
    expect(rows([sold])).toEqual([]);
    expect(rows([drop("l1", RING, "2026-07-30", ["m2"])])).toEqual([]);
    expect(
      rows(
        [drop("l1", RING, "2026-07-30", ["m1"])],
        [party("p1", "limbo", duo(), { worldType: "HEROIC" })],
      ),
    ).toEqual([]);
  });
});

describe("proposing the rows a lot covers", () => {
  const queue = lotQueue(
    [party("p1", "limbo", duo())],
    [
      pool("p1", [
        drop("l1", STONE, "2026-07-16", ["m1"]),
        drop("l2", STONE, "2026-07-23", ["m1"]),
        drop("l3", STONE, "2026-07-30", ["m1"]),
      ]),
    ],
    STONE,
    SELF_KEY,
  );

  it("takes the oldest rows, and only as many as were sold", () => {
    const proposal = proposeLot(queue, 2);
    expect(proposal.rows.map((r) => r.lootId)).toEqual(["l1", "l2"]);
    expect(proposal.units).toBe(2);
  });

  it("proposes nothing for more than the queue holds, and says what it holds", () => {
    const proposal = proposeLot(queue, 5);
    expect(proposal.rows).toEqual([]);
    expect(proposal.reachable).toEqual([1, 2, 3]);
  });

  it("refuses a count that lands mid-row rather than rounding to the nearest", () => {
    // Two rows of two: 1 and 3 are not sellable amounts, and picking the closest would file a sale
    // for a quantity nobody entered.
    const stacked = lotQueue(
      [party("p1", "limbo", duo())],
      [
        pool("p1", [
          drop("l1", STONE, "2026-07-16", ["m1"], { quantity: 2 }),
          drop("l2", STONE, "2026-07-23", ["m1"], { quantity: 2 }),
        ]),
      ],
      STONE,
      SELF_KEY,
    );
    expect(proposeLot(stacked, 3).rows).toEqual([]);
    expect(proposeLot(stacked, 3).reachable).toEqual([2, 4]);
    expect(proposeLot(stacked, 4).rows.map((r) => r.lootId)).toEqual(["l1", "l2"]);
  });

  it("proposes nothing for nothing", () => {
    expect(proposeLot(queue, 0).rows).toEqual([]);
  });
});

describe("what each row of a lot sold for", () => {
  const rowsOf = (units: number[]) =>
    units.map((u, i) => ({
      lootId: `l${i}`,
      partyId: "p1",
      units: u,
      name: "Grindstone of Faith",
      iconUrl: null,
      bossKey: "limbo",
      droppedOn: "2026-07-16",
      weekStart: "2026-07-16",
      characterId: "char-m1",
      sellerMemberId: "m1",
      sellerName: "Husky",
      ran: [seat("m1", "Husky", { mine: true })],
    }));

  it("divides the total evenly when it divides", () => {
    expect(priceLot(2 * B, rowsOf([1, 1, 1, 1]))).toEqual([500 * M, 500 * M, 500 * M, 500 * M]);
  });

  it("adds up to exactly the total when it does not divide", () => {
    const amounts = priceLot(1 * B, rowsOf([1, 1, 1]));
    expect(amounts.reduce((sum, n) => sum + n, 0)).toBe(1 * B);
    // The odd meso goes to one row, not to none of them: a per-unit price rounded and multiplied
    // out would leave the party a meso short with every figure looking ordinary.
    expect(amounts).toEqual([333_333_334, 333_333_333, 333_333_333]);
  });

  it("prices a row of three at three times a row of one", () => {
    expect(priceLot(4 * B, rowsOf([3, 1]))).toEqual([3 * B, 1 * B]);
  });

  it("is the same arithmetic the piece ledger divides pieces with", () => {
    expect(priceLot(7, rowsOf([1, 1, 1]))).toEqual(largestRemainder(7, [1, 1, 1]));
  });
});

describe("the request a confirmed lot sends", () => {
  const queue = lotQueue(
    [party("p1", "limbo", duo()), party("p2", "kaling", duo())],
    [
      pool("p1", [drop("l1", STONE, "2026-07-16", ["m1", "m2"])]),
      pool("p2", [drop("l2", STONE, "2026-07-23", ["m1", "m2"])]),
    ],
    STONE,
    SELF_KEY,
  );

  it("names every row with its own party, seller and slice", () => {
    const body = lotSaleBody(STONE, 2 * B, "RECEIVED", "FAIR", proposeLot(queue, 2).rows);
    expect(body.rows).toEqual([
      {
        partyId: "p1",
        lootId: "l1",
        amount: 1 * B,
        sellerMemberId: "m1",
        shares: { m1: 1, m2: 1 },
      },
      {
        partyId: "p2",
        lootId: "l2",
        amount: 1 * B,
        sellerMemberId: "m1",
        shares: { m1: 1, m2: 1 },
      },
    ]);
  });

  it("carries the total, which is what the server checks the slices against", () => {
    const body = lotSaleBody(STONE, 1 * B, "LISTED", "LAZY", proposeLot(queue, 2).rows);
    expect(body.total).toBe(1 * B);
    expect(body.rows.reduce((sum, r) => sum + r.amount, 0)).toBe(body.total);
  });
});

// A lot used to pin an even split with no boxes to say so, so every pile of grindstones reached the
// Settlement Ledger as one, whatever the party had agreed. The boxes are per ROSTER: one person
// holds a different seat id in each pool a lot spans, and a four-week pile the same two ran is one
// ratio to type rather than four.
describe("the seats a lot's share boxes stand for", () => {
  const rosterQueue = lotQueue(
    [party("p1", "limbo", duo()), party("p2", "kaling", [...duo(), seat("m3", "Kelp")])],
    [
      pool("p1", [
        drop("l1", STONE, "2026-07-16", ["m1", "m2"]),
        drop("l3", STONE, "2026-07-30", ["m1", "m2"]),
      ]),
      pool("p2", [drop("l2", STONE, "2026-07-23", ["m1", "m2", "m3"])]),
    ],
    STONE,
    SELF_KEY,
  );

  it("is one set of boxes per distinct roster, not per row", () => {
    expect(lotRosters(rosterQueue).map((r) => r.names)).toEqual([
      ["Husky", "Rune"],
      ["Husky", "Rune", "Kelp"],
    ]);
  });

  it("offers no boxes for a row nobody else ran, which has nothing to divide", () => {
    const solo = lotQueue(
      [party("p1", "limbo", duo())],
      [pool("p1", [drop("l1", STONE, "2026-07-16", ["m1"])])],
      STONE,
      SELF_KEY,
    );
    expect(lotRosters(solo)).toEqual([]);
  });

  it("applies a typed ratio to every row that roster ran, by their seat in it", () => {
    const [duoRoster, trioRoster] = lotRosters(rosterQueue);
    const body = lotSaleBody(STONE, 3 * B, "RECEIVED", "FAIR", rosterQueue, {
      [duoRoster!.key]: { Husky: 1, Rune: 2 },
      [trioRoster!.key]: { Husky: 1, Rune: 1, Kelp: 0 },
    });
    expect(body.rows.map((r) => [r.lootId, r.shares])).toEqual([
      ["l1", { m1: 1, m2: 2 }],
      ["l2", { m1: 1, m2: 1, m3: 0 }],
      ["l3", { m1: 1, m2: 2 }],
    ]);
  });

  it("is an even split where nothing was typed", () => {
    expect(
      lotSaleBody(STONE, 3 * B, "RECEIVED", "FAIR", rosterQueue).rows.map((r) => r.shares),
    ).toEqual([
      { m1: 1, m2: 1 },
      { m1: 1, m2: 1, m3: 1 },
      { m1: 1, m2: 1 },
    ]);
  });
});

describe("the drops a lot can be entered for", () => {
  it("lists only what is waiting, most units first", () => {
    const parties = [party("p1", "limbo", duo())];
    const pools = [
      pool("p1", [
        drop("l1", STONE, "2026-07-16", ["m1"]),
        drop("l2", STONE, "2026-07-23", ["m1"]),
        drop("l3", BOX, "2026-07-23", ["m1"]),
        // Sold, so it is not waiting for anything.
        drop("l4", BOX, "2026-07-30", ["m1"], { soldAt: "2026-08-01T00:00:00Z" }),
      ]),
    ];
    const drops = lotDrops(parties, pools, new Set([STONE, BOX]), SELF_KEY);
    expect(drops.map((d) => [d.dropKey, d.units])).toEqual([
      [STONE, 2],
      [BOX, 1],
    ]);
  });

  it("leaves out a drop with an empty queue rather than showing a box that refuses everything", () => {
    const drops = lotDrops(
      [party("p1", "limbo", duo())],
      [pool("p1", [])],
      new Set([STONE]),
      SELF_KEY,
    );
    expect(drops).toEqual([]);
  });
});
