import { describe, expect, it } from "vitest";
import { buildDropLog } from "./drop-log";
import { splitOf } from "./loot";
import { buildSettledLog } from "./settled-log";
import { fromYourSide, sharedHistory } from "./shared-history";
import { SELF_HOLDER, closedByHolder, holderKey } from "./vestige-ledger";
import type { Loot } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";
import type { SharedBook } from "@/types/page";

// Mechy owns the party and Creed (Bro, `p-bro` in Mechy's book) sits in it. Read from Bro's side.

const seat = (over: Partial<PartyMember>): PartyMember => ({
  id: "m1",
  name: "mechyfechy",
  personId: null,
  personName: null,
  characterId: null,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
  ...over,
});

const ownerSeat = seat({ id: "m1", name: "mechyfechy", characterId: "char-mech" });
const broSeat = seat({
  id: "m2",
  name: "CreedBratton",
  personId: "p-bro",
  personName: "Bro",
  linkedCharacterId: "char-creed",
});

const party: Party = {
  id: "pa",
  slug: "mechyfechy/limbo",
  characterId: "char-mech",
  solo: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey: "limbo",
  difficulty: null,
  minutes: null,
  members: [ownerSeat, broSeat],
  seats: [ownerSeat, broSeat],
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

// Mechy sold it and owes Bro half.
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
  ownerName: "Mech",
  personId: "p-bro",
  ownerPersonId: "bro-p-mech",
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

    expect(flipped!.characterId).toBe("char-creed");
    expect(flipped!.seats.map((m) => [m.name, m.characterId, m.personId])).toEqual([
      ["mechyfechy", null, "bro-p-mech"],
      ["CreedBratton", "char-creed", null],
    ]);
  });

  it("logs the drop with your share as yours, not the seller's", () => {
    const side = fromYourSide(book());
    const [entry] = buildDropLog(side.parties, side.pools, {}).entries;

    expect(entry!.characterId).toBe("char-creed");
    expect(entry!.sellerName).toBe("mechyfechy");
    const share = splitOf(sold, party.seats)!.shares.find((s) => s.memberId === "m2")!;
    expect(entry!.yourTake).toBe(share.nets);
    expect(entry!.yourTake).not.toBe(entry!.pooled! - share.nets);
    expect(entry!.ranWith).toEqual(["mechyfechy"]);
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
            holder: { kind: "PERSON", personId: "p-bro", characterName: null },
            lootIds: ["l1"],
            unpaid: 0,
            settledAt: "2026-07-23",
          },
        ],
      }),
    );

    expect(side.settlements.map((s) => holderKey(s.holder))).toEqual(["person:bro-p-mech", "self"]);
    expect([...closedByHolder(side.settlements).closed]).toEqual([
      "person:bro-p-mech|l1",
      "self|l1",
    ]);
    expect(side.names.get("person:bro-p-mech")).toBe("Mech");
  });

  it("keeps the owner one pile when you never added them as a person", () => {
    const [flipped] = fromYourSide(book({ ownerPersonId: null })).parties;

    expect(flipped!.seats[0]!.personId).toBe("owner-of:p-bro");
  });

  it("adds nothing when nobody shares a book with you", () => {
    expect(sharedHistory([]).parties).toEqual([]);
  });
});
