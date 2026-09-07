import { describe, expect, it } from "vitest";
import { splitOf } from "./loot";
import { buildWallet, type Counterparty } from "./wallet";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

// A seat of YOURS: linked to your roster, which is what makes it your side of a debt.
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

// Somebody else's seat. personId set means you have said whose character it is.
const theirs = (id: string, name: string, person?: { id: string; name: string }): PartyMember => ({
  id,
  name,
  personId: person?.id ?? null,
  personName: person?.name ?? null,
  characterId: null,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const chris = { id: "p-chris", name: "Chris" };

const party = (id: string, members: PartyMember[], over: Partial<Party> = {}): Party => ({
  id,
  slug: id,
  characterId: members[0]!.characterId!,
  solo: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey: "limbo",
  difficulty: null,
  minutes: null,
  members,
  seats: members,
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

const sold = (over: Partial<Loot> = {}): Loot => ({
  id: "l1",
  dropKey: "grindstone-of-faith",
  customName: null,
  name: "Grindstone of Faith",
  iconUrl: null,
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
  payouts: [{ memberId: "m2", paid: false, paidAt: null, shares: 1 }],
  ranThatWeek: [],
  bundles: null,
  bundlesBy: [],
  ...over,
});

const pool = (partyId: string, loot: Loot[]): PartyLootPool => ({ partyId, loot });

describe("buildWallet", () => {
  it("takes every figure from splitOf rather than dividing anything itself", () => {
    // The claim that matters: the wallet is a fold over the same split the drop's own row shows.
    // If these ever disagree, one of them is a second implementation.
    const p = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton", chris)]);
    const loot = sold();
    const expected = splitOf(loot, p.members)!;

    const wallet = buildWallet([p], [pool("pa", [loot])]);

    expect(wallet.owe).toBe(expected.shares[0]!.pay);
    expect(wallet.counterparties[0]!.lines[0]!.nets).toBe(expected.shares[0]!.nets);
  });

  it("owes when your seat sold, and is owed when theirs did", () => {
    const p = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton", chris)]);
    const youSold = buildWallet([p], [pool("pa", [sold()])]);
    // The same drop, sold by them: the payout row is now yours.
    const theySold = buildWallet(
      [p],
      [
        pool("pa", [
          sold({
            sellerMemberId: "m2",
            payouts: [{ memberId: "m1", paid: false, paidAt: null, shares: 1 }],
          }),
        ]),
      ],
    );

    expect(youSold.owe).toBeGreaterThan(0);
    expect(youSold.owed).toBe(0);
    expect(youSold.net).toBeLessThan(0);
    expect(theySold.owed).toBeGreaterThan(0);
    expect(theySold.owe).toBe(0);
    expect(theySold.net).toBeGreaterThan(0);
  });

  it("marks a line whose drop a member bought, so no sale is named for it", () => {
    // The debt is the same one and belongs in the same fold. What differs is only that the line
    // cannot say "sold": nothing was.
    const p = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton", chris)]);
    const bought = buildWallet([p], [pool("pa", [sold({ amountBasis: "BOUGHT" })])]);
    const listed = buildWallet([p], [pool("pa", [sold()])]);

    expect(bought.counterparties[0]!.lines[0]!.bought).toBe(true);
    expect(listed.counterparties[0]!.lines[0]!.bought).toBe(false);
  });

  it("folds a person's characters into one debt", () => {
    // The whole point of attributing characters: two of Chris's names are one person to settle up
    // with, not two.
    const one = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton", chris)]);
    const two = party("pb", [mine("m3", "mechyfechy"), theirs("m4", "CreedBratton2", chris)], {
      bossKey: "kalos",
    });

    const wallet = buildWallet(
      [one, two],
      [
        pool("pa", [sold()]),
        pool("pb", [
          sold({
            id: "l2",
            sellerMemberId: "m3",
            payouts: [{ memberId: "m4", paid: false, paidAt: null, shares: 1 }],
          }),
        ]),
      ],
    );

    expect(wallet.counterparties).toHaveLength(1);
    expect(wallet.counterparties[0]!.name).toBe("Chris");
    expect(wallet.counterparties[0]!.lines).toHaveLength(2);
    expect(wallet.counterparties[0]!.owe).toBe(wallet.owe);
  });

  it("owes a bigger share to whoever took one, still reading it off splitOf", () => {
    // The wallet is where "who owes who what" is finally answered, so an uneven night has to reach
    // it. Two seats on one drop, one of them on a double share.
    const p = party("pa", [
      mine("m1", "mechyfechy"),
      theirs("m2", "CreedBratton", chris),
      theirs("m3", "Ana"),
    ]);
    const loot = sold({
      payouts: [
        { memberId: "m2", paid: false, paidAt: null, shares: 2 },
        { memberId: "m3", paid: false, paidAt: null, shares: 1 },
      ],
    });
    const expected = splitOf(loot, p.members)!;

    const wallet = buildWallet([p], [pool("pa", [loot])]);
    const carry = wallet.counterparties.find((c) => c.name === "Chris")!;
    const other = wallet.counterparties.find((c) => c.name === "Ana")!;

    // Not "roughly twice": the exact figures the drop's own row shows, or one of the two is a
    // second implementation.
    expect(carry.owe).toBe(expected.shares[0]!.pay);
    expect(other.owe).toBe(expected.shares[1]!.pay);
    expect(carry.owe).toBeGreaterThan(other.owe * 1.99);
    expect(wallet.owe).toBe(carry.owe + other.owe);
  });

  it("folds two seats of one person on one drop, shares and all", () => {
    // A double share on one of their characters and a single on the other is still ONE person to
    // settle with, and the total is the sum rather than either seat's.
    const p = party("pa", [
      mine("m1", "mechyfechy"),
      theirs("m2", "CreedBratton", chris),
      theirs("m3", "CreedBratton2", chris),
    ]);
    const loot = sold({
      payouts: [
        { memberId: "m2", paid: false, paidAt: null, shares: 3 },
        { memberId: "m3", paid: false, paidAt: null, shares: 1 },
      ],
    });
    const expected = splitOf(loot, p.members)!;

    const wallet = buildWallet([p], [pool("pa", [loot])]);
    expect(wallet.counterparties).toHaveLength(1);
    expect(wallet.counterparties[0]!.lines).toHaveLength(2);
    expect(wallet.counterparties[0]!.owe).toBe(expected.shares[0]!.pay + expected.shares[1]!.pay);
    // Both seats are still named, because two transfers is what has to happen. Read off the lines
    // the way sharesOf() does, which is what settles them now that the Wallet page is gone.
    expect(
      wallet.counterparties[0]!.lines.map((l) => ({ lootId: l.lootId, memberId: l.payeeId })),
    ).toEqual([
      { lootId: "l1", memberId: "m2" },
      { lootId: "l1", memberId: "m3" },
    ]);
  });

  it("owes one person twice when two of their characters are in the party", () => {
    // Two seats, one person, one drop: two transfers, not one line drawn twice. Their ids are what
    // keeps them apart, and the pair (drop, seat) is what makes a line unique.
    const p = party("pa", [
      mine("m1", "mechyfechy"),
      theirs("m2", "CreedBratton", chris),
      theirs("m3", "CreedBratton2", chris),
    ]);
    const wallet = buildWallet(
      [p],
      [
        pool("pa", [
          sold({
            payouts: [
              { memberId: "m2", paid: false, paidAt: null, shares: 1 },
              { memberId: "m3", paid: false, paidAt: null, shares: 1 },
            ],
          }),
        ]),
      ],
    );

    const lines = wallet.counterparties[0]!.lines;
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((l) => `${l.lootId}-${l.theirsId}`)).size).toBe(2);
    expect(wallet.owe).toBe(lines[0]!.pay + lines[1]!.pay);
  });

  it("keeps unattributed characters apart, and says they are characters", () => {
    // Merging two names nobody has claimed would be a guess about who plays what.
    const p = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "Rune"), theirs("m3", "Steve")]);
    const wallet = buildWallet(
      [p],
      [
        pool("pa", [
          sold({
            payouts: [
              { memberId: "m2", paid: false, paidAt: null, shares: 1 },
              { memberId: "m3", paid: false, paidAt: null, shares: 1 },
            ],
          }),
        ]),
      ],
    );

    expect(wallet.counterparties).toHaveLength(2);
    expect(wallet.counterparties.every((c) => !c.attributed)).toBe(true);
  });

  it("nets the two directions per counterparty", () => {
    const one = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton", chris)]);
    const two = party("pb", [mine("m3", "mechyfechy"), theirs("m4", "CreedBratton", chris)], {
      bossKey: "kalos",
    });

    const wallet = buildWallet(
      [one, two],
      [
        // You sold one, they sold the other.
        pool("pa", [sold({ saleAmount: 1_000_000_000 })]),
        pool("pb", [
          sold({
            id: "l2",
            saleAmount: 4_000_000_000,
            sellerMemberId: "m4",
            payouts: [{ memberId: "m3", paid: false, paidAt: null, shares: 1 }],
          }),
        ]),
      ],
    );

    const chrisRow = wallet.counterparties[0]!;
    expect(chrisRow.owe).toBeGreaterThan(0);
    expect(chrisRow.owed).toBeGreaterThan(chrisRow.owe);
    expect(chrisRow.net).toBe(chrisRow.owed - chrisRow.owe);
    expect(wallet.net).toBe(wallet.owed - wallet.owe);
  });

  it("leaves out paid shares and drops still in the pool", () => {
    const p = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton", chris)]);
    const wallet = buildWallet(
      [p],
      [
        pool("pa", [
          sold({
            payouts: [{ memberId: "m2", paid: true, paidAt: "2026-07-22T00:00:00Z", shares: 1 }],
          }),
          // Still in the pool: nobody holds the mesos, so nobody owes them.
          sold({
            id: "l2",
            status: "PENDING",
            soldAt: null,
            saleAmount: null,
            amountBasis: null,
            splitMethod: null,
            sellerMemberId: null,
            payouts: [],
          }),
        ]),
      ],
    );

    expect(wallet.counterparties).toHaveLength(0);
    expect(wallet.owe).toBe(0);
    expect(wallet.unreadable).toBe(0);
  });

  it("counts a share between two other people rather than owing it", () => {
    // Your party, their business: you are neither end of this transfer.
    const p = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "Rune"), theirs("m3", "Steve")]);
    const wallet = buildWallet(
      [p],
      [
        pool("pa", [
          sold({
            sellerMemberId: "m2",
            payouts: [
              { memberId: "m1", paid: true, paidAt: "2026-07-22T00:00:00Z", shares: 1 },
              { memberId: "m3", paid: false, paidAt: null, shares: 1 },
            ],
          }),
        ]),
      ],
    );

    expect(wallet.betweenOthers).toBe(1);
    expect(wallet.owe).toBe(0);
    expect(wallet.owed).toBe(0);
  });

  it("counts a share between two of your own characters rather than owing it", () => {
    const p = party("pa", [mine("m1", "mechyfechy"), mine("m2", "mechymule")]);
    const wallet = buildWallet([p], [pool("pa", [sold()])]);

    expect(wallet.betweenMine).toBe(1);
    expect(wallet.counterparties).toHaveLength(0);
  });

  it("counts a split it cannot read instead of dropping it", () => {
    // A sale naming a seat that is gone. The debt is real and its size is not knowable, so the
    // total has to say it is short rather than look complete.
    const p = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton", chris)]);
    const wallet = buildWallet(
      [p],
      [
        pool("pa", [sold({ sellerMemberId: "gone" })]),
        // A pool whose party is missing entirely: no seats, so no split.
        pool("pz", [sold({ id: "l2" })]),
      ],
    );

    expect(wallet.unreadable).toBe(2);
    expect(wallet.owe).toBe(0);
  });

  it("still owes a debt on a retired party, given the config", () => {
    // The reason the wallet asks for ?retired=include. A retired config still holds real drops, so
    // handed one the split reads exactly as it did before the party left Party View. Without it
    // this same pool falls into the unreadable branch above and the debt stops being owed.
    const p = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton", chris)], {
      retired: true,
    });
    const wallet = buildWallet([p], [pool("pa", [sold({ sellerMemberId: "m1" })])]);

    expect(wallet.unreadable).toBe(0);
    expect(wallet.owe).toBeGreaterThan(0);
    expect(wallet.counterparties.map((c) => c.name)).toEqual(["Chris"]);
  });

  it("has nothing to say about an account with no parties", () => {
    const wallet = buildWallet([], []);
    expect(wallet).toEqual({
      counterparties: [],
      owe: 0,
      owed: 0,
      net: 0,
      usd: { owe: 0, owed: 0, net: 0 },
      unreadable: 0,
      betweenOthers: 0,
      betweenMine: 0,
    });
  });

  it("puts the biggest outstanding relationship first, netted or not", () => {
    const big = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "Rune")]);
    const small = party("pb", [mine("m3", "mechyfechy"), theirs("m4", "Steve")], {
      bossKey: "kalos",
    });

    const wallet = buildWallet(
      [big, small],
      [
        pool("pa", [sold({ saleAmount: 9_000_000_000 })]),
        pool("pb", [
          sold({
            id: "l2",
            saleAmount: 1_000_000_000,
            sellerMemberId: "m3",
            payouts: [{ memberId: "m4", paid: false, paidAt: null, shares: 1 }],
          }),
        ]),
      ],
    );

    expect(wallet.counterparties.map((c) => c.name)).toEqual(["Rune", "Steve"]);
  });
});

describe("buildWallet, across a week the roster changed in", () => {
  it("still reads a share owed to somebody who did not run this week", () => {
    // A guest ran last week and is owed for a drop that sold. This week the party is back to
    // normal, so `members` no longer names them. Read against the roster the share would resolve
    // to nobody, splitOf would refuse the whole drop, and a real debt would leave the wallet as
    // "unreadable" with nothing saying whose it was.
    const you = mine("m1", "mechyfechy");
    const guest = theirs("m9", "Cara", chris);
    const p = party("pa", [you], { seats: [you, guest] });
    const loot = sold({ payouts: [{ memberId: "m9", paid: false, paidAt: null, shares: 1 }] });

    const wallet = buildWallet([p], [pool("pa", [loot])]);

    expect(wallet.unreadable).toBe(0);
    expect(wallet.owe).toBe(splitOf(loot, p.seats)!.shares[0]!.pay);
    expect(wallet.counterparties.map((c) => c.name)).toEqual(["Chris"]);
  });
});
