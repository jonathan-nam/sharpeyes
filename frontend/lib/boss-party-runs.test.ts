import { describe, expect, it } from "vitest";
import { partyRunsByCharacter } from "@/lib/boss-clears";
import type { Party, SeatedParty } from "@/types/party";

const party = (characterId: string, bossKey: string, over: Partial<Party> = {}): Party =>
  ({
    characterId,
    bossKey,
    solo: false,
    retired: false,
    oneOff: false,
    skippedThisPeriod: false,
    ...over,
  }) as Party;

const keysOf = (runs: Map<string, Set<string>>, characterId: string) =>
  [...(runs.get(characterId) ?? [])].sort();

describe("partyRunsByCharacter", () => {
  it("marks a character's own parties and leaves solo configs out", () => {
    const runs = partyRunsByCharacter(
      [party("c1", "lotus"), party("c1", "damien", { solo: true }), party("c2", "will")],
      [],
    );
    expect(keysOf(runs, "c1")).toEqual(["lotus"]);
    expect(keysOf(runs, "c2")).toEqual(["will"]);
  });

  it("leaves out a party that is not running this period", () => {
    const runs = partyRunsByCharacter(
      [
        party("c1", "lotus", { skippedThisPeriod: true }),
        party("c1", "will", { oneOff: true, skippedThisPeriod: true }),
        party("c1", "lucid", { retired: true }),
      ],
      [],
    );
    expect(runs.has("c1")).toBe(false);
  });

  it("files a party somebody else keeps under the character of yours seated in it", () => {
    // The owner's config names THEIR character, which is not a column on your matrix.
    const seated = [
      { party: party("theirs", "verus"), mySeatIds: ["s1"], yourCharacterId: "c3" },
    ] as SeatedParty[];
    const runs = partyRunsByCharacter([], seated);
    expect(keysOf(runs, "c3")).toEqual(["verus"]);
    expect(runs.has("theirs")).toBe(false);
  });
});
