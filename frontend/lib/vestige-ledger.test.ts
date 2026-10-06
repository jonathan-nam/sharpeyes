import { describe, expect, it } from "vitest";
import {
  type Holder,
  SELF_KEY,
  alsoHeldByYou,
  answeredByHolder,
  answeredByPair,
  answeredKey,
  boughtByHolder,
  closedByHolder,
  closureKey,
  couponGapOf,
  couponMoney,
  holderKey,
  holderLedgers,
  holderOf,
  keptByHolder,
  ledgerForLoot,
  outstanding,
  runningBalance,
  receivedByHolder,
  saleCredits,
  salesByHolder,
  stillOpen,
  suggestArrangement,
  unaccounted,
  unanswered,
} from "./vestige-ledger";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

const M = 1_000_000;
const VESTIGE = "vestige-of-erion";
const ORDER = new Map([
  ["limbo", 6],
  ["baldrix", 7],
  ["kalos-the-guardian", 2],
]);

/**
 * A seat. `mine` makes it one of YOUR characters, `person` somebody on the people list.
 *
 * The three kinds of seat are the whole point of this file: your own fold into one holder, one
 * person's characters fold into one holder, and a character nobody has claimed stands alone.
 */
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

const party = (id: string, bossKey: string, members: PartyMember[]): Party => ({
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
});

const coupon = (
  id: string,
  bossKey: string,
  quantity: number,
  weekStart: string,
  over: Partial<Loot> = {},
): Loot => ({
  id,
  dropKey: VESTIGE,
  customName: null,
  name: "Vestige of Erion Coupon",
  iconUrl: null,
  perMember: null,
  bossKey,
  quantity,
  difficulty: null,
  droppedOn: weekStart,
  weekStart,
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
  ...over,
});

const pool = (partyId: string, loot: Loot[]): PartyLootPool => ({ partyId, loot });

const SELF: Holder = { kind: "SELF", personId: null, characterName: null };
const BRO: Holder = { kind: "PERSON", personId: "p-bro", characterName: null };

/** Your character loots for a trio with two strangers. */
const trio = () => [seat("m1", "Husky", { mine: true }), seat("m2", "Rune"), seat("m3", "Bob")];

describe("who a seat belongs to", () => {
  it("is the person when somebody plays them, you when they are yours, the name otherwise", () => {
    expect(holderOf(seat("m1", "CreedBratton", { person: ["p-bro", "Bro"] }))).toEqual(BRO);
    expect(holderOf(seat("m2", "Husky", { mine: true }))).toEqual(SELF);
    expect(holderOf(seat("m3", "Stranger"))).toEqual({
      kind: "CHARACTER",
      personId: null,
      characterName: "stranger",
    });
  });

  it("folds one key per holder, so a name spelled two ways is one pile", () => {
    expect(holderKey(holderOf(seat("m1", "Rune")))).toBe(holderKey(holderOf(seat("m2", "rune"))));
    // Two of one person's characters, and two of yours, are each one key.
    expect(holderKey(holderOf(seat("m1", "CreedBratton", { person: ["p-bro", "Bro"] })))).toBe(
      holderKey(holderOf(seat("m2", "Freeballynn", { person: ["p-bro", "Bro"] }))),
    );
    expect(holderKey(holderOf(seat("m3", "Husky", { mine: true })))).toBe(
      holderKey(holderOf(seat("m4", "morebuff12", { mine: true }))),
    );
  });
});

describe("which drops are outstanding", () => {
  it("takes the recorded arrangement", () => {
    const p = party("pa", "limbo", trio());
    const split = coupon("l1", "limbo", 60, "2026-07-30", {
      bundles: 3,
      bundlesBy: [
        { memberId: "m1", bundles: 1 },
        { memberId: "m2", bundles: 1 },
        { memberId: "m3", bundles: 1 },
      ],
    });

    // A stack each is exactly everybody's share, so nothing is owed and it leaves the queue.
    expect(outstanding([p], [pool("pa", [split])], VESTIGE, ORDER)).toEqual([]);
  });

  it("assumes nobody looted the lot when nothing was recorded", () => {
    // The party looter decided this once, unseen after its picker went (#393). Retired in V78.
    const p = party("pa", "limbo", trio());
    const uncounted = coupon("l1", "limbo", 60, "2026-07-30", { bundles: 3, bundlesBy: [] });
    expect(outstanding([p], [pool("pa", [uncounted])], VESTIGE, ORDER)).toEqual([]);
  });

  it("takes a drop one seat looted whole", () => {
    const p = party("pa", "limbo", trio());
    const drops = outstanding(
      [p],
      [
        pool("pa", [
          coupon("l1", "limbo", 60, "2026-07-30", {
            bundles: 3,
            bundlesBy: [{ memberId: "m1", bundles: 3 }],
          }),
        ]),
      ],
      VESTIGE,
      ORDER,
    );
    expect(drops).toHaveLength(1);
    expect(drops[0]!.holder).toEqual(SELF);
    expect(drops[0]!.looterName).toBe("Husky");
    // The looter holds the lot; the others hold none and are owed their share.
    expect(drops[0]!.drop.seats.map((s) => s.looted)).toEqual([60, 0, 0]);
  });

  it("leaves out a party where everybody loots their own", () => {
    // The clear recorded this character's SHARE, nothing is owed, and the even night never appears.
    const p = party("pa", "limbo", trio());
    expect(
      outstanding([p], [pool("pa", [coupon("l1", "limbo", 20, "2026-08-06")])], VESTIGE, ORDER),
    ).toEqual([]);
  });

  it("leaves out a night that is all one person, however many characters they brought", () => {
    // Two of your own characters. Somebody looted the lot, and it is already where it belongs:
    // you cannot owe yourself, and a debt on this row would be a figure nobody should act on.
    const mine = party("pa", "limbo", [
      seat("m1", "Husky", { mine: true }),
      seat("m2", "morebuff12", { mine: true }),
    ]);
    const minesLot = coupon("l1", "limbo", 60, "2026-07-30", {
      bundles: 3,
      bundlesBy: [{ memberId: "m1", bundles: 3 }],
    });
    expect(outstanding([mine], [pool("pa", [minesLot])], VESTIGE, ORDER)).toEqual([]);

    // Same for a duo that is one other person's two characters.
    const theirs = party("pb", "limbo", [
      seat("m3", "CreedBratton", { person: ["p-bro", "Bro"] }),
      seat("m4", "Freeballynn", { person: ["p-bro", "Bro"] }),
    ]);
    const theirLot = coupon("l2", "limbo", 60, "2026-07-30", {
      bundles: 3,
      bundlesBy: [{ memberId: "m3", bundles: 3 }],
    });
    expect(outstanding([theirs], [pool("pb", [theirLot])], VESTIGE, ORDER)).toEqual([]);
  });

  it("leaves out other drops, and a party of one", () => {
    const p = party("pa", "limbo", trio());
    const other: Loot = {
      ...coupon("l2", "limbo", 1, "2026-07-30"),
      dropKey: "grindstone-of-faith",
    };
    expect(outstanding([p], [pool("pa", [other])], VESTIGE, ORDER)).toEqual([]);

    const alone = party("pb", "limbo", [seat("m9", "Husky", { mine: true })]);
    expect(
      outstanding([alone], [pool("pb", [coupon("l3", "limbo", 60, "2026-07-30")])], VESTIGE, ORDER),
    ).toEqual([]);
  });
});

describe("a drop is measured against the week it fell in", () => {
  // A pool spans months and the party is not the same every night: a trio in July, a duo in August.
  // `party.members` is whichever ONE week the page asked for, so reading the pool against it answers
  // for the wrong night. The drop carries its own week's seats, and now they are what is read.
  const roster = trio();
  const [husky, rune] = roster;

  /** The party as this week sees it, which is the duo. Every seat is still on it. */
  const thisWeekIsADuo = (): Party => ({
    ...party("pa", "limbo", roster),
    members: [husky!, rune!],
  });

  it("divides July's trio three ways while this week is a duo", () => {
    const july = coupon("l1", "limbo", 60, "2026-07-30", {
      ranThatWeek: ["m1", "m2", "m3"],
      bundles: 3,
      bundlesBy: [{ memberId: "m1", bundles: 3 }],
    });
    const rows = outstanding([thisWeekIsADuo()], [pool("pa", [july])], VESTIGE, ORDER);

    // Husky looted the lot for three people. Read against this week it would owe Rune 30, which is
    // the whole of Bob's share handed to somebody else.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.drop.seats.map((s) => s.name)).toEqual(["you", "Rune", "Bob"]);
    expect(rows[0]!.drop.seats.map((s) => s.looted)).toEqual([60, 0, 0]);
  });

  it("asks about the duo's night and not the trio's, on one pool holding both", () => {
    // Three stacks of 20. The trio takes one each and owes nobody; the duo cannot, and 10 pieces
    // end up on the wrong side of the party.
    const drops = [
      coupon("l1", "limbo", 60, "2026-07-30", { bundles: 3, ranThatWeek: ["m1", "m2", "m3"] }),
      coupon("l2", "limbo", 60, "2026-08-06", { bundles: 3, ranThatWeek: ["m1", "m2"] }),
    ];
    const open = unanswered([thisWeekIsADuo()], [pool("pa", drops)], VESTIGE);

    expect(open.map((d) => d.lootId)).toEqual(["l2"]);
    expect(open[0]!.imbalance).toBe(10);
    // And the stacks may only be handed to the two who were there.
    expect(open[0]!.seats.map((s) => s.name)).toEqual(["Husky", "Rune"]);
  });

  it("hands a stack to the guest who ran that night, not to this week's roster", () => {
    // Bob is out this week. July's odd stack is his, and a card drawing this week's seats could
    // neither say so nor correct it.
    const july = coupon("l1", "limbo", 60, "2026-07-30", { bundles: 3, ranThatWeek: ["m1", "m3"] });
    const open = unanswered([thisWeekIsADuo()], [pool("pa", [july])], VESTIGE);

    expect(open[0]!.seats.map((s) => s.name)).toEqual(["Husky", "Bob"]);
  });

  it("falls back to the party when the week names nobody, rather than reading it as empty", () => {
    // Every seat retired and no week spelled out. There is no answer for that week, and an empty
    // roster would say none of the 60 is yours.
    const p = thisWeekIsADuo();
    const rows = outstanding(
      [p],
      [
        pool("pa", [
          coupon("l1", "limbo", 60, "2026-07-30", {
            bundles: 3,
            bundlesBy: [{ memberId: "m1", bundles: 3 }],
          }),
        ]),
      ],
      VESTIGE,
      ORDER,
    );

    expect(rows[0]!.drop.seats.map((s) => s.name)).toEqual(["you", "Rune"]);
  });
});

describe("a debt is between people, not between characters", () => {
  it("nets two of your characters into one seat, so you are owed once", () => {
    // Husky loots 60 for a trio of you, your alt, and Jared. Two thirds of it is already yours.
    const p = party("pa", "limbo", [
      seat("m1", "Husky", { mine: true }),
      seat("m2", "morebuff12", { mine: true }),
      seat("m3", "CourseLair", { person: ["p-jared", "Jared"] }),
    ]);
    const ledgers = holderLedgers(
      outstanding(
        [p],
        [
          pool("pa", [
            coupon("l1", "limbo", 60, "2026-07-30", {
              bundles: 3,
              bundlesBy: [{ memberId: "m1", bundles: 3 }],
            }),
          ]),
        ],
        VESTIGE,
        ORDER,
      ),
      salesByHolder([{ holder: SELF, pieces: 60, amount: 600 * M }]),
    );

    const limbo = ledgers[0]!.drops[0]!;
    // One debt, to Jared, for a third. Keyed by character this said "owes morebuff12 20" as well,
    // which is you paying yourself.
    expect(limbo.transfers.map((t) => [t.to, t.pieces])).toEqual([["Jared", 20]]);
  });

  it("counts one person's two seats as two shares, and pays them once", () => {
    // Bro brought two characters, so he is entitled to two thirds of the drop, in one transfer.
    const p = party("pa", "limbo", [
      seat("m1", "Husky", { mine: true }),
      seat("m2", "CreedBratton", { person: ["p-bro", "Bro"] }),
      seat("m3", "Freeballynn", { person: ["p-bro", "Bro"] }),
    ]);
    const ledgers = holderLedgers(
      outstanding(
        [p],
        [
          pool("pa", [
            coupon("l1", "limbo", 60, "2026-07-30", {
              bundles: 3,
              bundlesBy: [{ memberId: "m1", bundles: 3 }],
            }),
          ]),
        ],
        VESTIGE,
        ORDER,
      ),
      new Map(),
    );
    expect(ledgers[0]!.drops[0]!.transfers.map((t) => [t.to, t.pieces])).toEqual([["Bro", 40]]);
  });
});

describe("uneven self-looting", () => {
  const me = seat("m1", "Husky", { mine: true });
  const them = seat("m2", "Nova", { person: ["p-nova", "Nova"] });
  const NOVA: Holder = { kind: "PERSON", personId: "p-nova", characterName: null };
  const duo = [party("pt", "baldrix", [me, them])];
  const split = [
    { memberId: "m1", bundles: 2 },
    { memberId: "m2", bundles: 1 },
  ];

  const baldrix = (over: Partial<Loot> = {}) => [
    pool("pt", [coupon("l1", "baldrix", 120, "2026-08-06", { bundles: 3, ...over })]),
  ];

  it("says a drop that cannot divide is unanswered, and how big the hole is", () => {
    const open = unanswered(duo, baldrix(), VESTIGE);
    expect(open).toHaveLength(1);
    // 3 stacks between 2 people is 2 and 1, so somebody holds half a stack that is not theirs.
    expect(open[0]!.imbalance).toBe(20);
    expect(open[0]!.bundles).toBe(3);
    // No direction is invented, so nothing is outstanding until somebody says who bent down.
    expect(outstanding(duo, baldrix(), VESTIGE, ORDER)).toEqual([]);
  });

  it("builds both piles once the stacks are named, and only the debtor owes", () => {
    const said = baldrix({ bundlesBy: split });
    expect(unanswered(duo, said, VESTIGE)).toEqual([]);

    const drops = outstanding(duo, said, VESTIGE, ORDER);
    // One row per PILE: the drop sits in two inventories, each draining its own owner's sales.
    expect(drops).toHaveLength(2);
    const mine = drops.find((d) => holderKey(d.holder) === holderKey(SELF))!;
    expect(mine.drop.held).toBe(80);
    // Entitlements are still measured against the whole 120, never against one pile.
    expect(mine.drop.total).toBe(120);

    // Both piles are named for the row's display, not just whichever sorted first.
    expect(ledgerForLoot(holderLedgers(drops, new Map()), "l1")).toHaveLength(2);

    const ledgers = holderLedgers(drops, new Map());
    const yours = ledgers.find((l) => holderKey(l.holder) === holderKey(SELF))!;
    expect(yours.pieces).toBe(80);
    expect(yours.drops[0]!.transfers).toHaveLength(1);
    expect(yours.drops[0]!.transfers[0]!.pieces).toBe(20);
    // The other pile owes nothing, so its row carries no transfer rather than repeating this one.
    const theirs = ledgers.find((l) => holderKey(l.holder) === holderKey(NOVA))!;
    expect(theirs.drops[0]!.transfers).toEqual([]);
  });

  it("reads a row cached before the fields existed as one that says nothing", () => {
    // lib/cache.ts holds whatever shape the API had when the page last fetched, typed as whatever
    // it is read back as, so a tab open across a deploy gets rows without the new fields. This
    // threw on `bundlesBy.length`, and `undefined !== null` would have let the arithmetic run on
    // nothing and put a NaN on screen.
    const stale = coupon("l9", "baldrix", 120, "2026-08-06");
    delete (stale as Partial<Loot>).bundles;
    delete (stale as Partial<Loot>).bundlesBy;
    const pools = [pool("pt", [stale])];

    expect(() => unanswered(duo, pools, VESTIGE)).not.toThrow();
    expect(unanswered(duo, pools, VESTIGE)).toEqual([]);
    expect(outstanding(duo, pools, VESTIGE, ORDER)).toEqual([]);
  });

  it("leaves an even night alone, and folds one person's characters before deciding", () => {
    // 6 stacks between 2 holders is 3 each, so nothing is out of place and nothing is asked.
    const six = [pool("pt", [coupon("l2", "baldrix", 120, "2026-08-06", { bundles: 6 })])];
    expect(unanswered(duo, six, VESTIGE)).toEqual([]);
    expect(outstanding(duo, six, VESTIGE, ORDER)).toEqual([]);

    // 3 stacks, 3 characters, but two of them are one person: 2 shares against 1, so 2 stacks
    // against 1, and it divides. Reading this per SEAT would invent a debt that does not exist.
    const pair = seat("m3", "Nova2", { person: ["p-nova", "Nova"] });
    const trio = [party("pt", "baldrix", [me, them, pair])];
    const drop = [pool("pt", [coupon("l3", "baldrix", 120, "2026-08-06", { bundles: 3 })])];
    expect(unanswered(trio, drop, VESTIGE)).toEqual([]);
    expect(outstanding(trio, drop, VESTIGE, ORDER)).toEqual([]);
  });
});

describe("the arrangement put in front of somebody", () => {
  const me = seat("m1", "Husky", { mine: true });
  const them = seat("m2", "Nova", { person: ["p-nova", "Nova"] });
  const NOVA_KEY = holderKey({ kind: "PERSON", personId: "p-nova", characterName: null });

  it("balances rather than concentrates, because every crossing piece pays the fee twice", () => {
    // Four seats, six stacks. 2,2,1,1 moves one stack of value; 3,1,1,1 moves one and a half.
    const four = [me, them, seat("m3", "Cid"), seat("m4", "Dot")];
    const suggested = suggestArrangement(6, four, new Map());
    expect([...suggested.values()].sort()).toEqual([1, 1, 2, 2]);
  });

  it("gives the odd stack to whoever is furthest behind, so it rotates on its own", () => {
    // Nobody behind: the tie falls to seat order, so the first seat takes the extra.
    expect(suggestArrangement(3, [me, them], new Map()).get("m1")).toBe(2);
    // Nova is owed 20 from an earlier night, so this week's odd stack is hers.
    const rotated = suggestArrangement(3, [me, them], new Map([[NOVA_KEY, 20]]));
    expect(rotated.get("m2")).toBe(2);
    expect(rotated.get("m1")).toBe(1);
  });

  it("gives a bigger share a bigger floor, before the rotation gets a say", () => {
    // Two shares against one is 2 stacks against 1 on the floor alone, so there is no odd stack for
    // the rotation to hand anybody. A party that wants the extra to stop moving says so this way.
    const carried = { ...them, shares: 2 };
    const split = suggestArrangement(3, [me, carried], new Map([[holderKey(SELF), 20]]));
    expect(split.get("m2")).toBe(2);
    expect(split.get("m1")).toBe(1);
  });

  it("leaves a seat out rather than handing them zero stacks", () => {
    // The server refuses a zero: somebody who did not bend down is absent, not present with none.
    const suggested = suggestArrangement(1, [me, them], new Map());
    expect(suggested.has("m2")).toBe(false);
    expect([...suggested.values()].reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("counts a drop once when working out who is behind, not once per pile", () => {
    const duo = [party("pt", "baldrix", [me, them])];
    const said = [
      pool("pt", [
        coupon("l1", "baldrix", 120, "2026-08-06", {
          bundles: 3,
          bundlesBy: [
            { memberId: "m1", bundles: 2 },
            { memberId: "m2", bundles: 1 },
          ],
        }),
      ]),
    ];
    const drops = outstanding(duo, said, VESTIGE, ORDER);
    expect(drops).toHaveLength(2);
    // Two rows, one drop. Nova is owed 20, not 40.
    expect(runningBalance(drops).get(NOVA_KEY)).toBe(20);
    expect(runningBalance(drops).get(holderKey(SELF))).toBe(-20);
  });
});

/**
 * A firm agreement, as against the odd stack taking turns.
 *
 * "mechyfechy takes 4 stacks, Freeballynn takes 2" is a SPLIT, not a night that failed to divide.
 * Said as shares it divides exactly, so nothing is outstanding and nobody is asked anything, which
 * is the whole difference between an agreement and a remainder.
 */
describe("a party that has agreed an uneven split", () => {
  const mine = (name: string, shares: number) => ({ ...seat("m1", name, { mine: true }), shares });
  const theirs = (name: string, shares: number) => ({
    ...seat("m2", name, { person: ["p-bro", "Bro"] }),
    shares,
  });

  it("takes the stacks in the ratio it agreed, and leaves nobody owing", () => {
    // Extreme Kalos, 180 in 6 stacks of 30. 6 x 4/6 and 6 x 2/6 is four stacks and two.
    const seats = [mine("mechyfechy", 4), theirs("Freeballynn", 2)];
    const kalos = [party("pk", "kalos-the-guardian", seats)];
    const drop = [
      pool("pk", [coupon("l1", "kalos-the-guardian", 180, "2026-08-06", { bundles: 6 })]),
    ];

    expect(suggestArrangement(6, seats, new Map())).toEqual(
      new Map([
        ["m1", 4],
        ["m2", 2],
      ]),
    );
    expect(unanswered(kalos, drop, VESTIGE)).toEqual([]);
    expect(outstanding(kalos, drop, VESTIGE, ORDER)).toEqual([]);
  });

  it("lets one member keep the lot, owing nobody", () => {
    // Hard Limbo is 60 in 3 stacks of 20, and a duo cannot divide 3 stacks. On 1 and 0 there is
    // nothing to divide: Husky is entitled to all three, holds all three, and owes nobody. The
    // party leaves the Drop Log rather than sitting there as a night that will not come out.
    const seats = [mine("Huskyxkenshi", 1), theirs("CourseLair", 0)];
    const limbo = [party("pl", "limbo", seats)];
    const drop = [pool("pl", [coupon("l3", "limbo", 60, "2026-08-06", { bundles: 3 })])];

    expect(suggestArrangement(3, seats, new Map())).toEqual(new Map([["m1", 3]]));
    expect(unanswered(limbo, drop, VESTIGE)).toEqual([]);
    expect(outstanding(limbo, drop, VESTIGE, ORDER)).toEqual([]);
  });

  it("still refuses to divide when the shares cannot come out in whole stacks", () => {
    // 3 and 1 is a weight of 4, so Husky is entitled to 2.25 stacks. Nobody can pick that up, so
    // it is a night that does not divide however it is looted. This is what 1 and 0 replaces.
    const seats = [mine("Huskyxkenshi", 3), theirs("CourseLair", 1)];
    const limbo = [party("pl", "limbo", seats)];
    const drop = [pool("pl", [coupon("l4", "limbo", 60, "2026-08-06", { bundles: 3 })])];

    expect(unanswered(limbo, drop, VESTIGE)).toHaveLength(1);
    expect(unanswered(limbo, drop, VESTIGE)[0]!.imbalance).toBe(5);
  });

  it("reads 4 and 2 as the same agreement as 2 and 1", () => {
    // The numbers people say to each other go straight in, whichever way they say them.
    const long = suggestArrangement(
      6,
      [mine("mechyfechy", 4), theirs("Freeballynn", 2)],
      new Map(),
    );
    const short = suggestArrangement(
      6,
      [mine("mechyfechy", 2), theirs("Freeballynn", 1)],
      new Map(),
    );
    expect(long).toEqual(short);
  });

  it("settles Malefic Star the same way, where an even split could not", () => {
    // 3 stacks between two. Even, it will not divide and somebody holds 15 that are not theirs.
    // Agreed 2 to 1, it divides exactly and there is nothing to answer.
    const seats = [mine("acornacorn", 1), theirs("CreedBratton", 2)];
    const star = [party("ps", "malefic-star", seats)];
    const drop = [pool("ps", [coupon("l2", "malefic-star", 90, "2026-08-06", { bundles: 3 })])];

    expect(suggestArrangement(3, seats, new Map())).toEqual(
      new Map([
        ["m1", 1],
        ["m2", 2],
      ]),
    );
    expect(unanswered(star, drop, VESTIGE)).toEqual([]);
    expect(outstanding(star, drop, VESTIGE, ORDER)).toEqual([]);
  });
});

describe("what the card is still waiting to be told", () => {
  // The pile is 390, half of it mine, and Bro loots the lot.
  const duo = () => [
    seat("m1", "Husky", { mine: true }),
    seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
  ];

  const ledgerFor = (
    rows: { holder: Holder; pieces: number; amount: number | null; disposition?: string }[],
  ) =>
    holderLedgers(
      outstanding(
        [party("pa", "limbo", duo())],
        [
          pool("pa", [
            coupon("l1", "limbo", 390, "2026-08-03", {
              bundles: 3,
              bundlesBy: [{ memberId: "m2", bundles: 3 }],
            }),
          ]),
        ],
        VESTIGE,
        ORDER,
      ),
      salesByHolder(rows),
      keptByHolder(rows),
      boughtByHolder(rows),
    )[0]!;

  it("counts every fate towards the pile, so the gap is what is left to enter", () => {
    const fresh = ledgerFor([]);
    expect([fresh.accounted, unaccounted(fresh)]).toEqual([0, 390]);

    // Each of the three closes the gap by its own pieces, whatever it did with them.
    const part = ledgerFor([
      { holder: BRO, pieces: 100, amount: 2_500 * M, disposition: "SOLD" },
      { holder: BRO, pieces: 50, amount: null, disposition: "KEPT" },
      { holder: BRO, pieces: 25, amount: 600 * M, disposition: "BOUGHT" },
    ]);
    expect([part.soldPieces, part.kept, part.bought.pieces]).toEqual([100, 50, 25]);
    expect([part.accounted, unaccounted(part)]).toEqual([175, 215]);
  });

  it("closes to nothing when the whole pile is spoken for", () => {
    const done = ledgerFor([
      { holder: BRO, pieces: 195, amount: 4_875 * M, disposition: "SOLD" },
      { holder: BRO, pieces: 195, amount: null, disposition: "KEPT" },
    ]);
    expect([done.accounted, unaccounted(done)]).toEqual([390, 0]);
  });

  it("floors at zero and carries the surplus, rather than reading negative", () => {
    // More entered than the pile holds. Said, not clamped: the raw figures are both here so the card
    // can name the excess instead of quietly absorbing it.
    const over = ledgerFor([{ holder: BRO, pieces: 400, amount: 10_000 * M, disposition: "SOLD" }]);
    expect(over.accounted).toBe(400);
    expect(unaccounted(over)).toBe(0);
    expect(over.accounted - over.pieces).toBe(10);
  });
});

describe("pieces answered with money rather than with coupons", () => {
  const SELF: Holder = { kind: "SELF", personId: null, characterName: null };

  it("counts what a sale named as somebody else's, and not the rest of the lot", () => {
    const answered = answeredByHolder([
      { holder: SELF, pieces: 60, amount: 1_500 * M, shares: [{ holder: BRO, pieces: 30 }] },
    ]);
    expect(answered.get("self")).toBe(30);
  });

  it("counts a purchase in full when it named nobody, which is every one entered so far", () => {
    // V50's own rule: a purchase is one creditor's in full. Dropping this would reopen every pile
    // that reached all-accounted-for through the box that says "I took theirs, at a price".
    const answered = answeredByHolder([
      { holder: SELF, pieces: 25, amount: 600 * M, disposition: "BOUGHT" },
    ]);
    expect(answered.get("self")).toBe(25);
  });

  it("counts a purchase that DID name somebody once, not twice", () => {
    const answered = answeredByHolder([
      {
        holder: SELF,
        pieces: 25,
        amount: 600 * M,
        disposition: "BOUGHT",
        shares: [{ holder: BRO, pieces: 25 }],
      },
    ]);
    expect(answered.get("self")).toBe(25);
  });

  it("counts a redemption not at all, having realized nothing to hand anybody", () => {
    const answered = answeredByHolder([{ holder: SELF, pieces: 50, amount: null }]);
    expect(answered.size).toBe(0);
  });

  it("ignores a share naming the pile's own holder, which owes itself nothing", () => {
    const answered = answeredByHolder([
      { holder: SELF, pieces: 60, amount: 1_500 * M, shares: [{ holder: SELF, pieces: 60 }] },
    ]);
    expect(answered.size).toBe(0);
  });

  it("caps at the tranche, so a bad cached row cannot answer for more than it held", () => {
    const answered = answeredByHolder([
      { holder: SELF, pieces: 30, amount: 1_500 * M, shares: [{ holder: BRO, pieces: 400 }] },
    ]);
    expect(answered.get("self")).toBe(30);
  });

  it("adds up across tranches, per pile", () => {
    const answered = answeredByHolder([
      { holder: SELF, pieces: 40, amount: 1_000 * M, shares: [{ holder: BRO, pieces: 10 }] },
      { holder: SELF, pieces: 20, amount: 500 * M, disposition: "BOUGHT" },
      { holder: BRO, pieces: 80, amount: 2_000 * M, shares: [{ holder: SELF, pieces: 40 }] },
    ]);
    expect([answered.get("self"), answered.get("person:p-bro")]).toEqual([30, 40]);
  });
});

describe("the same pieces, per pile AND creditor", () => {
  const SELF: Holder = { kind: "SELF", personId: null, characterName: null };
  const ZADDY: Holder = { kind: "CHARACTER", personId: null, characterName: "zaddy" };

  it("keeps whose the pieces were, which the pile total throws away", () => {
    const answered = answeredByPair([
      { holder: SELF, pieces: 70, amount: 1_298 * M, shares: [{ holder: BRO, pieces: 70 }] },
    ]);
    expect(answered.get(answeredKey("self", "person:p-bro"))).toBe(70);
  });

  it("splits one tranche between the two people it named", () => {
    const answered = answeredByPair([
      {
        holder: SELF,
        pieces: 60,
        amount: 1_500 * M,
        shares: [
          { holder: BRO, pieces: 40 },
          { holder: ZADDY, pieces: 20 },
        ],
      },
    ]);
    expect([
      answered.get(answeredKey("self", "person:p-bro")),
      answered.get(answeredKey("self", "character:zaddy")),
    ]).toEqual([40, 20]);
  });

  it("attributes a purchase that named nobody to nobody", () => {
    // It is one creditor's in full by V50, and it does not say WHICH. The pile total still counts it,
    // so the Sale Ledger is unmoved; naming a person here would discharge a debt against somebody who
    // never agreed to it, which is worse than the missing subtraction.
    expect(
      answeredByPair([{ holder: SELF, pieces: 25, amount: 600 * M, disposition: "BOUGHT" }]),
    ).toEqual(new Map());
  });

  it("counts a purchase that DID name somebody, at the price it named", () => {
    const answered = answeredByPair([
      {
        holder: SELF,
        pieces: 25,
        amount: 600 * M,
        disposition: "BOUGHT",
        shares: [{ holder: BRO, pieces: 25 }],
      },
    ]);
    expect(answered.get(answeredKey("self", "person:p-bro"))).toBe(25);
  });

  it("counts a redemption not at all, having realized nothing", () => {
    expect(
      answeredByPair([
        { holder: SELF, pieces: 50, amount: null, shares: [{ holder: BRO, pieces: 50 }] },
      ]),
    ).toEqual(new Map());
  });

  it("ignores a share naming the pile's own holder, and spends none of the tranche on it", () => {
    // The self share is not a debt, so the pieces after it must still have the whole tranche to draw
    // on. Letting it eat the budget would silently under-answer the person who WAS named.
    const answered = answeredByPair([
      {
        holder: SELF,
        pieces: 60,
        amount: 1_500 * M,
        shares: [
          { holder: SELF, pieces: 20 },
          { holder: BRO, pieces: 60 },
        ],
      },
    ]);
    expect(answered.get(answeredKey("self", "character:zaddy"))).toBeUndefined();
    expect(answered.get(answeredKey("self", "person:p-bro"))).toBe(60);
  });

  it("caps at the tranche in share order, so a bad cached row answers for what fell", () => {
    const answered = answeredByPair([
      {
        holder: SELF,
        pieces: 30,
        amount: 1_500 * M,
        shares: [
          { holder: BRO, pieces: 25 },
          { holder: ZADDY, pieces: 25 },
        ],
      },
    ]);
    expect([
      answered.get(answeredKey("self", "person:p-bro")),
      answered.get(answeredKey("self", "character:zaddy")),
    ]).toEqual([25, 5]);
  });

  it("adds up across tranches, per pair", () => {
    const answered = answeredByPair([
      { holder: SELF, pieces: 40, amount: 1_000 * M, shares: [{ holder: BRO, pieces: 10 }] },
      { holder: SELF, pieces: 40, amount: 1_000 * M, shares: [{ holder: BRO, pieces: 15 }] },
      { holder: BRO, pieces: 80, amount: 2_000 * M, shares: [{ holder: SELF, pieces: 40 }] },
    ]);
    expect([
      answered.get(answeredKey("self", "person:p-bro")),
      answered.get(answeredKey("person:p-bro", "self")),
    ]).toEqual([25, 40]);
  });

  it("never answers for more than the pile total does", () => {
    // The two are subtracted on two different screens, so a pair total above the pile's would put the
    // Settlement Ledger back below the Sale Ledger, which is the disagreement this pair exists to end.
    const rows = [
      { holder: SELF, pieces: 30, amount: 1_500 * M, shares: [{ holder: BRO, pieces: 400 }] },
      { holder: SELF, pieces: 40, amount: 1_000 * M, shares: [{ holder: ZADDY, pieces: 10 }] },
    ];
    const pairs = [...answeredByPair(rows).values()].reduce((sum, n) => sum + n, 0);
    expect(pairs).toBeLessThanOrEqual(answeredByHolder(rows).get("self")!);
  });
});

describe("closing the books, which no arithmetic is entitled to do", () => {
  const duo = () => [
    seat("m1", "Husky", { mine: true }),
    seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
  ];
  const week = () => ({
    parties: [party("pa", "kalos-the-guardian", duo()), party("pb", "baldrix", duo())],
    pools: [
      pool("pa", [
        coupon("l1", "kalos-the-guardian", 180, "2026-08-06", {
          bundles: 6,
          bundlesBy: [{ memberId: "m2", bundles: 6 }],
        }),
      ]),
      pool("pb", [
        coupon("l2", "baldrix", 120, "2026-08-06", {
          bundles: 3,
          bundlesBy: [{ memberId: "m2", bundles: 3 }],
        }),
      ]),
    ],
  });

  /** The card for whichever of the two nights have been logged, with whatever has been closed. */
  const ledgerOf = (
    logged: string[],
    settlements: { holder: Holder; lootIds: string[]; unpaid: number }[],
  ) => {
    const { parties, pools } = week();
    const rows = [
      { holder: BRO, pieces: 150, amount: 3_750 * M, disposition: "SOLD" },
      { holder: BRO, pieces: 150, amount: null, disposition: "KEPT" },
    ];
    const only = pools.map((p) => ({ ...p, loot: p.loot.filter((l) => logged.includes(l.id)) }));
    return holderLedgers(
      outstanding(parties, only, VESTIGE, ORDER),
      salesByHolder(rows),
      keptByHolder(rows),
      boughtByHolder(rows),
      receivedByHolder([{ holder: BRO, amount: 3_700 * M }]),
      closedByHolder(settlements),
    )[0]!;
  };

  const ledgerFor = (settlements: { holder: Holder; lootIds: string[]; unpaid: number }[]) =>
    ledgerOf(["l1", "l2"], settlements);

  it("leaves a pile open until a person closes it, whatever the counts say", () => {
    const open = ledgerFor([]);
    // Every piece accounted for and money in. No arithmetic may call that done: a drop is queued on
    // `entitled - looted`, so nothing about a sale or a payment can retire it. Somebody decides.
    expect(unaccounted(open)).toBe(0);
    expect(open.received).toBe(3_700 * M);
    expect(open.closed).toBe(false);
    expect(open.drops.every((d) => !d.closed)).toBe(true);
  });

  it("closes the drops it names, and records what was written off", () => {
    const done = ledgerFor([{ holder: BRO, lootIds: ["l1", "l2"], unpaid: 50 * M }]);
    expect(done.closed).toBe(true);
    expect(done.writtenOff).toBe(50 * M);
    expect(done.drops.every((d) => d.closed)).toBe(true);
  });

  it("closes only what it names, so next week's drop reopens the card", () => {
    // The reason a settlement names DROPS and not a date: anything it did not name is still live.
    const half = ledgerFor([{ holder: BRO, lootIds: ["l1"], unpaid: 0 }]);
    expect(half.closed).toBe(false);
    expect(half.drops.map((d) => [d.bossKey, d.closed])).toEqual([
      ["kalos-the-guardian", true],
      ["baldrix", false],
    ]);
  });

  it("counts only what is still open, so a paid debt is not asked for a second time", () => {
    const half = ledgerFor([{ holder: BRO, lootIds: ["l1"], unpaid: 0 }]);
    // What they OWE is the open drops only: l2 alone, of which half is Husky's. The pile itself
    // still counts both, because that pair is the Sale Ledger's instruction and both sides of it
    // have to come from the same set.
    expect(half.owedToYou).toBe(60);
    expect(half.pieces).toBe(300);
    // l1 keeps its row, because that is where a mistyped tranche of it is still corrected.
    expect(half.drops.map((d) => [d.lootId, d.closed])).toEqual([
      ["l1", true],
      ["l2", false],
    ]);
  });

  it("is keyed per holder and drop, so one person's closure is not another's", () => {
    expect(closureKey(BRO, "l1")).not.toBe(closureKey(SELF, "l1"));
    const { closed } = closedByHolder([{ holder: BRO, lootIds: ["l1"], unpaid: 0 }]);
    expect(closed.has(closureKey(BRO, "l1"))).toBe(true);
    expect(closed.has(closureKey(SELF, "l1"))).toBe(false);
  });

  it("stops a closed debt tilting next week's arrangement", () => {
    const { parties, pools } = week();
    const drops = outstanding(parties, pools, VESTIGE, ORDER);
    const { closed } = closedByHolder([{ holder: BRO, lootIds: ["l1", "l2"], unpaid: 0 }]);

    // Bro is 150 pieces over across the two nights and has paid for it, so he is no longer behind.
    expect(runningBalance(drops).get(holderKey(BRO))).toBe(-150);
    expect(stillOpen(drops, closed)).toEqual([]);
    expect(runningBalance(stillOpen(drops, closed)).size).toBe(0);
  });
});

describe("the coupons you hold that owe nobody anything", () => {
  // The Sale Ledger takes a sale, so it has to admit every coupon you could sell. `outstanding()`
  // queues DEBTS and drops a night that came out square, which on a real account hid a stack of 120
  // and left the card reading 80 against the 200 really held.
  const mine = (id: string, name: string) => seat(id, name, { mine: true });

  it("adds a night that divided exactly, which the debt queue leaves out", () => {
    // Three seats, one stack each, all on one share: everybody landed on their entitlement.
    const parties = [
      party("pj", "limbo", [mine("m1", "mechyfechy"), seat("m2", "Zaddy"), seat("m3", "Premial")]),
    ];
    const pools = [
      pool("pj", [
        coupon("lj", "limbo", 360, "2026-08-06", {
          bundles: 3,
          bundlesBy: [
            { memberId: "m1", bundles: 1 },
            { memberId: "m2", bundles: 1 },
            { memberId: "m3", bundles: 1 },
          ],
        }),
      ]),
    ];
    const queued = outstanding(parties, pools, VESTIGE, ORDER);
    expect(queued).toEqual([]);
    expect(alsoHeldByYou(parties, pools, VESTIGE, ORDER, queued).map((d) => d.drop.held)).toEqual([
      120,
    ]);
  });

  it("adds a boss you ran alone, where there is no arrangement to read", () => {
    const parties = [party("ps", "limbo", [mine("m1", "mechyfechy")])];
    const pools = [pool("ps", [coupon("ls", "limbo", 180, "2026-08-06", { bundles: 3 })])];
    const queued = outstanding(parties, pools, VESTIGE, ORDER);
    expect(queued).toEqual([]);
    expect(alsoHeldByYou(parties, pools, VESTIGE, ORDER, queued).map((d) => d.drop.held)).toEqual([
      180,
    ]);
  });

  it("does not count a pile the queue already has, which would double it", () => {
    // The uneven night: you took 1 stack of 3 and were due 2, so the queue already holds your pile.
    const parties = [party("pa", "baldrix", [mine("m1", "mechyfechy"), seat("m2", "Creed")])];
    const pools = [
      pool("pa", [
        coupon("la", "baldrix", 240, "2026-08-06", {
          bundles: 3,
          bundlesBy: [
            { memberId: "m1", bundles: 1 },
            { memberId: "m2", bundles: 2 },
          ],
        }),
      ]),
    ];
    const queued = outstanding(parties, pools, VESTIGE, ORDER);
    expect(queued.filter((d) => holderKey(d.holder) === SELF_KEY).map((d) => d.drop.held)).toEqual([
      80,
    ]);
    expect(alsoHeldByYou(parties, pools, VESTIGE, ORDER, queued)).toEqual([]);
  });

  it("leaves somebody else's balanced pile alone, since you cannot sell out of it", () => {
    const parties = [party("pb", "limbo", [seat("m1", "Creed"), seat("m2", "Zaddy")])];
    const pools = [
      pool("pb", [
        coupon("lb", "limbo", 60, "2026-08-06", {
          bundles: 2,
          bundlesBy: [
            { memberId: "m1", bundles: 1 },
            { memberId: "m2", bundles: 1 },
          ],
        }),
      ]),
    ];
    expect(alsoHeldByYou(parties, pools, VESTIGE, ORDER, [])).toEqual([]);
  });

  it("comes to the whole pile once the card adds them up", () => {
    const parties = [
      party("pa", "baldrix", [mine("m1", "mechyfechy"), seat("m2", "Creed")]),
      party("pj", "limbo", [mine("m3", "mechyfechy"), seat("m4", "Zaddy"), seat("m5", "Premial")]),
    ];
    const pools = [
      pool("pa", [
        coupon("la", "baldrix", 240, "2026-08-06", {
          bundles: 3,
          bundlesBy: [
            { memberId: "m1", bundles: 1 },
            { memberId: "m2", bundles: 2 },
          ],
        }),
      ]),
      pool("pj", [
        coupon("lj", "limbo", 360, "2026-08-06", {
          bundles: 3,
          bundlesBy: [
            { memberId: "m3", bundles: 1 },
            { memberId: "m4", bundles: 1 },
            { memberId: "m5", bundles: 1 },
          ],
        }),
      ]),
    ];
    const queued = outstanding(parties, pools, VESTIGE, ORDER);
    const ledgers = holderLedgers(
      [...queued, ...alsoHeldByYou(parties, pools, VESTIGE, ORDER, queued)],
      salesByHolder([]),
    );
    const you = ledgers.find((l) => holderKey(l.holder) === SELF_KEY)!;
    // 80 off the uneven night plus 120 off the one that divided. It used to read 80.
    expect(you.pieces).toBe(200);
  });
});

describe("what the coupon piles fetched", () => {
  it("counts a sale of your own coupons on both sides", () => {
    expect(couponMoney([{ holder: SELF, pieces: 60, amount: 1_500 * M }])).toEqual({
      pooled: 1_500 * M,
      yourTake: 1_500 * M,
    });
  });

  it("keeps only your part of a lot that held somebody else's coupons", () => {
    // Half the lot was Bro's, so half the price is his. The whole lot is still what there was to
    // split, which is what the tile says it is showing.
    expect(
      couponMoney([
        { holder: SELF, pieces: 60, amount: 1_500 * M, shares: [{ holder: BRO, pieces: 30 }] },
      ]),
    ).toEqual({ pooled: 1_500 * M, yourTake: 750 * M });
  });

  it("counts your share of a lot sold out of somebody else's pile, and nothing more", () => {
    expect(
      couponMoney([
        { holder: BRO, pieces: 80, amount: 2_000 * M, shares: [{ holder: SELF, pieces: 20 }] },
      ]),
    ).toEqual({ pooled: 2_000 * M, yourTake: 500 * M });
  });

  it("leaves out a sale between two other people, which is no money of yours", () => {
    const other: Holder = { kind: "PERSON", personId: "p-other", characterName: null };
    expect(
      couponMoney([
        { holder: BRO, pieces: 80, amount: 2_000 * M, shares: [{ holder: other, pieces: 80 }] },
      ]),
    ).toEqual({ pooled: 0, yourTake: 0 });
  });

  it("leaves out a redemption, which realized nothing to put in a total", () => {
    expect(couponMoney([{ holder: SELF, pieces: 50, amount: null }])).toEqual({
      pooled: 0,
      yourTake: 0,
    });
  });

  it("leaves out a purchase, which is money going the other way", () => {
    // Pieces bought INTO your pile at an agreed price. Counted as a sale it would report what you
    // paid Bro as what you made.
    expect(
      couponMoney([
        {
          holder: SELF,
          pieces: 25,
          amount: 600 * M,
          disposition: "BOUGHT",
          shares: [{ holder: BRO, pieces: 25 }],
        },
      ]),
    ).toEqual({ pooled: 0, yourTake: 0 });
  });

  it("prices a share the way the card that asks for it does", () => {
    // saleCredits' own rounding, to the meso. The two disagreeing is one lot of coupons coming to
    // different money on two screens.
    const lot = {
      holder: SELF,
      pieces: 7,
      amount: 1_000 * M,
      shares: [{ holder: BRO, pieces: 3 }],
    };
    const credit = saleCredits([{ id: "t1", ...lot }]).get("person:p-bro")!;

    expect(couponMoney([lot]).yourTake).toBe(1_000 * M - credit.toThem);
  });
});

describe("a night one person looted whole", () => {
  // The ordinary night, and it was silent. Six stacks of an Extreme Kalos into one inventory, and
  // the 60 owed back read as no debt at all: the reader looked for a pile on the other side, and a
  // seat that bent down for nothing has none. Only the direction you OWE was affected, which is why
  // coupons owed TO you kept reading and nothing looked broken.
  const duo = () => [{ ...seat("m1", "Husky", { mine: true }), shares: 2 }, seat("m2", "Rune")];
  const night = (over: Partial<Loot>) =>
    coupon("l1", "kalos-the-guardian", 180, "2026-08-20", {
      ranThatWeek: ["m1", "m2"],
      bundles: 6,
      ...over,
    });

  it("says what you are holding of theirs when you took every stack", () => {
    const p = party("pa", "kalos-the-guardian", duo());
    const loot = night({ bundlesBy: [{ memberId: "m1", bundles: 6 }] });

    expect(couponGapOf(loot, p)).toEqual({
      pieces: 60,
      yours: true,
      by: "Rune",
      byKey: "character:rune",
      holder: SELF_KEY,
    });
  });

  it("reads the other way round, where they took the lot", () => {
    const p = party("pa", "kalos-the-guardian", duo());
    const loot = night({ bundlesBy: [{ memberId: "m2", bundles: 6 }] });

    expect(couponGapOf(loot, p)).toMatchObject({ pieces: 120, yours: false, by: "Rune" });
  });

  it("is silent on the night that came out even", () => {
    const p = party("pa", "kalos-the-guardian", duo());
    const loot = night({
      bundlesBy: [
        { memberId: "m1", bundles: 4 },
        { memberId: "m2", bundles: 2 },
      ],
    });

    expect(couponGapOf(loot, p)).toBeNull();
  });

  it("names whoever is furthest from their own share, not the biggest pile", () => {
    // 180 across 1:2:1 is 45, 90 and 45. Holding the lot leaves you 135 over, and it is Rune's 90
    // the night owes, not Bob's 45. Both of them hold nothing, so a pile cannot tell them apart.
    const members = [
      seat("m1", "Husky", { mine: true }),
      { ...seat("m2", "Rune"), shares: 2 },
      seat("m3", "Bob"),
    ];
    const p = party("pa", "kalos-the-guardian", members);
    const loot = night({
      ranThatWeek: ["m1", "m2", "m3"],
      bundlesBy: [{ memberId: "m1", bundles: 6 }],
    });

    expect(couponGapOf(loot, p)).toEqual({
      pieces: 135,
      yours: true,
      by: "Rune",
      byKey: "character:rune",
      holder: SELF_KEY,
    });
  });
});
