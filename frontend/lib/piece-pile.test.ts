import { describe, expect, it } from "vitest";
import { draftPile, parseCount, pileProblem } from "./piece-pile";
import type { Party, PartyMember } from "@/types/party";

const seat = (id: string, pieceShares?: number): PartyMember =>
  ({ id, name: id, pieceShares }) as PartyMember;

describe("draftPile", () => {
  const star = {
    difficulty: "HARD",
    world: "INTERACTIVE",
    tokenName: "Blissful Fantasy Shard",
    iconUrl: null,
    quantity: 18,
    stackSize: 3,
    pooled: true,
  };

  it("divides the config's pile by the piece ratio, in whole stacks", () => {
    const party = { members: [seat("me", 2), seat("a"), seat("b")] } as Party;
    // 6 stacks over 2:1:1 is 3, 1.5, 1.5: 3, 2, 1 stacks, the tie to the earlier seat.
    expect(draftPile(party, star)).toEqual({ total: 18, takes: { me: 9, a: 6, b: 3 } });
  });

  it("reads a seat with no ratio, from a cached party, as taking one", () => {
    const party = { members: [seat("me"), seat("a")] } as Party;
    expect(draftPile(party, star).takes).toEqual({ me: 9, a: 9 });
  });
});

describe("pileProblem", () => {
  it("passes takes that add up in whole stacks", () => {
    expect(pileProblem(14, [10, 4, 0], 1)).toBeNull();
    expect(pileProblem(18, [9, 9], 3)).toBeNull();
  });

  it("refuses a split stack, a wrong sum, or a box that is not a number", () => {
    expect(pileProblem(18, [10, 8], 3)).toBe("Stacks of 3.");
    expect(pileProblem(14, [10, 3], 1)).toBe("These come to 13 of 14.");
    expect(pileProblem(14, [null, 14], 1)).toBe("Whole numbers only.");
    expect(pileProblem(null, [14], 1)).toBe("Whole numbers only.");
  });
});

describe("parseCount", () => {
  it("reads whole non-negative numbers only", () => {
    expect(parseCount("7")).toBe(7);
    expect(parseCount("0")).toBe(0);
    expect(parseCount("")).toBeNull();
    expect(parseCount("2.5")).toBeNull();
    expect(parseCount("-1")).toBeNull();
  });
});
