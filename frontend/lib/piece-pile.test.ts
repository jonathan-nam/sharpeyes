import { describe, expect, it } from "vitest";
import { parseCount, pileProblem } from "./piece-pile";

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
