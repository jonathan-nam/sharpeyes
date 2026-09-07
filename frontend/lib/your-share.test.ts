import { describe, expect, it } from "vitest";
import { splitOf } from "./loot";
import { yourShare } from "./shared-parties";
import type { Loot } from "@/types/loot";
import type { PartyMember, SeatedParty } from "@/types/party";

// What a party MEMBER is owed for a night, read off the same split their owner sees. The claim
// worth testing is not the arithmetic, which is splitDrop's and tested there, but that the member
// is handed splitDrop's answer rather than a second one computed for them.

const seat = (id: string, name: string): PartyMember => ({
  id,
  name,
  personId: null,
  personName: null,
  characterId: null,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const seats = [seat("m1", "Rune"), seat("m2", "Steve"), seat("m3", "Bob")];

const party = (mySeatIds: string[]): SeatedParty => ({
  id: "pa-1",
  bossKey: "limbo",
  difficulty: null,
  minutes: null,
  seats,
  mySeatIds,
  nights: [],
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
  payouts: [
    { memberId: "m2", paid: false, paidAt: null, shares: 1 },
    { memberId: "m3", paid: true, paidAt: "2026-07-21T11:00:00Z", shares: 1 },
  ],
  ranThatWeek: [],
  bundles: null,
  bundlesBy: [],
  ...over,
});

describe("yourShare", () => {
  // The one that matters. A member reading what they are owed and an owner reading what they owe
  // must not be able to reach different figures, so this is splitOf's number and not another.
  it("is exactly what the owner's own split says for that seat", () => {
    const split = splitOf(sold(), seats)!;
    const theirs = split.shares.find((s) => s.memberId === "m2")!;
    expect(yourShare(sold(), party(["m2"]))).toEqual({
      nets: theirs.nets,
      paid: false,
      currency: "MESO",
    });
  });

  it("carries the paid flag from your own payout row", () => {
    expect(yourShare(sold(), party(["m3"]))?.paid).toBe(true);
  });

  // The looter sells in an Interactive party, and the looter can be the member. They are not paid,
  // they are the one paying out, so what they hold is what they kept.
  it("gives the seller what they keep, already in hand", () => {
    const split = splitOf(sold(), seats)!;
    expect(yourShare(sold(), party(["m1"]))).toEqual({
      nets: split.seller.keeps,
      paid: true,
      currency: "MESO",
    });
  });

  it("says nothing about a drop still in the pool", () => {
    const pending = sold({ saleAmount: null, sellerMemberId: null, status: "PENDING" });
    expect(yourShare(pending, party(["m2"]))).toBeNull();
  });

  // splitOf refuses a basis this build cannot read rather than guessing at the fee, and a member
  // must inherit that refusal: a figure that looks ordinary and is wrong is worse than none.
  it("says nothing when the split itself refuses to answer", () => {
    expect(yourShare(sold({ amountBasis: "AUCTIONED" }), party(["m2"]))).toBeNull();
  });

  it("says nothing when none of the seats are yours", () => {
    expect(yourShare(sold(), party([]))).toBeNull();
  });
});
