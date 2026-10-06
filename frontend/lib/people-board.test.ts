import { describe, expect, it } from "vitest";
import {
  type PersonDraft,
  claim,
  isRegular,
  plays,
  stillAttributed,
  toDraft,
  unclaimed,
} from "./people-board";
import type { Party, PartyMember } from "@/types/party";

const seat = (name: string, guest = false, characterId: string | null = null): PartyMember => ({
  id: `m-${name}`,
  name,
  personId: null,
  personName: null,
  characterId,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest,
  shares: 1,
});

const party = (seats: PartyMember[], over: Partial<Party> = {}): Party => ({
  id: `pa-${seats.map((s) => s.name).join("-")}`,
  slug: "pa",
  characterId: "char-1",
  solo: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey: "kalos-the-guardian",
  difficulty: "CHAOS",
  minutes: null,
  members: seats,
  seats,
  usualRoster: true,
  skippedThisPeriod: false,
  oneOff: false,
  pendingLoot: 0,
  awaitingPayout: 0,
  settledLoot: 0,
  cleared: null,
  clearedByHand: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  ...over,
});

const person = (name: string, characters: string[], owned: string[] = []): PersonDraft => ({
  id: `p-${name}`,
  name,
  characters,
  owned,
});

describe("isRegular", () => {
  it("counts a standing seat in a standing party", () => {
    expect(isRegular("Premial", [party([seat("Premial")])])).toBe(true);
  });

  // The point of the flag rule over a count: one party is the whole arrangement for a duo.
  it("counts somebody who is in exactly one party", () => {
    const parties = [party([seat("mechyfechy"), seat("Premial")])];
    expect(isRegular("Premial", parties)).toBe(true);
  });

  it("does not count a guest seat", () => {
    expect(isRegular("Dwight", [party([seat("Dwight", true)])])).toBe(false);
  });

  it("does not count a seat in a one-off party", () => {
    expect(isRegular("Dwight", [party([seat("Dwight")], { oneOff: true })])).toBe(false);
  });

  it("counts somebody who is a guest in one party and a regular in another", () => {
    const parties = [party([seat("Dwight", true)]), party([seat("Dwight")])];
    expect(isRegular("Dwight", parties)).toBe(true);
  });

  it("matches the name case-insensitively", () => {
    expect(isRegular("PREMIAL", [party([seat("Premial")])])).toBe(true);
  });
});

describe("unclaimed", () => {
  const parties = [
    party([seat("mechyfechy"), seat("Premial")]),
    party([seat("mechyfechy"), seat("Dwight", true)], { id: "pa-2" }),
  ];

  it("leaves out whoever a person already holds", () => {
    expect(unclaimed(parties, [person("Jared", ["Premial"])])).toEqual(["mechyfechy"]);
  });

  // The point of stage one: a character whose own account says whose it is is not a question this
  // page has left to ask, so it does not sit in the pile waiting to be dragged onto somebody.
  it("leaves out whoever a linked account already answers for", () => {
    expect(unclaimed(parties, [person("Jared", [], ["Premial"])])).toEqual(["mechyfechy"]);
  });

  it("does not offer a guest at all", () => {
    expect(unclaimed(parties, [])).toEqual(["mechyfechy", "Premial"]);
  });

  it("does not offer a seat in a one-off party", () => {
    const once = party([seat("Pug")], { id: "pa-3", oneOff: true });
    expect(unclaimed([...parties, once], [])).not.toContain("Pug");
  });

  it("names a character once however many parties they are in", () => {
    expect(unclaimed(parties, []).filter((n) => n === "mechyfechy")).toHaveLength(1);
  });

  it("leaves out a character claimed under a different case", () => {
    expect(unclaimed(parties, [person("Jared", ["premial"])])).not.toContain("Premial");
  });

  it("reads every seat, not just the week's roster", () => {
    const departed = party([seat("mechyfechy")], { seats: [seat("mechyfechy"), seat("Lynn")] });
    expect(unclaimed([departed], [])).toContain("Lynn");
  });

  it("leaves out a character on your own roster", () => {
    expect(unclaimed(parties, [], ["mechyfechy"])).toEqual(["Premial"]);
  });

  it("leaves out your own character however it is spelled on the roster", () => {
    expect(unclaimed(parties, [], ["MECHYFECHY"])).not.toContain("mechyfechy");
  });

  // The seat says so itself, which is the answer for a character added to a party since.
  it("leaves out a seat marked as one of yours even with no roster passed", () => {
    const own = party([seat("Nightwalk", false, "char-9"), seat("Premial")]);
    expect(unclaimed([own], [])).toEqual(["Premial"]);
  });

  it("still shows your own character on the person who was given them", () => {
    const held = [person("Jared", ["mechyfechy"])];
    expect(unclaimed(parties, held, ["mechyfechy"])).toEqual(["Premial"]);
  });
});

describe("claim", () => {
  const people = [person("Jared", ["Premial"]), person("Chris", [])];

  it("gives a character to a person", () => {
    expect(claim(people, "Lynn", 1)[1]!.characters).toEqual(["Lynn"]);
  });

  it("moves rather than duplicates, so nobody can claim it twice", () => {
    const moved = claim(people, "Premial", 1);
    expect(moved[0]!.characters).toEqual([]);
    expect(moved[1]!.characters).toEqual(["Premial"]);
  });

  it("moves a character named in a different case", () => {
    expect(claim(people, "PREMIAL", 1)[0]!.characters).toEqual([]);
  });

  it("takes a character back off everybody", () => {
    expect(claim(people, "Premial", null)[0]!.characters).toEqual([]);
  });

  it("leaves the list alone rather than unclaiming when the row is gone", () => {
    expect(claim(people, "Premial", 7)).toEqual(people);
  });
});

describe("stillAttributed", () => {
  // Both sources can name the same character: you said it before they linked, and their account
  // says it now. The row draws each character once, as the owned one, and the attribution stays in
  // the database because it is still the answer if the link goes away.
  it("drops an attribution their own account already answers", () => {
    expect(stillAttributed(person("Chris", ["CreedBratton"], ["CreedBratton"]))).toEqual([]);
  });

  it("keeps one their account does not hold", () => {
    expect(stillAttributed(person("Chris", ["OldAlt"], ["CreedBratton"]))).toEqual(["OldAlt"]);
  });

  // The backend claims a character case-insensitively, so a spelling that differs only in case is
  // the same character and would otherwise draw twice.
  it("matches the two without regard to case", () => {
    expect(stillAttributed(person("Chris", ["creedbratton"], ["CreedBratton"]))).toEqual([]);
  });
});

describe("plays", () => {
  it("is true either way a character can be known", () => {
    const chris = person("Chris", ["OldAlt"], ["CreedBratton"]);
    expect(plays(chris, "OldAlt")).toBe(true);
    expect(plays(chris, "CreedBratton")).toBe(true);
    expect(plays(chris, "Premial")).toBe(false);
  });
});

describe("toDraft", () => {
  it("reads what the API sends", () => {
    const rows = [
      {
        id: "p1",
        name: "Chris",
        characters: ["OldAlt"],
        ownedCharacters: ["Creed"],
        linked: true,
        pinned: false,
      },
    ];
    expect(toDraft(rows)).toEqual([
      { id: "p1", name: "Chris", characters: ["OldAlt"], owned: ["Creed"], linked: true },
    ]);
  });

  // The bug this exists for. lib/cache.ts lives as long as the tab, so a page opened before a
  // deploy seeds its state from a payload with no ownedCharacters at all, and the People page hits
  // this on its first render through `dirty`. Spreading the undefined threw
  // "p.ownedCharacters is not iterable" and took the page down until a hard reload.
  it("survives a payload cached before the field existed", () => {
    const cached = [{ id: "p1", name: "Chris", characters: ["Creed"], pinned: false }];
    expect(toDraft(cached as unknown as Parameters<typeof toDraft>[0])).toEqual([
      { id: "p1", name: "Chris", characters: ["Creed"], owned: [], linked: false },
    ]);
  });

  // Copies, not the same arrays: the board edits a draft and compares it against the people it was
  // made from, so sharing an array would make every edit look like no edit.
  it("copies the arrays rather than sharing them", () => {
    const rows = [
      {
        id: "p1",
        name: "Chris",
        characters: ["A"],
        ownedCharacters: ["B"],
        linked: true,
        pinned: false,
      },
    ];
    const draft = toDraft(rows);
    draft[0]!.characters.push("C");
    expect(rows[0]!.characters).toEqual(["A"]);
  });
});
