import { describe, expect, it } from "vitest";
import {
  couponsOf,
  evenStacks,
  formatStacks,
  MAX_STACK_HALVES,
  parseStacks,
  sharesFromStacks,
  stacksAddUp,
  stacksFromShares,
  stacksKey,
  sumOfStacks,
} from "./stacks";

describe("a stack entitlement as typed", () => {
  it("reads whole stacks and halves, in halves", () => {
    expect(parseStacks("2")).toBe(4);
    expect(parseStacks("1.5")).toBe(3);
    expect(parseStacks(".5")).toBe(1);
    expect(parseStacks("2.")).toBe(4);
    // A seat that agreed to take none, which is a real deal and not an empty box.
    expect(parseStacks("0")).toBe(0);
  });

  it("refuses anything finer than a half, and anything that is not a number", () => {
    // A quarter of a stack is not a thing anybody can pick up, so it is refused rather than rounded:
    // the same rule parseQuantity holds to, for the same reason.
    for (const bad of ["1.25", "0.1", "two", "1e2", "-1", "1.5.5", ".", ""]) {
      expect(parseStacks(bad)).toBeNull();
    }
    expect(parseStacks(String(MAX_STACK_HALVES / 2 + 1))).toBeNull();
  });

  it("says a half back the way it was typed", () => {
    expect(formatStacks(3)).toBe("1.5");
    expect(formatStacks(4)).toBe("2");
    expect(formatStacks(1)).toBe("0.5");
    expect(formatStacks(0)).toBe("0");
  });
});

describe("what the boxes have to come to", () => {
  it("holds a deal that is exactly the stacks that fell", () => {
    // Extreme Chosen Seren: 6 stacks, four to you and two to them.
    expect(stacksAddUp([8, 4], 6)).toBe(true);
    // A duo on three stacks, which is the commonest night and the one a ratio could say.
    expect(stacksAddUp([3, 3], 3)).toBe(true);
  });

  it("refuses over-subscription, which is the deal a ratio could not say at all", () => {
    // Two each on a boss that drops three. It went in as 1:1 and entitled everybody to 1.5.
    expect(stacksAddUp([4, 4], 3)).toBe(false);
    // And under: stacks nobody is entitled to are stacks the ledger cannot say who owes.
    expect(stacksAddUp([2, 2], 3)).toBe(false);
  });

  it("adds the readable boxes up, in halves", () => {
    expect(sumOfStacks([8, 4])).toBe(12);
    expect(sumOfStacks([8, null])).toBe(8);
  });
});

describe("the ratio that gets stored, and the stacks that come back", () => {
  it("stores lowest terms, so the money side reads as a human would write it", () => {
    // 4 stacks against 2 is "2 shares" on an item's payout row, not "8".
    expect(sharesFromStacks([8, 4])).toEqual([2, 1]);
    expect(sharesFromStacks([3, 3])).toEqual([1, 1]);
    expect(sharesFromStacks([4, 2, 2])).toEqual([2, 1, 1]);
    // Already lowest, and a zero seat does not drag the divisor to itself.
    expect(sharesFromStacks([2, 1])).toEqual([2, 1]);
    expect(sharesFromStacks([6, 0])).toEqual([1, 0]);
  });

  it("round-trips every deal that adds up, which is the only kind that saves", () => {
    for (const [halves, bundles] of [
      [[8, 4], 6],
      [[3, 3], 3],
      [[6, 6], 6],
      [[4, 2, 2], 4],
      [[6, 0], 3],
    ] as [number[], number][]) {
      expect(stacksAddUp(halves, bundles)).toBe(true);
      expect(stacksFromShares(sharesFromStacks(halves), bundles)).toEqual(halves);
    }
  });

  it("says nothing rather than rounding a share that lands off a half-stack", () => {
    // A third of three stacks is one each, which is fine. A third of two is not: two thirds of a
    // stack is not something anybody picked up, so the boxes cannot be filled from it.
    expect(stacksFromShares([1, 1, 1], 3)).toEqual([2, 2, 2]);
    expect(stacksFromShares([1, 1, 1], 2)).toBeNull();
    expect(stacksFromShares([0, 0], 3)).toBeNull();
  });
});

describe("where an unanswered config starts", () => {
  it("opens on the even split when the stacks allow one", () => {
    expect(evenStacks(6, 2)).toEqual([6, 6]);
    expect(evenStacks(6, 3)).toEqual([4, 4, 4]);
    // Three stacks between two: 1.5 each, which is what halves are for.
    expect(evenStacks(3, 2)).toEqual([3, 3]);
  });

  it("gives the remainder to the earliest seats rather than refusing to open", () => {
    // It always adds up, which is what makes it a starting point somebody can just save.
    const halves = evenStacks(3, 4);
    expect(sumOfStacks(halves)).toBe(6);
    expect(halves).toEqual([2, 2, 1, 1]);
  });
});

describe("the coupons a box comes to", () => {
  it("converts through the stack size, which is what the ledger states debts in", () => {
    // Extreme Kalos: 180 in 6 stacks of 30. Four stacks is 120.
    expect(couponsOf(8, 180, 6)).toBe(120);
    // Hard Baldrix: 120 in 3 stacks of 40, so 1.5 stacks is 60.
    expect(couponsOf(3, 120, 3)).toBe(60);
  });
});

describe("telling an edited deal from a saved one", () => {
  it("keeps every box, because a stack count has no neutral value", () => {
    // sharesKey dropped a box reading "1", since a blank ratio meant one share. Doing that here would
    // call an edited deal unedited.
    expect(stacksKey({ You: "1", Brock: "2" })).toBe("Brock=2,You=1");
    expect(stacksKey({ You: "1", Brock: "2" })).not.toBe(stacksKey({ You: "2", Brock: "1" }));
    expect(stacksKey({ You: " 1.5 " })).toBe("You=1.5");
  });
});
