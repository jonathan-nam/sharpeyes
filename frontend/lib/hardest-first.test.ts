import { describe, expect, it } from "vitest";
import { hardestFirst, partyHp } from "@/lib/hardest-first";

const party = (
  bossKey: string,
  difficulty: string | null,
  weekDifficulty: string | null = null,
) => ({
  bossKey,
  difficulty,
  weekDifficulty,
});

describe("hardestFirst", () => {
  it("puts the main's parties first, then the hardest boss", () => {
    const kaling = party("kaling", "EXTREME");
    const lotus = party("lotus", "NORMAL");
    const jupiter = party("jupiter", "HARD");
    const limbo = party("limbo", "NORMAL");
    expect(
      hardestFirst([
        { party: lotus, main: true },
        { party: jupiter, main: false },
        { party: limbo, main: true },
        { party: kaling, main: false },
      ]),
    ).toEqual([limbo, lotus, kaling, jupiter]);
  });

  it("reads the mode a week ran at before the party's usual one", () => {
    expect(partyHp(party("kalos-the-guardian", "EXTREME", "NORMAL"))).toBe(1060);
  });

  it("sorts a party with no mode last rather than guessing one", () => {
    expect(partyHp(party("lotus", null))).toBe(0);
  });
});
