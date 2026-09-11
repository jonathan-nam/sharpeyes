import { describe, expect, it } from "vitest";
import { spriteByName } from "./sprite-by-name";
import type { Character } from "@/types/character";
import type { Party, PartyMember } from "@/types/party";

const seat = (name: string, spriteImgUrl: string | null): PartyMember => ({
  id: `seat-${name}`,
  name,
  personId: null,
  personName: null,
  characterId: null,
  linkedCharacterId: null,
  spriteImgUrl,
  guest: false,
  shares: 1,
});

const config = (id: string, members: PartyMember[]): Party => ({
  id,
  slug: id,
  characterId: "char-1",
  solo: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey: "lotus",
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
  createdAt: "2026-08-09T00:00:00Z",
  updatedAt: "2026-08-09T00:00:00Z",
});

/** One somebody else keeps the book for, which is a party like any other with `yours` false. */
const shared = (id: string, seats: PartyMember[]): Party => ({
  ...config(id, seats),
  yours: false,
});

const character = (name: string, spriteImgUrl: string | null): Character => ({
  id: `char-${name}`,
  name,
  level: 285,
  jobName: "Bishop",
  worldName: "Scania",
  worldType: "INTERACTIVE",
  spriteImgUrl,
  spriteRefreshedAt: null,
  createdAt: "2026-08-09T00:00:00Z",
  updatedAt: "2026-08-09T00:00:00Z",
});

describe("spriteByName", () => {
  it("finds a seat that has since left the party", () => {
    const gone = seat("Lynn", "/sprites/lynn.png");
    const parties = [{ ...config("p1", [seat("Nightwalk", null)]), seats: [gone] }];
    expect(spriteByName([], parties).get("Lynn")).toBe("/sprites/lynn.png");
  });

  it("finds the people you run with, who are only ever seats", () => {
    const parties = [config("p1", [seat("Nightwalk", "/sprites/nw.png")])];
    expect(spriteByName([], parties).get("Nightwalk")).toBe("/sprites/nw.png");
  });

  it("finds your own characters, who may be in no party at all", () => {
    expect(spriteByName([character("mechyfechy", "/sprites/me.png")], []).get("mechyfechy")).toBe(
      "/sprites/me.png",
    );
  });

  it("prefers your roster's sprite to the one a seat was saved with", () => {
    // Your own page is where a sprite gets refreshed, so where the two disagree it is the newer.
    const parties = [config("p1", [seat("mechyfechy", "/sprites/stale.png")])];
    const characters = [character("mechyfechy", "/sprites/fresh.png")];
    expect(spriteByName(characters, parties).get("mechyfechy")).toBe("/sprites/fresh.png");
  });

  it("leaves out a name whose lookup found nothing", () => {
    // Absent, not present-and-null: the caller asks "is there a sprite for this name", and a null
    // sitting in the map answers yes to that.
    const parties = [config("p1", [seat("Ghost", null)])];
    const map = spriteByName([character("Nobody", null)], parties);
    expect(map.has("Ghost")).toBe(false);
    expect(map.has("Nobody")).toBe(false);
  });

  it("finds the faces in a party somebody else owns", () => {
    // An account that joined by a link owns no config, so this is the only list it has.
    expect(spriteByName([], [shared("p1", [seat("Bro", "/sprites/bro.png")])]).get("Bro")).toBe(
      "/sprites/bro.png",
    );
  });

  it("says nothing about a name it has never seen", () => {
    expect(spriteByName([], []).get("Whoever")).toBeUndefined();
  });
});
