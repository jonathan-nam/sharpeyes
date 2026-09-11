import { describe, expect, it } from "vitest";
import { bySeatedCharacter } from "./shared-parties";
import type { Party, SeatedParty } from "@/types/party";

const party = (id: string, characterId: string): SeatedParty => ({
  party: { id, bossKey: "kalos-the-guardian" } as Party,
  mySeatIds: [`s-${id}`],
  yourCharacterId: characterId,
});

describe("bySeatedCharacter", () => {
  // Filed under a character of YOURS, the way your own list is, and never under the owner's: the
  // party's own characterId is theirs.
  it("files each party under the character of yours that sits in it", () => {
    const groups = bySeatedCharacter(
      [party("p1", "char-a"), party("p2", "char-b"), party("p3", "char-a")],
      ["char-a", "char-b"],
    );
    expect(groups.map((g) => [g.characterId, g.parties.length])).toEqual([
      ["char-a", 2],
      ["char-b", 1],
    ]);
  });

  // So the shared list and your own read down the page the same way.
  it("takes your own character order, not the order the parties arrived in", () => {
    const groups = bySeatedCharacter(
      [party("p1", "char-b"), party("p2", "char-a")],
      ["char-a", "char-b"],
    );
    expect(groups.map((g) => g.characterId)).toEqual(["char-a", "char-b"]);
  });

  // A shorter list that looks complete is worse than a heading with no name behind it. This is
  // reachable through a cached character list that predates a character (see #613).
  it("keeps a character your order has not heard of, after the ones it has", () => {
    const groups = bySeatedCharacter([party("p1", "char-b"), party("p2", "char-a")], ["char-a"]);
    expect(groups.map((g) => g.characterId)).toEqual(["char-a", "char-b"]);
    expect(groups.flatMap((g) => g.parties).length).toBe(2);
  });

  it("has nothing to group when nothing is shared", () => {
    expect(bySeatedCharacter([], ["char-a"])).toEqual([]);
  });
});
