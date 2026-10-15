import { describe, expect, it } from "vitest";

import type { Boss, BossClear } from "@/types/boss";
import type { Character } from "@/types/character";

import { weeklyLeft } from "./bosses-left";

function boss(bossKey: string, reset = "WEEKLY"): Boss {
  return { bossKey, name: bossKey, reset, iconUrl: null, difficulties: [] };
}

function character(id: string): Character {
  return {
    id,
    name: id,
    level: null,
    jobName: null,
    worldName: null,
    worldType: "INTERACTIVE",
    spriteImgUrl: null,
    spriteRefreshedAt: null,
    createdAt: "",
    updatedAt: "",
  };
}

function clear(bossKey: string, cleared: boolean): BossClear {
  return { bossKey, cleared, periodStart: "", capturedAt: "" };
}

const bosses = [boss("lucid"), boss("will"), boss("gloom"), boss("zakum", "DAILY")];

describe("weeklyLeft", () => {
  it("lists the weekly bosses not yet cleared, unseen ones included", () => {
    const [row] = weeklyLeft(bosses, [character("a")], {
      clearsByCharacter: { a: [clear("lucid", true), clear("will", false)] },
      skipsByCharacter: {},
    });
    expect(row!.left.map((b) => b.bossKey)).toEqual(["will", "gloom"]);
    expect(row!.progress).toEqual({ cleared: 1, total: 3 });
  });

  it("leaves skipped bosses out of the count and the list", () => {
    const [row] = weeklyLeft(bosses, [character("a")], {
      clearsByCharacter: {},
      skipsByCharacter: { a: ["will", "gloom"] },
    });
    expect(row!.left.map((b) => b.bossKey)).toEqual(["lucid"]);
    expect(row!.progress).toEqual({ cleared: 0, total: 1 });
  });

  it("keeps a finished character, and drops one with nothing to run", () => {
    const rows = weeklyLeft(bosses, [character("a"), character("b")], {
      clearsByCharacter: { a: [clear("lucid", true)] },
      skipsByCharacter: { a: ["will", "gloom"], b: ["lucid", "will", "gloom"] },
    });
    expect(rows.map((r) => [r.character.id, r.left.length])).toEqual([["a", 0]]);
  });
});
