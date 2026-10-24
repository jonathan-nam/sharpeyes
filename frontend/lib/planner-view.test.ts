import { describe, expect, it } from "vitest";
import type { PlannedParty } from "@/lib/party-planner";
import { byBoss, byCharacter } from "@/lib/planner-view";

// Invented names: see CLAUDE.md, "No PII or real IGNs".
const party = (bossKey: string, difficulty: string, ...names: string[]): PlannedParty => ({
  world: null,
  bossKey,
  difficulty,
  minutes: 30,
  seats: names.map((character) => ({
    wantId: `${character}|${bossKey}`,
    character,
    personId: character,
    shares: 1,
  })),
});

const kaling = party("kaling", "HARD", "Thornwick", "Pellmoor");
const limbo = party("limbo", "NORMAL", "Thornwick");
const limboHard = party("limbo", "HARD", "Quillsby");
const bosses = [
  { bossKey: "kaling", difficulties: ["EASY", "NORMAL", "HARD", "EXTREME"] },
  { bossKey: "limbo", difficulties: ["NORMAL", "HARD"] },
];

describe("the plan by character", () => {
  it("lists each party under every character in it, in the order given", () => {
    const groups = byCharacter([kaling, limbo, limboHard], ["Pellmoor", "Thornwick", "Ravensoot"]);
    expect(groups.map((g) => [g.key, g.parties.length])).toEqual([
      ["Pellmoor", 1],
      ["Thornwick", 2],
    ]);
  });
});

describe("the plan by boss", () => {
  it("groups by boss and mode, in catalog order", () => {
    const groups = byBoss([limboHard, limbo, kaling], bosses);
    expect(groups.map((g) => g.key)).toEqual(["kaling|HARD", "limbo|NORMAL", "limbo|HARD"]);
  });
});
