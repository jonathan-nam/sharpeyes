import { describe, expect, it } from "vitest";
import {
  type ShareConfig,
  parseStacks,
  piecesPerWeek,
  shareConfig,
  sharesFromStacks,
  stacksLabel,
  stacksPerWeek,
} from "./vestige-stacks";
import type { BossDrop } from "@/types/drop";
import type { PartyMember } from "@/types/party";

const VESTIGE = "vestige-of-erion";

const seat = (id: string, name: string, shares = 1): PartyMember => ({
  id,
  name,
  personId: null,
  personName: null,
  characterId: null,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares,
});

/** Hard Limbo: 180 coupons in 3 stacks of 60. */
const table = (over: Partial<BossDrop> = {}): BossDrop[] => [
  {
    dropKey: VESTIGE,
    name: "Vestige of Erion Coupon",
    iconUrl: null,
    perMember: null,
    worlds: "INTERACTIVE",
    quantity: 1,
    fungible: false,
    pieces: { INTERACTIVE: { HARD: 180 } },
    bundles: { INTERACTIVE: { HARD: 3 } },
    ...over,
  },
];

const config = (seats: PartyMember[]): ShareConfig =>
  shareConfig(table(), "HARD", "INTERACTIVE", VESTIGE, seats)!;

describe("what there is to split", () => {
  it("reads the boss's own table, so the split exists before the coupons do", () => {
    const found = config([seat("m1", "Husky"), seat("m2", "Rune")]);
    expect(found.quantity).toBe(180);
    expect(found.bundles).toBe(3);
    expect(found.size).toBe(60);
  });

  it("has nothing to split without a mode, a stack count, or two sides", () => {
    const two = [seat("m1", "Husky"), seat("m2", "Rune")];
    // Nobody has said which difficulty, so what drops is not known.
    expect(shareConfig(table(), null, "INTERACTIVE", VESTIGE, two)).toBeNull();
    // The catalog has not counted the stacks, which is not a claim that it falls in one.
    expect(shareConfig(table({ bundles: {} }), "HARD", "INTERACTIVE", VESTIGE, two)).toBeNull();
    // A boss that drops none at this mode.
    expect(shareConfig(table(), "NORMAL", "INTERACTIVE", VESTIGE, two)).toBeNull();
    // One seat is not a split.
    expect(shareConfig(table(), "HARD", "INTERACTIVE", VESTIGE, [seat("m1", "Husky")])).toBeNull();
  });
});

describe("what each share comes to", () => {
  it("says a half where a week cannot divide, which is the whole point", () => {
    // A duo on even shares splitting three stacks. No single week hands out 1.5, and every
    // fortnight does: the odd stack rotates, and this is that arrangement said as one figure.
    const stacks = stacksPerWeek(config([seat("m1", "Husky"), seat("m2", "Rune")]));
    expect(stacks.get("m1")).toBe(1.5);
    expect(stacks.get("m2")).toBe(1.5);
  });

  it("counts a ratio out in stacks and in coupons", () => {
    const uneven = config([seat("m1", "Husky", 2), seat("m2", "Rune", 1)]);
    expect(stacksPerWeek(uneven).get("m1")).toBe(2);
    expect(stacksPerWeek(uneven).get("m2")).toBe(1);
    expect(piecesPerWeek(uneven).get("m1")).toBe(120);
    expect(piecesPerWeek(uneven).get("m2")).toBe(60);
  });

  it("gives a seat on no share nothing, which is a real arrangement", () => {
    // See V44: somebody there for the clear, paid some other way.
    const carried = config([seat("m1", "Husky", 1), seat("m2", "Rune", 0)]);
    expect(stacksPerWeek(carried).get("m2")).toBe(0);
    expect(piecesPerWeek(carried).get("m2")).toBe(0);
  });
});

describe("turning typed stacks back into a ratio", () => {
  it("reduces, so an even split is 1:1 however it was typed", () => {
    const shares = sharesFromStacks(
      new Map([
        ["m1", 1.5],
        ["m2", 1.5],
      ]),
    );
    expect(Object.fromEntries(shares!)).toEqual({ m1: 1, m2: 1 });
  });

  it("carries halves that do not reduce away", () => {
    // 1.5, 0.5 and 1 doubles to 3, 1, 2, which share no divisor.
    const shares = sharesFromStacks(
      new Map([
        ["m1", 1.5],
        ["m2", 0.5],
        ["m3", 1],
      ]),
    );
    expect(Object.fromEntries(shares!)).toEqual({ m1: 3, m2: 1, m3: 2 });
  });

  it("round-trips: what it stores draws the same stacks back", () => {
    const typed = new Map([
      ["m1", 1.5],
      ["m2", 0.5],
      ["m3", 1],
    ]);
    const shares = sharesFromStacks(typed)!;
    const seats = [...shares].map(([id, n]) => seat(id, id, n));
    const drawn = stacksPerWeek(config(seats));

    expect(drawn.get("m1")).toBe(1.5);
    expect(drawn.get("m2")).toBe(0.5);
    expect(drawn.get("m3")).toBe(1);
  });

  it("refuses a quarter, and refuses a split of nothing", () => {
    expect(sharesFromStacks(new Map([["m1", 1.25]]))).toBeNull();
    // A ratio of zeroes divides nothing, and every entitlement off it is a division by zero.
    expect(
      sharesFromStacks(
        new Map([
          ["m1", 0],
          ["m2", 0],
        ]),
      ),
    ).toBeNull();
  });
});

describe("reading a box", () => {
  it("takes whole numbers, halves, and the way somebody actually types a half", () => {
    expect(parseStacks("2")).toBe(2);
    expect(parseStacks("1.5")).toBe(1.5);
    expect(parseStacks(".5")).toBe(0.5);
    // Blank is none, which is a seat that takes nothing out of this boss.
    expect(parseStacks("")).toBe(0);
  });

  it("refuses anything finer than a half, and anything that is not a count", () => {
    expect(parseStacks("1.25")).toBeNull();
    expect(parseStacks("-1")).toBeNull();
    expect(parseStacks("two")).toBeNull();
    expect(parseStacks("1.")).toBeNull();
  });

  it("writes a half back as a half and a whole as a whole", () => {
    expect(stacksLabel(1.5)).toBe("1.5");
    expect(stacksLabel(2)).toBe("2");
    expect(stacksLabel(0)).toBe("0");
  });
});
