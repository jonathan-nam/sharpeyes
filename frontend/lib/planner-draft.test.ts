import { describe, expect, it } from "vitest";
import {
  addCharacter,
  type Draft,
  draftWants,
  EMPTY_DRAFT,
  MAX_IGN,
  MAX_MINUTES,
  readDraft,
  removeCharacter,
  resolveCharacter,
  shownCharacters,
  standaloneId,
  YOU,
} from "@/lib/planner-draft";

const roster = [
  { personId: YOU, label: "You", names: ["Rune", "Tide"] },
  { personId: "p1", label: "Alice", names: ["AliceAdele"] },
];

const draft = (over: Partial<Draft> = {}): Draft => ({ ...EMPTY_DRAFT, ...over });

const want = (character: string, bossKey = "kaling", difficulty = "HARD") => ({
  character,
  bossKey,
  difficulty,
  strength: 20,
  maxParty: null,
});

describe("reading a stored draft", () => {
  it("comes back empty from nothing, or from something unreadable", () => {
    expect(readDraft(null)).toEqual(EMPTY_DRAFT);
    expect(readDraft("{not json")).toEqual(EMPTY_DRAFT);
    expect(readDraft("3")).toEqual(EMPTY_DRAFT);
  });

  it("drops a row it cannot trust rather than clamping it", () => {
    const read = readDraft(
      JSON.stringify({
        maxMinutes: 99,
        wants: [want("Rune"), { ...want("Rune", "limbo"), strength: 75 }],
      }),
    );
    expect(read.maxMinutes).toBe(MAX_MINUTES);
    expect(read.wants.map((w) => w.bossKey)).toEqual(["kaling"]);
  });

  it("reads a draft from before hidden characters existed as hiding none", () => {
    expect(readDraft(JSON.stringify({ maxMinutes: 30, characters: [], wants: [] })).hidden).toEqual(
      [],
    );
  });
});

describe("which characters are on the page", () => {
  it("shows every known character by default, yours first", () => {
    expect(shownCharacters(draft(), roster).map((c) => c.name)).toEqual([
      "Rune",
      "Tide",
      "AliceAdele",
    ]);
  });

  it("leaves out a hidden one, and adds the typed ones after", () => {
    const d = draft({ hidden: ["tide"], characters: [{ name: "Stranger", personId: "ign:x" }] });
    expect(shownCharacters(d, roster).map((c) => c.name)).toEqual([
      "Rune",
      "AliceAdele",
      "Stranger",
    ]);
  });

  it("does not show a known character twice when an old draft added it by hand", () => {
    const d = draft({ characters: [{ name: "Rune", personId: YOU }] });
    expect(shownCharacters(d, roster).filter((c) => c.name === "Rune")).toHaveLength(1);
  });
});

describe("taking a character off and putting it back", () => {
  it("hides a known one with its bosses, and brings it back unhidden", () => {
    const off = removeCharacter(draft({ wants: [want("Tide")] }), roster, "Tide");
    expect(off.hidden).toEqual(["tide"]);
    expect(off.wants).toEqual([]);
    const back = addCharacter(off, roster, { name: "Tide", personId: YOU });
    expect(shownCharacters(back, roster).map((c) => c.name)).toContain("Tide");
  });

  it("drops a typed one outright", () => {
    const typed = { name: "Stranger", personId: standaloneId("Stranger") };
    const on = addCharacter(draft(), roster, typed);
    const off = removeCharacter(on, roster, "Stranger");
    expect(off.characters).toEqual([]);
    expect(off.hidden).toEqual([]);
  });
});

describe("adding a character by name", () => {
  const shown = shownCharacters(draft({ hidden: ["aliceadele"] }), roster);

  it("finds a known character, hidden or not, matching case-blind", () => {
    expect(resolveCharacter(" aliceadele ", roster, shown)).toEqual({
      name: "AliceAdele",
      personId: "p1",
    });
  });

  it("adds anybody else's IGN as its own player", () => {
    expect(resolveCharacter("Stranger", roster, shown)).toEqual({
      name: "Stranger",
      personId: standaloneId("Stranger"),
    });
    expect(standaloneId("Stranger")).not.toBe(standaloneId("Other"));
  });

  it("refuses a blank, a name the game would not take, and one already on the page", () => {
    for (const bad of ["", "   ", "two words", "a".repeat(MAX_IGN + 1), "RUNE"]) {
      expect(resolveCharacter(bad, roster, shown)).toBeNull();
    }
  });
});

describe("what the planner is given", () => {
  it("takes filled rows of characters on the page, naming who plays each", () => {
    const d = draft({
      hidden: ["tide"],
      wants: [want("Rune"), want("Tide"), want("AliceAdele", "kaling", "")],
    });
    const wants = draftWants(d, shownCharacters(d, roster));
    expect(wants.map((w) => [w.character, w.personId])).toEqual([["Rune", YOU]]);
  });
});
