import { describe, expect, it } from "vitest";
import { seatSpriteUrls } from "./seat-sprites";
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

describe("seatSpriteUrls", () => {
  it("names one URL for a character sitting in several parties", () => {
    const parties = [
      config("a", [seat("Mine", "/mine.png"), seat("Kip", "/kip.png")]),
      config("b", [seat("Mine", "/mine.png"), seat("Kip", "/kip.png")]),
    ];
    expect(seatSpriteUrls(parties)).toEqual(["/mine.png", "/kip.png"]);
  });

  it("skips the seats whose lookup found nothing, rather than warming a null", () => {
    const parties = [config("a", [seat("Mine", "/mine.png"), seat("Unknown", null)])];
    expect(seatSpriteUrls(parties)).toEqual(["/mine.png"]);
  });

  it("is empty for an empty list, so the caller warms nothing before the fetch lands", () => {
    expect(seatSpriteUrls([])).toEqual([]);
  });
});
