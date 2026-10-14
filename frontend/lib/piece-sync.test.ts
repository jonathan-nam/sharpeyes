import { describe, expect, it } from "vitest";
import { gapLine } from "./piece-sync";
import type { PieceSyncGap } from "@/types/piece-sync";

const gap = (reason: PieceSyncGap["reason"]): PieceSyncGap => ({
  characterId: "c1",
  characterName: "Husky",
  bossKey: "kalos-the-guardian",
  bossName: "Kalos the Guardian",
  reason,
});

describe("gapLine", () => {
  it("names the character, the boss and why", () => {
    expect(gapLine(gap("PARTY_LOOT"))).toBe("Husky · Kalos the Guardian: party loot");
    expect(gapLine(gap("NO_DIFFICULTY"))).toBe("Husky · Kalos the Guardian: no difficulty set");
    expect(gapLine(gap("BEFORE_SYNC"))).toBe("Husky · Kalos the Guardian: cleared before sync");
  });
});
