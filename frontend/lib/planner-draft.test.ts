import { describe, expect, it } from "vitest";
import { draftWants, EMPTY_DRAFT, MAX_MINUTES, readDraft, YOU } from "@/lib/planner-draft";

describe("reading a stored draft", () => {
  it("comes back empty from nothing, or from something unreadable", () => {
    expect(readDraft(null)).toEqual(EMPTY_DRAFT);
    expect(readDraft("{not json")).toEqual(EMPTY_DRAFT);
    expect(readDraft("3")).toEqual(EMPTY_DRAFT);
  });

  it("drops a row it cannot trust rather than clamping it", () => {
    const draft = readDraft(
      JSON.stringify({
        maxMinutes: 99,
        characters: [{ name: "Rune", personId: YOU }],
        wants: [
          {
            character: "Rune",
            bossKey: "kaling",
            difficulty: "HARD",
            strength: 20,
            maxParty: null,
          },
          { character: "Rune", bossKey: "limbo", difficulty: "HARD", strength: 75, maxParty: null },
          { character: "Gone", bossKey: "limbo", difficulty: "HARD", strength: 20, maxParty: null },
        ],
      }),
    );
    expect(draft.maxMinutes).toBe(MAX_MINUTES);
    expect(draft.wants.map((w) => w.bossKey)).toEqual(["kaling"]);
  });
});

describe("what the planner is given", () => {
  it("skips a row still being filled in, and names who plays each one", () => {
    const wants = draftWants({
      maxMinutes: 30,
      characters: [
        { name: "Rune", personId: YOU },
        { name: "Tide", personId: "p1" },
      ],
      wants: [
        { character: "Rune", bossKey: "kaling", difficulty: "HARD", strength: 20, maxParty: null },
        { character: "Tide", bossKey: "kaling", difficulty: "", strength: 20, maxParty: null },
      ],
    });
    expect(wants.map((w) => [w.character, w.personId])).toEqual([["Rune", YOU]]);
  });
});
