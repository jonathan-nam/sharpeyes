import { describe, expect, it } from "vitest";
import { partyRunsByCharacter } from "@/lib/parties";
import type { Party, SeatedParty } from "@/types/party";

// Which week counts is the backend's call (RanAsPartyTest); this is only how it lands in the grid.
const party = (characterId: string, bossKey: string, over: Partial<Party> = {}): Party =>
  ({ characterId, bossKey, ranAsParty: true, ...over }) as Party;

const keysOf = (runs: Map<string, Set<string>>, characterId: string) =>
  [...(runs.get(characterId) ?? [])].sort();

describe("partyRunsByCharacter", () => {
  it("marks the configs the backend says ran as a party that week", () => {
    const runs = partyRunsByCharacter(
      [party("c1", "lotus"), party("c1", "damien", { ranAsParty: false }), party("c2", "will")],
      [],
    );
    expect(keysOf(runs, "c1")).toEqual(["lotus"]);
    expect(keysOf(runs, "c2")).toEqual(["will"]);
  });

  it("reads a cached payload from before the field as no party", () => {
    const runs = partyRunsByCharacter([party("c1", "lotus", { ranAsParty: undefined })], []);
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
