import { describe, expect, it } from "vitest";
import { partyRunsByCharacter } from "@/lib/parties";
import type { Party, SeatedParty } from "@/types/party";

const party = (characterId: string, bossKey: string, over: Partial<Party> = {}): Party =>
  ({
    characterId,
    bossKey,
    solo: false,
    retired: false,
    oneOff: false,
    skippedThisPeriod: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  }) as Party;

const keysOf = (runs: Map<string, Set<string>>, characterId: string) =>
  [...(runs.get(characterId) ?? [])].sort();

describe("partyRunsByCharacter", () => {
  it("marks a character's own parties and leaves solo and retired configs out", () => {
    const runs = partyRunsByCharacter(
      [
        party("c1", "lotus"),
        party("c1", "damien", { solo: true }),
        party("c1", "lucid", { retired: true }),
        party("c2", "will"),
      ],
      [],
      null,
    );
    expect(keysOf(runs, "c1")).toEqual(["lotus"]);
    expect(keysOf(runs, "c2")).toEqual(["will"]);
  });

  it("counts a one-off in the week it ran and not in a week it did not", () => {
    // skippedThisPeriod is the server's answer for the week the list was asked for.
    const ran = partyRunsByCharacter([party("c1", "will", { oneOff: true })], [], "2026-09-03");
    const off = partyRunsByCharacter(
      [party("c1", "will", { oneOff: true, skippedThisPeriod: true })],
      [],
      "2026-09-10",
    );
    expect(keysOf(ran, "c1")).toEqual(["will"]);
    expect(off.has("c1")).toBe(false);
  });

  it("leaves a standing party out of a week it was taken off", () => {
    const runs = partyRunsByCharacter(
      [party("c1", "lotus", { skippedThisPeriod: true })],
      [],
      null,
    );
    expect(runs.has("c1")).toBe(false);
  });

  it("does not mark a past week with a party set up after it", () => {
    const later = party("c1", "lotus", { createdAt: "2026-09-12T10:00:00Z" });
    expect(partyRunsByCharacter([later], [], "2026-09-03").has("c1")).toBe(false);
    expect(keysOf(partyRunsByCharacter([later], [], "2026-09-10"), "c1")).toEqual(["lotus"]);
  });

  it("files a party somebody else keeps under the character of yours seated in it", () => {
    // The owner's config names THEIR character, which is not a column on your matrix.
    const seated = [
      { party: party("theirs", "verus"), mySeatIds: ["s1"], yourCharacterId: "c3" },
    ] as SeatedParty[];
    const runs = partyRunsByCharacter([], seated, null);
    expect(keysOf(runs, "c3")).toEqual(["verus"]);
    expect(runs.has("theirs")).toBe(false);
  });
});
