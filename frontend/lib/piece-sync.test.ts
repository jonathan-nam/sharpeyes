import { describe, expect, it } from "vitest";
import { gapLine, shownGaps } from "./piece-sync";
import type { PieceSyncGap } from "@/types/piece-sync";

const gap = (reason: string): PieceSyncGap => ({
  characterId: "c1",
  characterName: "Husky",
  bossKey: "kalos-the-guardian",
  bossName: "Kalos the Guardian",
  reason: reason as PieceSyncGap["reason"],
});

describe("gapLine", () => {
  it("names the character, the boss and why", () => {
    expect(gapLine(gap("NO_DIFFICULTY"))).toBe("Husky · Kalos the Guardian: no difficulty set");
    expect(gapLine(gap("PARTY_OFF"))).toBe("Husky · Kalos the Guardian: party off this week");
  });
});

describe("shownGaps", () => {
  it("drops a reason this build no longer draws, as a cached response can carry", () => {
    const kept = gap("PARTY_OFF");
    expect(shownGaps([gap("BEFORE_SYNC"), kept, gap("PARTY_LOOT")])).toEqual([kept]);
  });
});
