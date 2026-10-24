import { describe, expect, it } from "vitest";
import { FEE_MVP, FEE_STANDARD, splitDrop, type SplitInput } from "@/lib/drop-split";
import { committedGolden, goldenCases, goldenText, seeded } from "@/lib/golden";

// splitDrop's answers for the backend port (backend .../money/DropSplit.kt). See lib/golden.ts.

const B = 1_000_000_000;
const M = 1_000_000;

// Where the rounding and the fallback to floor live: purses too small to divide, and the sizes real
// drops sell at.
const AMOUNTS = [0, 1, 5, 7, 100, 999, 12_345, 25 * M, 970 * M, B - 1, B, 1_450 * M, 9_500 * M];
const FEES = [FEE_MVP, FEE_STANDARD];

function inputs(): SplitInput[] {
  const out: SplitInput[] = [];
  // A grid over everything that changes which branch runs.
  for (const amount of AMOUNTS)
    for (const amountIs of ["listed", "received"] as const)
      for (const method of ["lazy", "fair"] as const)
        for (const party of [0, 1, 3, 5])
          for (const rounding of ["up", "down"] as const)
            out.push({
              amount,
              amountIs,
              sellerFee: FEE_STANDARD,
              memberFees: Array.from({ length: party }, (_, i) => FEES[i % 2]!),
              method,
              rounding,
            });

  // A seeded spread: mixed rates, uneven and zero shares, amounts with every digit in play.
  const random = seeded(20261024);
  const pick = <T>(from: readonly T[]) => from[Math.floor(random() * from.length)]!;
  for (let i = 0; i < 400; i++) {
    const party = Math.floor(random() * 6);
    const uneven = random() < 0.5;
    out.push({
      amount: Math.floor(random() * 10 ** (1 + Math.floor(random() * 11))),
      amountIs: pick(["listed", "received"] as const),
      sellerFee: pick([0, FEE_MVP, FEE_STANDARD]),
      memberFees: Array.from({ length: party }, () => pick([0, FEE_MVP, FEE_STANDARD])),
      method: pick(["lazy", "fair"] as const),
      ...(uneven
        ? {
            sellerShares: Math.floor(random() * 5),
            memberShares: Array.from({ length: party }, () => Math.floor(random() * 5)),
          }
        : {}),
      ...(random() < 0.7 ? { rounding: pick(["up", "down"] as const) } : {}),
    });
  }

  // Refusals, which the port must refuse too.
  const base: SplitInput = {
    amount: B,
    amountIs: "listed",
    sellerFee: FEE_STANDARD,
    memberFees: [FEE_STANDARD, FEE_MVP],
    method: "fair",
  };
  out.push(
    { ...base, sellerFee: 1 },
    { ...base, memberFees: [FEE_STANDARD, -0.01] },
    { ...base, amount: -1 },
    { ...base, memberShares: [1] },
    { ...base, sellerShares: 0, memberShares: [0, 0] },
    { ...base, memberShares: [1, -1] },
    // A nonsense seller rate is not refused when the received figure makes it unused.
    { ...base, amountIs: "received", sellerFee: 1 },
  );
  return out;
}

describe("drop-split golden fixtures", () => {
  it("are what splitDrop answers today", () => {
    const text = goldenText(
      "frontend/lib/drop-split.golden.test.ts",
      goldenCases(inputs(), splitDrop),
    );
    expect(committedGolden("drop-split.json", text) === text, "run with UPDATE_GOLDEN=1").toBe(
      true,
    );
  });
});
