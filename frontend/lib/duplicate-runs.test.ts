import { describe, expect, it } from "vitest";
import { loggedTwice, withoutLoot } from "./duplicate-runs";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party } from "@/types/party";

const party = (id: string, characterId: string, bossKey: string) =>
  ({ id, characterId, bossKey }) as unknown as Party;
const loot = (id: string, weekStart: string) => ({ id, weekStart }) as unknown as Loot;
const pool = (partyId: string, ...rows: Loot[]): PartyLootPool => ({ partyId, loot: rows });

describe("a run logged in your own party and a shared one", () => {
  const own = {
    parties: [party("mine", "creed", "kalos"), party("other", "creed", "lucid")],
    pools: [
      pool("mine", loot("dup", "2026-10-15"), loot("only-mine", "2026-10-08")),
      pool("other", loot("lucid", "2026-10-15")),
    ],
  };
  const shared = {
    parties: [party("theirs", "creed", "kalos")],
    pools: [pool("theirs", loot("their-copy", "2026-10-15"))],
    ownerOf: new Map([["theirs", "Mech"]]),
  };

  it("counts the owner's copy: your own drop that week is the duplicate", () => {
    expect([...loggedTwice(own, shared)]).toEqual([["dup", "Mech"]]);
  });

  it("keeps a week only your copy has, and a different boss", () => {
    const twice = loggedTwice(own, shared);
    expect(twice.has("only-mine")).toBe(false);
    expect(twice.has("lucid")).toBe(false);
  });

  it("matches a character of yours seated in the shared party, not only its leader", () => {
    const seated = {
      ...shared,
      parties: [
        {
          ...party("theirs", "their-leader", "kalos"),
          seats: [{ characterId: "creed" }, { characterId: null }],
        } as unknown as Party,
      ],
    };
    expect([...loggedTwice(own, seated)]).toEqual([["dup", "Mech"]]);
  });

  it("takes the duplicates out of the pools that are counted", () => {
    const counted = withoutLoot(own.pools, loggedTwice(own, shared));
    expect(counted.map((p) => p.loot.map((l) => l.id))).toEqual([["only-mine"], ["lucid"]]);
  });
});
