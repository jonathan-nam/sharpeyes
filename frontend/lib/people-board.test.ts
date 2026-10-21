import { describe, expect, it } from "vitest";
import {
  type PersonDraft,
  claim,
  isRegular,
  plays,
  stillAttributed,
  sectionsOf,
  toDraft,
  fileUnder,
  characterNote,
  contestedOffCard,
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
    expect(isRegular("Prelude", [party([seat("Prelude")])])).toBe(true);
  });

  // The point of the flag rule over a count: one party is the whole arrangement for a duo.
  it("counts somebody who is in exactly one party", () => {
    const parties = [party([seat("mechobotto"), seat("Prelude")])];
    expect(isRegular("Prelude", parties)).toBe(true);
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
    expect(isRegular("PRELUDE", [party([seat("Prelude")])])).toBe(true);
  });
});

describe("unclaimed", () => {
  const parties = [
    party([seat("mechobotto"), seat("Prelude")]),
    party([seat("mechobotto"), seat("Dwight", true)], { id: "pa-2" }),
  ];

  it("leaves out whoever a person already holds", () => {
    expect(unclaimed(parties, [person("Jarvis", ["Prelude"])])).toEqual(["mechobotto"]);
  });

  // The point of stage one: a character whose own account says whose it is is not a question this
  // page has left to ask, so it does not sit in the pile waiting to be dragged onto somebody.
  it("leaves out whoever a linked account already answers for", () => {
    expect(unclaimed(parties, [person("Jarvis", [], ["Prelude"])])).toEqual(["mechobotto"]);
  });

  it("does not offer a guest at all", () => {
    expect(unclaimed(parties, [])).toEqual(["mechobotto", "Prelude"]);
  });

  it("does not offer a seat in a one-off party", () => {
    const once = party([seat("Pug")], { id: "pa-3", oneOff: true });
    expect(unclaimed([...parties, once], [])).not.toContain("Pug");
  });

  it("names a character once however many parties they are in", () => {
    expect(unclaimed(parties, []).filter((n) => n === "mechobotto")).toHaveLength(1);
  });

  it("leaves out a character claimed under a different case", () => {
    expect(unclaimed(parties, [person("Jarvis", ["prelude"])])).not.toContain("Prelude");
  });

  it("reads every seat, not just the week's roster", () => {
    const departed = party([seat("mechobotto")], { seats: [seat("mechobotto"), seat("Lynn")] });
    expect(unclaimed([departed], [])).toContain("Lynn");
  });

  it("leaves out a character on your own roster", () => {
    expect(unclaimed(parties, [], ["mechobotto"])).toEqual(["Prelude"]);
  });

  it("leaves out your own character however it is spelled on the roster", () => {
    expect(unclaimed(parties, [], ["MECHOBOTTO"])).not.toContain("mechobotto");
  });

  // The seat says so itself, which is the answer for a character added to a party since.
  it("leaves out a seat marked as one of yours even with no roster passed", () => {
    const own = party([seat("Nightwalk", false, "char-9"), seat("Prelude")]);
    expect(unclaimed([own], [])).toEqual(["Prelude"]);
  });

  it("still shows your own character on the person who was given them", () => {
    const held = [person("Jarvis", ["mechobotto"])];
    expect(unclaimed(parties, held, ["mechobotto"])).toEqual(["Prelude"]);
  });
});

describe("claim", () => {
  const people = [person("Jarvis", ["Prelude"]), person("Chris", [])];

  it("gives a character to a person", () => {
    expect(claim(people, "Lynn", 1)[1]!.characters).toEqual(["Lynn"]);
  });

  it("moves rather than duplicates, so nobody can claim it twice", () => {
    const moved = claim(people, "Prelude", 1);
    expect(moved[0]!.characters).toEqual([]);
    expect(moved[1]!.characters).toEqual(["Prelude"]);
  });

  it("moves a character named in a different case", () => {
    expect(claim(people, "PRELUDE", 1)[0]!.characters).toEqual([]);
  });

  it("takes a character back off everybody", () => {
    expect(claim(people, "Prelude", null)[0]!.characters).toEqual([]);
  });

  it("leaves the list alone rather than unclaiming when the row is gone", () => {
    expect(claim(people, "Prelude", 7)).toEqual(people);
  });
});

describe("stillAttributed", () => {
  // Both sources can name the same character: you said it before they linked, and their account
  // says it now. The row draws each character once, as the owned one, and the attribution stays in
  // the database because it is still the answer if the link goes away.
  it("drops an attribution their own account already answers", () => {
    expect(stillAttributed(person("Chris", ["CraneBolton"], ["CraneBolton"]))).toEqual([]);
  });

  it("keeps one their account does not hold", () => {
    expect(stillAttributed(person("Chris", ["OldAlt"], ["CraneBolton"]))).toEqual(["OldAlt"]);
  });

  // The backend claims a character case-insensitively, so a spelling that differs only in case is
  // the same character and would otherwise draw twice.
  it("matches the two without regard to case", () => {
    expect(stillAttributed(person("Chris", ["cranebolton"], ["CraneBolton"]))).toEqual([]);
  });
});

describe("plays", () => {
  it("is true either way a character can be known", () => {
    const chris = person("Chris", ["OldAlt"], ["CraneBolton"]);
    expect(plays(chris, "OldAlt")).toBe(true);
    expect(plays(chris, "CraneBolton")).toBe(true);
    expect(plays(chris, "Prelude")).toBe(false);
  });
});

describe("toDraft", () => {
  it("reads what the API sends", () => {
    const rows = [
      {
        id: "p1",
        name: "Chris",
        characters: ["OldAlt"],
        ownedCharacters: ["Crane"],
        linked: true,
        image: "https://cdn.discordapp.com/a.png",
        pinned: false,
      },
    ];
    expect(toDraft(rows)).toEqual([
      {
        id: "p1",
        name: "Chris",
        characters: ["OldAlt"],
        owned: ["Crane"],
        linked: true,
        image: "https://cdn.discordapp.com/a.png",
        notOnAccount: [],
        contested: [],
      },
    ]);
  });

  // The bug this exists for. lib/cache.ts lives as long as the tab, so a page opened before a
  // deploy seeds its state from a payload with no ownedCharacters at all, and the People page hits
  // this on its first render through `dirty`. Spreading the undefined threw
  // "p.ownedCharacters is not iterable" and took the page down until a hard reload.
  it("survives a payload cached before the field existed", () => {
    const cached = [{ id: "p1", name: "Chris", characters: ["Crane"], pinned: false }];
    expect(toDraft(cached as unknown as Parameters<typeof toDraft>[0])).toEqual([
      {
        id: "p1",
        name: "Chris",
        characters: ["Crane"],
        owned: [],
        linked: false,
        image: null,
        notOnAccount: [],
        contested: [],
      },
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

describe("fileUnder", () => {
  const people = [
    { id: "p1", name: "Brock", characters: ["iPager42X"], owned: [] },
    { id: "p2", name: "Jarvis", characters: ["CourtLane"], owned: [] },
  ];

  it("files a character under a person already on the list, whatever the case", () => {
    expect(fileUnder(people, "brock", "Frecklynn")[0]!.characters).toEqual([
      "iPager42X",
      "Frecklynn",
    ]);
  });

  it("adds the person when nobody has that name", () => {
    const filed = fileUnder(people, "Chris", "CraneBolton");
    expect(filed.at(-1)).toEqual({ name: "Chris", characters: ["CraneBolton"], owned: [] });
  });

  it("takes the character off whoever held it", () => {
    const filed = fileUnder(people, "Brock", "CourtLane");
    expect(filed[1]!.characters).toEqual([]);
    expect(filed[0]!.characters).toContain("CourtLane");
  });
});

describe("what a linked person's row says about a character", () => {
  const row = {
    name: "Chris",
    characters: ["GhostAlt", "TwinChar"],
    owned: ["CraneBolton"],
    notOnAccount: ["GhostAlt"],
    contested: ["TwinChar", "OtherClash"],
  };

  it("names a character their account does not hold, and one two accounts hold", () => {
    expect(characterNote(row, "GhostAlt")).toBe("Not on their account");
    expect(characterNote(row, "twinChar")).toBe("On two accounts");
    expect(characterNote(row, "CraneBolton")).toBeNull();
  });

  it("still shows a clash that is not on the row's card", () => {
    expect(contestedOffCard(row)).toEqual(["OtherClash"]);
  });
});

describe("sectionsOf", () => {
  const row = (name: string, linked: boolean) => ({ name, characters: [], owned: [], linked });
  it("splits verified from unverified, keeping each row's own index", () => {
    const sections = sectionsOf([row("Bro", true), row("Jared", false), row("Mech", true)]);
    expect(sections.map((s) => [s.title, s.rows.map((r) => [r.row.name, r.index])])).toEqual([
      [
        "Verified",
        [
          ["Bro", 0],
          ["Mech", 2],
        ],
      ],
      ["Unverified", [["Jared", 1]]],
    ]);
  });
  it("leaves out a section with nobody in it, and files a new row as unverified", () => {
    const sections = sectionsOf([{ name: "", characters: [], owned: [] }]);
    expect(sections.map((s) => s.title)).toEqual(["Unverified"]);
  });
});
