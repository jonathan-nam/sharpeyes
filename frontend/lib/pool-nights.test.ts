import { describe, expect, it } from "vitest";
import { nightLabel, poolNights, ranAtThisMode } from "./pool-nights";
import type { Loot } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

/**
 * The pool as the nights it was logged on.
 *
 * The claim worth a test: a config is ONE row per (character, boss) and a one-off takes it over
 * rather than making a second, so a pool spans arrangements. Reported 2026-08-30 as 540 Extreme
 * coupons sitting under a heading reading "Chaos Kalos the Guardian with iPhone69C", on nights three
 * people who had since left the party ran.
 */

const seat = (id: string, name: string, mine = false): PartyMember => ({
  id,
  name,
  personId: null,
  personName: null,
  characterId: mine ? `char-${id}` : null,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const party = (members: PartyMember[], difficulty: string | null): Party => ({
  id: "pa",
  slug: "pa",
  characterId: members[0]!.characterId ?? "char-m1",
  solo: false,
  oneOff: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey: "kalos-the-guardian",
  difficulty,
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

const drop = (id: string, weekStart: string, over: Partial<Loot> = {}): Loot => ({
  id,
  dropKey: "vestige-of-erion",
  customName: null,
  name: "Vestige of Erion Coupon",
  iconUrl: null,
  perMember: null,
  bossKey: "kalos-the-guardian",
  quantity: 180,
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

const me = seat("m1", "acornacorn", true);
const sas = seat("m2", "SAS7S1");
const usuns = seat("m3", "USunsOfBaech");
const phone = seat("m4", "iPhone69C");

describe("poolNights", () => {
  it("splits a pool into the weeks it was logged on, newest first", () => {
    const at = party([me, phone], "CHAOS");
    const nights = poolNights(
      [
        drop("l3", "2026-08-27", { difficulty: "CHAOS", ranThatWeek: ["m1", "m4"] }),
        drop("l2", "2026-08-20", { difficulty: "EXTREME", ranThatWeek: ["m1", "m3"] }),
        drop("l1", "2026-08-13", { difficulty: "EXTREME", ranThatWeek: ["m1", "m2"] }),
      ],
      at,
    );

    expect(nights.map((n) => n.weekStart)).toEqual(["2026-08-27", "2026-08-20", "2026-08-13"]);
    expect(nights.map((n) => n.difficulty)).toEqual(["CHAOS", "EXTREME", "EXTREME"]);
  });

  it("keeps a night's rows together whatever else fell that week", () => {
    const at = party([me, phone], "CHAOS");
    const nights = poolNights(
      [
        drop("coupons", "2026-08-20", { difficulty: "EXTREME" }),
        drop("hammer", "2026-08-20", { name: "Grindstone of Life", quantity: 1 }),
      ],
      at,
    );

    expect(nights).toHaveLength(1);
    expect(nights[0]!.loot.map((l) => l.id)).toEqual(["coupons", "hammer"]);
    // The hammer says nothing about the mode, so the night takes the one row that does. A drop with
    // no amount in the tables never carries a mode, and most nights hold one.
    expect(nights[0]!.difficulty).toBe("EXTREME");
  });

  it("refuses to name a mode when the night's rows disagree", () => {
    const at = party([me], "CHAOS");
    const nights = poolNights(
      [
        drop("a", "2026-08-20", { difficulty: "EXTREME" }),
        drop("b", "2026-08-20", { difficulty: "HARD" }),
      ],
      at,
    );

    // Two modes cannot both be right and picking one would be the guess this exists to refuse.
    // A boss is cleared once a period, so this is corrupt rather than merely unknown either way.
    expect(nights[0]!.difficulty).toBeNull();
  });

  it("names who ran the night, not who is in the party now", () => {
    const at = party([me, phone], "CHAOS");
    const nights = poolNights(
      [drop("l1", "2026-08-13", { difficulty: "EXTREME", ranThatWeek: ["m1", "m2", "m3"] })],
      party([me, phone, sas, usuns], "CHAOS"),
    );

    expect(nights[0]!.members.map((m) => m.name)).toEqual(["acornacorn", "SAS7S1", "USunsOfBaech"]);
    // The party as it stands tonight has iPhone69C in it, and that night did not.
    expect(nights[0]!.members.map((m) => m.name)).not.toContain("iPhone69C");
    expect(at.members.map((m) => m.name)).toContain("iPhone69C");
  });
});

describe("nightLabel", () => {
  const at = party([me, phone, sas, usuns], "CHAOS");

  it("says when, at what mode, and with whom", () => {
    const [night] = poolNights(
      [drop("l1", "2026-08-13", { difficulty: "EXTREME", ranThatWeek: ["m1", "m2", "m3"] })],
      at,
    );

    // Your own character is left out, the same rule the page heading follows.
    expect(nightLabel(night!, at)).toBe("August 13 · Extreme · SAS7S1, USunsOfBaech");
  });

  it("leaves out a silence rather than spelling it", () => {
    const [unsaid] = poolNights([drop("l1", "2026-08-13", { ranThatWeek: ["m1", "m2"] })], at);
    expect(nightLabel(unsaid!, at)).toBe("August 13 · SAS7S1");

    const alone = poolNights(
      [drop("l1", "2026-08-13", { difficulty: "HARD", ranThatWeek: ["m1"] })],
      at,
    );
    expect(nightLabel(alone[0]!, at)).toBe("August 13 · Hard");
  });
});

describe("ranAtThisMode", () => {
  const tonight = party([me, phone], "CHAOS");
  const night = (over: Partial<Loot>) => poolNights([drop("l1", "2026-08-13", over)], tonight)[0]!;

  it("keeps a night run at this mode", () => {
    expect(ranAtThisMode(night({ difficulty: "CHAOS", ranThatWeek: ["m1", "m4"] }), tonight)).toBe(
      true,
    );
  });

  it("drops a night run at another mode", () => {
    // The reported case, both ways round. Chaos Kalos drops no vestige at all, so an Extreme
    // night's coupons under this page's heading were 540 of something this config cannot produce.
    expect(ranAtThisMode(night({ difficulty: "EXTREME" }), tonight)).toBe(false);
    expect(ranAtThisMode(night({ difficulty: "EXTREME" }), party([me, phone], "EXTREME"))).toBe(
      true,
    );
    expect(ranAtThisMode(night({ difficulty: "CHAOS" }), party([me, phone], "EXTREME"))).toBe(
      false,
    );
  });

  it("keeps a night run at this mode with different people", () => {
    // Deliberately NOT filtered on the roster. Somebody missing a week is the ordinary case, and it
    // is already answered without hiding a thing: the night is headed with who ran it, and ranSeats
    // divides the drop by them. Hiding it would fragment a pool over an absence.
    expect(
      ranAtThisMode(night({ difficulty: "CHAOS", ranThatWeek: ["m1", "m2", "m3"] }), tonight),
    ).toBe(true);
    expect(ranAtThisMode(night({ difficulty: "CHAOS", ranThatWeek: ["m1"] }), tonight)).toBe(true);
  });

  it("keeps a night that never recorded a mode", () => {
    // Every drop logged before V69 carries none, tonight's armour box included where it was logged
    // first. A silence contradicts nothing, and reading it as a mismatch would hide the very night
    // the page is about.
    expect(ranAtThisMode(night({ ranThatWeek: ["m1", "m4"] }), tonight)).toBe(true);
    // Including on a config that has no mode of its own to compare against.
    expect(ranAtThisMode(night({}), party([me, phone], null))).toBe(true);
  });
});
