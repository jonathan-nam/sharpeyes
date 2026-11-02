import { describe, expect, it } from "vitest";
import { buildDropLog } from "./drop-log";
import { splitOf } from "./loot";
import { buildSettledLog } from "./settled-log";
import { crossingShares, fromYourSide, sharedHistory } from "./shared-history";
import { buildWallet } from "./wallet";
import { SELF_HOLDER, closedByHolder, holderKey } from "./vestige-ledger";
import type { Loot } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";
import type { SharedBook } from "@/types/page";

// Tide owns the party and Pine (Owen, `p-owen` in Tide's book) sits in it. Read from Owen's side.

const seat = (over: Partial<PartyMember>): PartyMember => ({
  id: "m1",
  name: "tidelark",
  personId: null,
  personName: null,
  characterId: null,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
  ...over,
});

const ownerSeat = seat({ id: "m1", name: "tidelark", characterId: "char-kip" });
const owenSeat = seat({
  id: "m2",
  name: "Pinewick",
  personId: "p-owen",
  personName: "Owen",
  linkedCharacterId: "char-pine",
});

const party: Party = {
  id: "pa",
  slug: "tidelark/limbo",
  characterId: "char-kip",
  solo: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey: "limbo",
  difficulty: null,
  minutes: null,
  members: [ownerSeat, owenSeat],
  seats: [ownerSeat, owenSeat],
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
};

// Tide sold it and owes Owen half.
const sold: Loot = {
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
  saleAmount: 10_000_000_000,
  amountBasis: "RECEIVED",
  splitMethod: "FAIR",
  sellerShares: 1,
  sellerMemberId: "m1",
  takenByMemberId: null,
  soldAt: "2026-07-21T10:00:00Z",
  payouts: [{ memberId: "m2", paid: true, paidAt: "2026-07-22T10:00:00Z", shares: 1 }],
  ranThatWeek: [],
  bundles: null,
  bundlesBy: [],
};

const book = (over: Partial<SharedBook> = {}): SharedBook => ({
  ownerName: "Kip",
  personId: "p-owen",
  ownerPersonId: "owen-p-kip",
  parties: [party],
  pools: [{ partyId: "pa", loot: [sold] }],
  tranches: [],
  payments: [],
  settlements: [],
  debts: [],
  disposals: [],
  ...over,
});

describe("somebody else's book from your side", () => {
  it("files their party under your character, with your seat yours and theirs a person", () => {
    const [flipped] = fromYourSide(book()).parties;

    expect(flipped!.characterId).toBe("char-pine");
    expect(flipped!.seats.map((m) => [m.name, m.characterId, m.personId])).toEqual([
      ["tidelark", null, "owen-p-kip"],
      ["Pinewick", "char-pine", null],
    ]);
  });

  it("logs the drop with your share as yours, not the seller's", () => {
    const side = fromYourSide(book());
    const [entry] = buildDropLog(side.parties, side.pools, {}).entries;

    expect(entry!.characterId).toBe("char-pine");
    expect(entry!.sellerName).toBe("tidelark");
    const share = splitOf(sold, party.seats)!.shares.find((s) => s.memberId === "m2")!;
    expect(entry!.yourTake).toBe(share.nets);
    expect(entry!.yourTake).not.toBe(entry!.pooled! - share.nets);
    expect(entry!.ranWith).toEqual(["tidelark"]);
  });

  it("is in your settled record once their payout to you is marked", () => {
    const side = fromYourSide(book());
    const log = buildDropLog(side.parties, side.pools, {});

    expect(buildSettledLog(log.entries).map((r) => r.lootId)).toEqual(["l1"]);
  });

  it("swaps the two of you on a settlement, so its closure is keyed from your side", () => {
    const side = fromYourSide(
      book({
        settlements: [
          { id: "s1", holder: SELF_HOLDER, lootIds: ["l1"], unpaid: 0, settledAt: "2026-07-23" },
          {
            id: "s2",
            holder: { kind: "PERSON", personId: "p-owen", characterName: null },
            lootIds: ["l1"],
            unpaid: 0,
            settledAt: "2026-07-23",
          },
        ],
      }),
    );

    expect(side.settlements.map((s) => holderKey(s.holder))).toEqual(["person:owen-p-kip", "self"]);
    expect([...closedByHolder(side.settlements).closed]).toEqual([
      "person:owen-p-kip|l1",
      "self|l1",
    ]);
    expect(side.names.get("person:owen-p-kip")).toBe("Kip");
  });

  it("keeps the owner one pile when you never added them as a person", () => {
    const [flipped] = fromYourSide(book({ ownerPersonId: null })).parties;

    expect(flipped!.seats[0]!.personId).toBe("owner-of:p-owen");
  });

  it("adds nothing when nobody shares a book with you", () => {
    expect(sharedHistory([]).parties).toEqual([]);
  });
});

describe("shares in their party between you and a third person", () => {
  // Owen sold in Kip's party and owes Thornwick's seat, which Kip's book files under Kip's own person
  // row for him. Neither owner's book carries it, so Owen's own book must.
  const thornSeat = seat({
    id: "m3",
    name: "Thornwick",
    personId: "kip-p-thorn",
    personName: "Thorn",
  });
  const three = {
    ...party,
    members: [ownerSeat, owenSeat, thornSeat],
    seats: [ownerSeat, owenSeat, thornSeat],
  };
  const owenSold: Loot = {
    ...sold,
    sellerMemberId: "m2",
    payouts: [
      { memberId: "m1", paid: false, paidAt: null, shares: 1 },
      { memberId: "m3", paid: false, paidAt: null, shares: 1 },
    ],
  };
  const shared = sharedHistory([
    book({ parties: [three], pools: [{ partyId: "pa", loot: [owenSold] }] }),
  ]);
  const people = [
    {
      id: "owen-p-thorn",
      name: "Thorn",
      characters: ["thornwick"],
      ownedCharacters: [],
      linked: false,
      pinned: false,
    },
  ];

  it("keys their seat to your own person by character name, and leaves the owner's pair out", () => {
    const crossing = crossingShares(shared, people);
    const wallet = buildWallet(crossing.parties, crossing.pools).counterparties.filter(
      (c) => !crossing.skip.has(c.key),
    );

    expect(wallet.map((c) => [c.key, c.lines.map((l) => [l.direction, l.theirs])])).toEqual([
      ["person:owen-p-thorn", [["owe", "Thornwick"]]],
    ]);
  });

  it("stands as a character when you have no person for them", () => {
    const crossing = crossingShares(shared, []);
    const keys = buildWallet(crossing.parties, crossing.pools)
      .counterparties.map((c) => c.key)
      .filter((k) => !crossing.skip.has(k));

    expect(keys).toEqual(["character:thornwick"]);
  });
});
