import { describe, expect, it } from "vitest";

import type { Party, PartyMember } from "@/types/party";

import { rosterOfSwitchers } from "./boss-night";
import { planNight } from "./boss-run-plan";
import { type NightInputs, nightOf, searchNight } from "./night-search";

function member(name: string, owner: string): PartyMember {
  const mine = owner === "you";
  return {
    id: name,
    name,
    personId: mine ? null : owner,
    personName: mine ? null : owner,
    characterId: mine ? `c-${name}` : null,
    linkedCharacterId: null,
    spriteImgUrl: null,
    guest: false,
    shares: 1,
  };
}

function party(id: string, bossKey: string, seats: [string, string][], cleared = false): Party {
  const members = seats.map(([name, owner]) => member(name, owner));
  return {
    id,
    slug: id,
    characterId: members[0]?.characterId ?? "c1",
    solo: false,
    retired: false,
    worldType: "INTERACTIVE",
    bossKey,
    difficulty: null,
    minutes: 20,
    members,
    seats: members,
    usualRoster: true,
    skippedThisPeriod: false,
    oneOff: false,
    pendingLoot: 0,
    awaitingPayout: 0,
    settledLoot: 0,
    cleared,
    clearedByHand: false,
    createdAt: "",
    updatedAt: "",
  };
}

const running = [
  party("lucid", "lucid", [
    ["Thornwick", "you"],
    ["Quillon", "bren"],
  ]),
  party("will", "will", [
    ["Pellmoor", "you"],
    ["Marrowby", "bren"],
  ]),
  party(
    "gloom",
    "gloom",
    [
      ["Thornwick", "you"],
      ["Marrowby", "bren"],
    ],
    true,
  ),
];
const data = {
  running,
  answered: new Set<string>(),
  bosses: [],
  switchers: new Set(rosterOfSwitchers(running).map((person) => person.id)),
};
const inputs: NightInputs = {
  budget: 120,
  openOnly: true,
  everyoneOn: false,
  away: [],
  startAt: 0,
  windows: {},
  timed: true,
};

describe("nightOf", () => {
  it("plans a cleared config and hides it, so the order does not move when it clears", () => {
    const night = nightOf(inputs, data);
    expect([...night.hidden]).toEqual(["gloom"]);
    expect(night.search.searched.map((run) => run.id)).toEqual(["lucid", "will", "gloom"]);
    expect(night.plannedParties.map((p) => p.id)).toEqual(["lucid", "will"]);
  });

  it("drops somebody marked away, and every run that needs them", () => {
    const night = nightOf({ ...inputs, away: ["bren"] }, data);
    expect(night.onTonight.map((person) => person.id)).toEqual(["you"]);
    expect(night.search.searched).toEqual([]);
  });

  it("applies no clock and no windows to an untimed night", () => {
    const windows = { bren: { from: "+1", until: "" } };
    expect(nightOf({ ...inputs, windows }, data).search.available).toEqual({ bren: { from: 60 } });
    const untimed = nightOf({ ...inputs, windows, timed: false }, data).search;
    expect(untimed.night).toBe(Infinity);
    expect(untimed.available).toEqual({});
  });

  it("is plain data, so it reaches a worker and a cache key whole", () => {
    const { search } = nightOf(inputs, data);
    expect(structuredClone(search)).toEqual(search);
  });
});

describe("searchNight", () => {
  it("gives the hidden runs' minutes back to the search, as the page did", () => {
    const { search } = nightOf(inputs, data);
    const result = searchNight(search);
    expect(result.minutes).toBe(140);
    expect(result.byCount).toEqual(planNight(search.searched, { minutes: 140 }).byCount);
  });
});
