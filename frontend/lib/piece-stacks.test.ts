import { describe, expect, it } from "vitest";
import {
  parseWholeStacks,
  pooledPieceAt,
  sharesFromWholeStacks,
  splitStacks,
} from "./piece-stacks";
import type { Boss } from "@/types/boss";

describe("splitStacks", () => {
  // The same cases PiecePileTest pins on the backend, so the config opens on what the clear files.
  it("divides by the ratio in whole stacks, the remainder to the earlier seat", () => {
    expect(splitStacks(14, [1, 1])).toEqual([7, 7]);
    expect(splitStacks(14, [2, 1, 1])).toEqual([7, 4, 3]);
    expect(splitStacks(7, [2, 1, 1])).toEqual([3, 2, 2]);
    expect(splitStacks(6, [1, 1, 1, 1])).toEqual([2, 2, 1, 1]);
    expect(splitStacks(5, [0, 1])).toEqual([0, 5]);
    expect(splitStacks(5, [0, 0])).toEqual([3, 2]);
  });

  it("always adds back up to what fell", () => {
    for (let stacks = 0; stacks <= 18; stacks++) {
      for (const w of [[1, 2, 3], [5, 0, 1, 1], [1], [3, 3, 3, 3, 3, 3]]) {
        expect(splitStacks(stacks, w).reduce((a, b) => a + b, 0)).toBe(stacks);
      }
    }
  });
});

describe("sharesFromWholeStacks", () => {
  it("stores the boxes as a ratio in lowest terms", () => {
    expect(sharesFromWholeStacks([6, 4, 4])).toEqual([3, 2, 2]);
    expect(sharesFromWholeStacks([0, 5])).toEqual([0, 1]);
    expect(sharesFromWholeStacks([0, 0])).toBeNull();
  });

  it("round-trips through the split at the same pile", () => {
    const boxes = [5, 3, 3, 3];
    expect(splitStacks(14, sharesFromWholeStacks(boxes)!)).toEqual(boxes);
  });
});

describe("parseWholeStacks", () => {
  it("takes whole numbers only", () => {
    expect(parseWholeStacks("3")).toBe(3);
    expect(parseWholeStacks(" 0 ")).toBe(0);
    expect(parseWholeStacks("1.5")).toBeNull();
    expect(parseWholeStacks("")).toBeNull();
    expect(parseWholeStacks("-1")).toBeNull();
  });
});

describe("pooledPieceAt", () => {
  const kalos = {
    bossKey: "kalos-the-guardian",
    name: "Kalos the Guardian",
    reset: "WEEKLY",
    iconUrl: null,
    difficulties: ["EASY", "NORMAL", "CHAOS", "EXTREME"],
    pieces: [
      {
        difficulty: "EXTREME",
        world: "INTERACTIVE",
        tokenName: "K",
        iconUrl: null,
        quantity: 14,
        stackSize: 1,
        pooled: true,
      },
      {
        difficulty: "EXTREME",
        world: "HEROIC",
        tokenName: "K",
        iconUrl: null,
        quantity: 3,
        stackSize: 1,
        pooled: false,
      },
      {
        difficulty: "EASY",
        world: "INTERACTIVE",
        tokenName: "K",
        iconUrl: null,
        quantity: 0,
        stackSize: 1,
        pooled: true,
      },
    ],
  } satisfies Boss;

  it("finds the Interactive pile and nothing in Heroic, or at a mode that drops none", () => {
    expect(pooledPieceAt(kalos, "EXTREME", "INTERACTIVE")?.quantity).toBe(14);
    expect(pooledPieceAt(kalos, "EXTREME", "HEROIC")).toBeUndefined();
    expect(pooledPieceAt(kalos, "EASY", "INTERACTIVE")).toBeUndefined();
  });

  it("reads a cached boss with no pieces as having none", () => {
    const cached: Boss = { ...kalos, pieces: undefined };
    expect(pooledPieceAt(cached, "EXTREME", "INTERACTIVE")).toBeUndefined();
  });
});
