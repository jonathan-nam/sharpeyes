import { describe, expect, it } from "vitest";
import { sellersOf, splitByLogger } from "./sale-logger";
import type { Loot, PartyLootPool } from "@/types/loot";

const loot = (id: string, recordedByYou?: boolean) => ({ id, recordedByYou }) as unknown as Loot;

describe("splitting the pools by who logged each drop", () => {
  it("keeps your drops for the sale forms and the rest for reading", () => {
    const pools: PartyLootPool[] = [
      { partyId: "pa", loot: [loot("mine", true), loot("theirs", false)] },
      { partyId: "pb", loot: [loot("old")] },
    ];
    const { yours, theirs } = splitByLogger(pools);
    expect(yours.map((p) => [p.partyId, p.loot.map((l) => l.id)])).toEqual([
      ["pa", ["mine"]],
      ["pb", ["old"]],
    ]);
    expect(theirs.map((p) => [p.partyId, p.loot.map((l) => l.id)])).toEqual([["pa", ["theirs"]]]);
  });
});

describe("who a sale can name as seller", () => {
  const seat = (id: string, mine: boolean, linked = false) =>
    ({
      id,
      characterId: mine ? `c-${id}` : null,
      linkedCharacterId: linked ? `l-${id}` : null,
    }) as never;
  const ran = [seat("brock", false, true), seat("jarvis", false), seat("you", true)];

  it("is only your own seats in a party you are only in", () => {
    expect(sellersOf(ran, true).map((s: { id: string }) => s.id)).toEqual(["you"]);
  });

  it("in your own party is you first, then anybody not on the site, never another account", () => {
    expect(sellersOf(ran, false).map((s: { id: string }) => s.id)).toEqual(["you", "jarvis"]);
  });
});
