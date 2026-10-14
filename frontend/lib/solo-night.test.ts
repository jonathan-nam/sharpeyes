import { describe, expect, it } from "vitest";

import type { Party, PartyMember } from "@/types/party";

import { soloNight } from "./solo-night";

function member(over: Partial<PartyMember> & { name: string }): PartyMember {
  return {
    id: over.name,
    personId: null,
    personName: null,
    characterId: null,
    linkedCharacterId: null,
    spriteImgUrl: null,
    guest: false,
    shares: 1,
    ...over,
  };
}

function party(id: string, members: PartyMember[], over: Partial<Party> = {}): Party {
  return {
    id,
    slug: id,
    characterId: members[0]?.characterId ?? "c1",
    solo: false,
    retired: false,
    worldType: "INTERACTIVE",
    bossKey: id,
    difficulty: null,
    minutes: null,
    members,
    seats: members,
    usualRoster: true,
    skippedThisPeriod: false,
    oneOff: false,
    pendingLoot: 0,
    awaitingPayout: 0,
    settledLoot: 0,
    cleared: null,
    clearedByHand: false,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const mechy = member({ name: "Mechy", characterId: "c1" });
const bishy = member({ name: "Bishy", characterId: "c2" });
const chris = member({ name: "Creed", personId: "p-chris", personName: "Chris" });
const stranger = member({ name: "Nobody" });

const ids = (result: ReturnType<typeof soloNight>) => result.plan.runs.map((p) => p.run.id);

describe("soloNight", () => {
  it("plans only the runs you can staff alone", () => {
    const result = soloNight(
      [party("lucid", [mechy]), party("will", [mechy, chris]), party("gloom", [stranger])],
      [],
      new Set(),
    );
    expect(ids(result)).toEqual(["lucid"]);
    expect(result.total).toBe(1);
  });

  it("is not bounded by a clock", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      party(`b${i}`, [i % 2 ? mechy : bishy], { minutes: 60 }),
    );
    expect(soloNight(many, [], new Set()).plan.runs).toHaveLength(12);
  });

  it("drops cleared and skipped runs but still counts the cleared ones", () => {
    const result = soloNight(
      [
        party("lucid", [mechy], { cleared: true }),
        party("will", [mechy], { skippedThisPeriod: true }),
        party("gloom", [bishy]),
      ],
      [],
      new Set(),
    );
    expect(ids(result)).toEqual(["gloom"]);
    expect(result.total).toBe(2);
  });

  it("keeps a run ticked on this screen in the order", () => {
    const result = soloNight(
      [party("lucid", [mechy], { cleared: true }), party("gloom", [bishy])],
      [],
      new Set(["lucid"]),
    );
    expect(ids(result).sort()).toEqual(["gloom", "lucid"]);
  });
});
