import { describe, expect, it } from "vitest";

import type { Party, PartyMember } from "@/types/party";

import { DEFAULT_MINUTES, MAX_MINUTES, parseMinutes, runMinutes } from "./boss-minutes";
import {
  type DraftRun,
  formatDuration,
  formatOffset,
  formatOffsetShort,
  nextHalfHour,
  offsetNow,
  ownerOf,
  parseOffset,
  personKey,
  rosterFrom,
  rosterFromDrafts,
  runsFromDrafts,
  planAsText,
  planGrid,
  runsFromParties,
  stillToRun,
  type RunTime,
  runTicks,
  runTimes,
  spanBetween,
  YOU,
} from "./boss-night";
import { type EligibleRun, planNight, screenRuns } from "./boss-run-plan";

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

function party(
  id: string,
  bossKey: string,
  members: PartyMember[],
  minutes: number | null = null,
): Party {
  return {
    id,
    slug: id,
    characterId: members[0]?.characterId ?? "c1",
    solo: false,
    retired: false,
    worldType: "INTERACTIVE",
    bossKey,
    difficulty: null,
    minutes,
    members,
    seats: members,
    looterMemberId: null,
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
  };
}

const mine = member({ name: "Mechy", characterId: "c1" });
const chris = member({ name: "Creed", personId: "p-chris", personName: "Chris" });

describe("ownerOf", () => {
  it("calls one of your own characters yours", () => {
    expect(ownerOf(mine)).toBe(YOU);
  });

  it("calls somebody else's character theirs", () => {
    expect(ownerOf(chris)).toBe("p-chris");
  });

  it("leaves an unnamed seat unattributed rather than guessing", () => {
    expect(ownerOf(member({ name: "Stranger" }))).toBeNull();
  });

  it("trusts the roster link over a name match on the People page", () => {
    // The backend sets characterId only when the seat IS a roster character. A person link is a
    // name match, so a stray People entry naming your own character must not take it off you.
    expect(ownerOf(member({ name: "Mechy", characterId: "c1", personId: "p-chris" }))).toBe(YOU);
  });
});

describe("rosterFrom", () => {
  it("puts you first and the rest in name order", () => {
    const parties = [
      party("1", "lotus", [mine, member({ name: "Zed", personId: "p-z", personName: "Zoe" })]),
      party("2", "damien", [mine, chris]),
    ];
    expect(rosterFrom(parties)).toEqual([
      { id: YOU, name: "You" },
      { id: "p-chris", name: "Chris" },
      { id: "p-z", name: "Zoe" },
    ]);
  });

  it("names each person once however many configs they are in", () => {
    const parties = [party("1", "lotus", [mine, chris]), party("2", "damien", [mine, chris])];
    expect(rosterFrom(parties)).toHaveLength(2);
  });

  it("leaves you out when none of the configs are yours to be in", () => {
    expect(rosterFrom([party("1", "lotus", [chris])])).toEqual([{ id: "p-chris", name: "Chris" }]);
  });

  it("contributes nobody for a seat nobody has claimed", () => {
    const parties = [party("1", "lotus", [mine, member({ name: "Stranger" })])];
    expect(rosterFrom(parties)).toEqual([{ id: YOU, name: "You" }]);
  });
});

describe("stillToRun", () => {
  const done = (id: string) => ({ ...party(id, "lotus", [mine]), cleared: true });
  const open = (id: string) => party(id, "lotus", [mine]);

  it("drops a boss that was already cleared when the page opened", () => {
    expect(stillToRun([done("1"), open("2")], new Set()).map((p) => p.id)).toEqual(["2"]);
  });

  // The whole reason the set exists. planNight is a beam search, so a run leaving the candidate
  // set re-orders everything after it, under a party who are reading the order that was pasted.
  it("keeps a boss ticked off from the page, so the rest of the night stays put", () => {
    const kept = stillToRun([done("1"), open("2")], new Set(["1"]));
    expect(kept.map((p) => p.id)).toEqual(["1", "2"]);
  });

  it("keeps one ticked and then un-ticked, which is still an answer given here", () => {
    expect(stillToRun([open("1")], new Set(["1"])).map((p) => p.id)).toEqual(["1"]);
  });

  // Null is "no capture has said anything", which is a boss still to run and not a finished one.
  it("does not read silence as cleared", () => {
    expect(stillToRun([open("1")], new Set())).toHaveLength(1);
  });
});

describe("runsFromParties", () => {
  const bosses = [
    { bossKey: "lotus", name: "Lotus", reset: "WEEKLY", iconUrl: null, difficulties: ["HARD"] },
  ];

  it("turns a config into a run with its seats attributed", () => {
    const runs = runsFromParties([party("1", "lotus", [mine, chris], 20)], bosses);
    expect(runs).toEqual([
      {
        id: "1",
        bossKey: "lotus",
        bossName: "Lotus",
        difficulty: null,
        minutes: 20,
        assumed: false,
        seats: [
          { character: "Mechy", personId: YOU },
          { character: "Creed", personId: "p-chris" },
        ],
      },
    ]);
  });

  it("keeps a config the planner will refuse, so it can say why", () => {
    const runs = runsFromParties(
      [party("1", "lotus", [mine, member({ name: "Stranger" })])],
      bosses,
    );
    expect(runs).toHaveLength(1);
  });

  it("carries the mode the config says it runs", () => {
    const hard = { ...party("1", "lotus", [mine, chris]), difficulty: "HARD" };
    expect(runsFromParties([hard], bosses)[0]?.difficulty).toBe("HARD");
  });

  it("falls back to the key when the catalog has no name for the boss", () => {
    const runs = runsFromParties([party("1", "mystery", [mine])], bosses);
    expect(runs[0]?.bossName).toBe("mystery");
  });

  it("marks an untimed config, so its half hour is not read as measured", () => {
    const [run] = runsFromParties([party("1", "lotus", [mine, chris])], bosses);
    expect(run?.minutes).toBe(DEFAULT_MINUTES);
    expect(run?.assumed).toBe(true);
  });

  // The two are the same claim if the flag is dropped, which is the whole reason it exists.
  it("does not call a timed half hour an assumption", () => {
    const [run] = runsFromParties([party("1", "lotus", [mine, chris], DEFAULT_MINUTES)], bosses);
    expect(run?.assumed).toBe(false);
  });

  it("takes a party at its word when it says a boss costs it nothing", () => {
    const [run] = runsFromParties([party("1", "lotus", [mine, chris], 0)], bosses);
    expect(run?.minutes).toBe(0);
    expect(run?.assumed).toBe(false);
  });

  // Two characters of yours on the same boss are two paces, which is why the number is not on the
  // boss. A per-boss table could not hold this.
  it("lets two configs for one boss run at different speeds", () => {
    const runs = runsFromParties(
      [party("1", "lotus", [mine, chris], 20), party("2", "lotus", [mine, chris], 35)],
      bosses,
    );
    expect(runs.map((run) => run.minutes)).toEqual([20, 35]);
  });
});

describe("runsFromDrafts", () => {
  const draft = (seats: [string, string][]): DraftRun => ({
    id: "d1",
    bossKey: "lotus",
    bossName: "Lotus",
    minutes: 5,
    seats: seats.map(([character, person]) => ({ character, person })),
  });

  it("identifies a hand-typed person by name, however it was capitalised", () => {
    const runs = runsFromDrafts([
      draft([
        ["Mechy", "Chris"],
        ["Creed", " chris "],
      ]),
    ]);
    expect(runs[0]?.seats.map((s) => s.personId)).toEqual(["chris", "chris"]);
  });

  it("leaves a seat with no person named unattributed", () => {
    expect(runsFromDrafts([draft([["Mechy", ""]])])[0]?.seats[0]?.personId).toBeNull();
  });

  it("drops a row with no character on it, which is an unfilled form", () => {
    expect(
      runsFromDrafts([
        draft([
          ["Mechy", "Chris"],
          ["  ", "Dave"],
        ]),
      ])[0]?.seats,
    ).toHaveLength(1);
  });
});

describe("rosterFromDrafts", () => {
  it("keeps the spelling it was first given", () => {
    const drafts: DraftRun[] = [
      {
        id: "d1",
        bossKey: "lotus",
        bossName: "Lotus",
        minutes: 5,
        seats: [
          { character: "A", person: "Chris" },
          { character: "B", person: "chris" },
          { character: "C", person: "Ann" },
        ],
      },
    ];
    expect(rosterFromDrafts(drafts)).toEqual([
      { id: "ann", name: "Ann" },
      { id: "chris", name: "Chris" },
    ]);
  });
});

describe("personKey", () => {
  it("treats case and padding as typing rather than identity", () => {
    expect(personKey("  Chris ")).toBe(personKey("chris"));
  });
});

describe("runMinutes", () => {
  it("assumes the same half hour for a config nobody has timed", () => {
    expect(runMinutes(null)).toBe(DEFAULT_MINUTES);
  });

  it("honours a zero instead of reading it as untimed", () => {
    expect(runMinutes(0)).toBe(0);
  });
});

describe("parseMinutes", () => {
  it("reads an empty box as untimed rather than as no time at all", () => {
    expect(parseMinutes("")).toEqual({ ok: true, minutes: null });
    expect(parseMinutes("  ")).toEqual({ ok: true, minutes: null });
  });

  it("reads whole minutes, zero included", () => {
    expect(parseMinutes("20")).toEqual({ ok: true, minutes: 20 });
    expect(parseMinutes("0")).toEqual({ ok: true, minutes: 0 });
  });

  // Refusing, not repairing: a 3000 clamped to 600 would order the night by a number nobody typed.
  it("refuses what it cannot read as whole minutes in range", () => {
    for (const text of ["20 mins", "-5", "12.5", "abc", String(MAX_MINUTES + 1)]) {
      expect(parseMinutes(text)).toEqual({ ok: false });
    }
  });

  it("takes the ceiling itself", () => {
    expect(parseMinutes(String(MAX_MINUTES))).toEqual({ ok: true, minutes: MAX_MINUTES });
  });
});

describe("formatDuration", () => {
  it("says minutes, hours and both", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(135)).toBe("2h 15m");
  });
});

describe("planAsText", () => {
  // Built through the real planner rather than a hand-made Plan, so the text is pinned against
  // what the tool actually produces.
  const textFor = (drafts: DraftRun[], minutes: number) => {
    const roster = rosterFromDrafts(drafts);
    const { eligible } = screenRuns(
      runsFromDrafts(drafts),
      roster.map((p) => p.id),
    );
    return planAsText(planNight(eligible, { minutes }).best, roster);
  };

  const R = (id: string, bossName: string, seats: [string, string][]): DraftRun => ({
    id,
    bossKey: id,
    bossName,
    minutes: 30,
    seats: seats.map(([character, person]) => ({ character, person })),
  });

  it("names the mode in the row people copy, so nobody queues the wrong one", () => {
    const hard = { ...party("1", "lotus", [mine, chris]), difficulty: "HARD" };
    const runs = runsFromParties(
      [hard],
      [{ bossKey: "lotus", name: "Lotus", reset: "WEEKLY", iconUrl: null, difficulties: ["HARD"] }],
    );
    const roster = rosterFrom([hard]);
    const { eligible } = screenRuns(
      runs,
      roster.map((p) => p.id),
    );
    const text = planAsText(planNight(eligible, { minutes: 60 }).best, roster);
    expect(text).toMatch(/^Hard Lotus {2,}/m);
  });

  it("is the fenced table and nothing else", () => {
    // The headline, the key and the "Boss" corner all went. What is pasted is a table people read
    // off during the night, and anything above or below it is talking around that table.
    const lines = textFor([R("1", "Lotus", [["Bishop", "You"]])], 60).split("\n");
    expect(lines[0]).toBe("```");
    expect(lines[lines.length - 1]).toBe("```");
    // Exactly one fence at each end, so there is no second block hiding in the middle.
    expect(lines.filter((line) => line === "```")).toHaveLength(2);
  });

  it("says nothing about the plan around the table", () => {
    const text = textFor(
      [
        R("1", "Lotus", [["Bishop", "You"]]),
        R("2", "Damien", [["Kanna", "You"]]),
        R("3", "Lucid", [["Hero", "You"]]),
      ],
      180,
    );
    // A count, a duration and a glyph key were the three things it used to add. The page still
    // says all three, next to the controls that set them.
    expect(text).not.toContain("bosses");
    expect(text).not.toContain("about");
    expect(text).not.toContain("=");
  });

  /** The rows between the fences, which is the table itself. */
  const fenced = (text: string) => {
    const lines = text.split("\n");
    const open = lines.indexOf("```");
    const close = lines.indexOf("```", open + 1);
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    return lines.slice(open + 1, close);
  };

  /** The three-run night the size rule splits Dave's runs across. Rows: Lotus, Damien, Lucid. */
  const SPLIT_NIGHT = [
    R("1", "Lotus", [
      ["Bishop", "You"],
      ["Nightlord", "Dave"],
      ["Shadower", "Erin"],
    ]),
    R("2", "Damien", [
      ["Bishop", "You"],
      ["Shadower", "Erin"],
    ]),
    R("3", "Lucid", [["Nightlord", "Dave"]]),
  ];

  it("heads the columns with people, and leaves the corner empty", () => {
    // Empty and not absent: the header keeps one field per column, so the names land over the
    // characters below them. The corner's width is what indents the first name into place.
    const table = fenced(textFor(SPLIT_NIGHT, 180));
    expect(table[0]).toBe("        Dave       Erin      You");
    expect(table[1]).toBe("Lotus   Nightlord  Shadower  Bishop");
  });

  it("marks somebody sitting a run out with an X", () => {
    // Dave is in the first and last runs and out of the middle one. The night has to run
    // 3-person, 2-person, 1-person for size, which outranks keeping his two runs together, so
    // this is the gap the planner cannot close and the one the X has to show.
    const table = fenced(textFor(SPLIT_NIGHT, 180));
    expect(table[2]).toBe("Damien  X          Shadower  Bishop");
    expect(table[3]).toBe("Lucid   Nightlord  X         X");
  });

  it("gives every row the same columns, so the grid survives being pasted", () => {
    // A missing cell would slide everything after it one column left, and padding makes that
    // silent rather than obvious: the row would still line up, under the wrong names.
    const table = fenced(textFor(SPLIT_NIGHT, 180));
    const widths = table.map((line) => line.split(/ {2,}/).length);
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBe(4);
  });

  it("starts every column at the same character on every row", () => {
    // The whole point of padding over tabs, and the thing a per-row assertion cannot see: a
    // column that begins at character 8 on one row and 12 on the next is the crooked paste.
    const table = fenced(textFor(SPLIT_NIGHT, 180));
    const startsOf = (line: string) =>
      [...line.matchAll(/(?:^| {2,})\S/g)].map((m) => (m.index as number) + m[0].length - 1);

    const body = table.slice(1).map(startsOf);
    expect(new Set(body.map(String)).size).toBe(1);
    expect(body[0]).toEqual([0, 8, 19, 29]);
    // The empty corner means the header has no field of its own. The names still begin exactly
    // where the characters under them do.
    expect(startsOf(table[0] as string)).toEqual([8, 19, 29]);
  });

  it("still uses the marks, it just no longer explains them", () => {
    // The X and the * are what the grid is made of, so dropping the key must not drop these too.
    expect(textFor(SPLIT_NIGHT, 180)).toContain("X");
    expect(
      textFor([R("1", "Lotus", [["Bishop", "You"]]), R("2", "Damien", [["Kanna", "You"]])], 120),
    ).toContain("Kanna*");
  });

  it("marks the character somebody changed to, and no other", () => {
    const table = fenced(
      textFor([R("1", "Lotus", [["Bishop", "You"]]), R("2", "Damien", [["Kanna", "You"]])], 120),
    );
    expect(table[2]).toContain("Kanna*");
    // The first run is not a switch. Logging in is not changing character, so the cell is bare.
    expect(table[1]).not.toContain("Bishop*");
  });

  it("gives no column to somebody who is in no scheduled run", () => {
    // Only one boss fits, and it is not the one Dave is in. His run is named in the leftovers on
    // screen, so a column of nothing but X would be a second telling and a wasted column.
    const text = textFor(
      [R("1", "Lotus", [["Bishop", "You"]]), R("2", "Damien", [["Nightlord", "Dave"]])],
      30,
    );
    expect(text).not.toContain("Dave");
  });

  it("keeps the rows in the order the night runs", () => {
    const table = fenced(
      textFor([R("1", "Lotus", [["Bishop", "You"]]), R("2", "Damien", [["Bishop", "You"]])], 120),
    );
    expect(table[1]).toMatch(/^Lotus {2,}/);
    expect(table[2]).toMatch(/^Damien {2,}/);
  });

  it("calls a boss what the party calls it", () => {
    const text = textFor(
      [
        R("malefic-star", "Malefic Star", [["Bishop", "You"]]),
        R("kalos-the-guardian", "Kalos the Guardian", [["Bishop", "You"]]),
      ],
      120,
    );
    expect(text).toMatch(/^Star {2,}/m);
    expect(text).toMatch(/^Kalos {2,}/m);
    expect(text).not.toContain("Malefic");
    expect(text).not.toContain("Guardian");
  });

  it("keeps the full name for a boss with no shorthand", () => {
    const table = fenced(textFor([R("lotus", "Lotus", [["Bishop", "You"]])], 60));
    expect(table[1]).toBe("Lotus  Bishop");
  });

  it("leaves a name holding a comma alone, since a gutter is what splits a row", () => {
    const table = fenced(textFor([R("1", "Lotus", [["Bishop", "Dave, Jr"]])], 60));
    expect(table[0]).toBe("       Dave, Jr");
  });

  // The failure that would matter: a time in the paste that the page no longer shows, read as a
  // commitment the party never made.
  it("says no time anywhere, not even a tilde on a guessed one", () => {
    const text = textFor(SPLIT_NIGHT, 180);
    expect(text).not.toMatch(/[+-]\d+[:.]\d+/);
    expect(text).not.toContain("~");
  });

  it("says so plainly when there is nothing to paste", () => {
    expect(planAsText({ runs: [], switches: 0, minutes: 0 }, [])).toBe(
      "No bosses fit in the time.",
    );
  });

  it("pads each column to its own widest cell, and the person's name with it", () => {
    const table = fenced(
      textFor(
        [
          R("1", "Lotus", [
            ["Bishop", "You"],
            ["Hero", "Christopher"],
          ]),
        ],
        60,
      ),
    );
    // "Christopher" is wider than the "Hero" beneath it, so the column is the name's width and
    // the character sits flush left in it. The gap after is the same two spaces as every other.
    expect(table[0]).toBe("       Christopher  You");
    expect(table[1]).toBe("Lotus  Hero         Bishop");
  });

  it("never pads a row out past its last cell", () => {
    // Trailing spaces are invisible in a chat window and not in a diff or a text field, so a
    // paste that ends in eleven of them looks like a bug in the tool that made it.
    const table = fenced(textFor(SPLIT_NIGHT, 180));
    expect(table.every((line) => line === line.trimEnd())).toBe(true);
  });

  it("keeps a name with a tab in it from knocking the columns crooked", () => {
    // A tab is one character wide to padEnd and eight on screen, so leaving it in would space the
    // column correctly and draw it wrong.
    const table = fenced(textFor([R("1", "Lotus", [["Bishop", "Dave\tJr"]])], 60));
    expect(table[0]).toBe("       Dave Jr");
  });

  /** The same night, copied down to the runs named. See planAsText's `only`. */
  const partTextFor = (drafts: DraftRun[], minutes: number, only: string[]) => {
    const roster = rosterFromDrafts(drafts);
    const { eligible } = screenRuns(
      runsFromDrafts(drafts),
      roster.map((p) => p.id),
    );
    return planAsText(planNight(eligible, { minutes }).best, roster, new Set(only));
  };

  it("copies part of the night as the same table with fewer rows", () => {
    const table = fenced(partTextFor(SPLIT_NIGHT, 180, ["1", "2"]));
    expect(table).toEqual([
      "        Dave       Erin      You",
      "Lotus   Nightlord  Shadower  Bishop",
      "Damien  X          Shadower  Bishop",
    ]);
  });

  it("keeps the rows in the order the night runs them, not the order they were dragged", () => {
    expect(partTextFor(SPLIT_NIGHT, 180, ["3", "1"])).toBe(
      partTextFor(SPLIT_NIGHT, 180, ["1", "3"]),
    );
  });

  it("drops the column of somebody who is in none of the rows copied", () => {
    // Damien is You and Erin. Dave's column would be one X under a name, which reads as a person
    // sitting out a night they are not in, and makes the shorter paste the wider one.
    const table = fenced(partTextFor(SPLIT_NIGHT, 180, ["2"]));
    expect(table).toEqual(["        Erin      You", "Damien  Shadower  Bishop"]);
  });

  it("repads the columns to what the rows copied actually hold", () => {
    // "Nightlord" is the widest cell in Dave's column and it is on Lotus, so a copy of Lucid alone
    // that kept the full night's widths would be a table indented for a row that is not there.
    const table = fenced(partTextFor(SPLIT_NIGHT, 180, ["3"]));
    expect(table).toEqual(["       Dave", "Lucid  Nightlord"]);
  });
});

describe("planGrid", () => {
  const R = (id: string, bossName: string, seats: [string, string][]): DraftRun => ({
    id,
    bossKey: id,
    bossName,
    minutes: 30,
    seats: seats.map(([character, person]) => ({ character, person })),
  });

  const gridFor = (drafts: DraftRun[], minutes: number) => {
    const roster = rosterFromDrafts(drafts);
    const { eligible } = screenRuns(
      runsFromDrafts(drafts),
      roster.map((p) => p.id),
    );
    return planGrid(planNight(eligible, { minutes }).best, roster);
  };

  it("gives every row a cell per person, whether or not they are in the run", () => {
    const { people, rows } = gridFor(
      [
        R("1", "Lotus", [
          ["Bishop", "You"],
          ["Nightlord", "Dave"],
        ]),
        R("2", "Damien", [["Bishop", "You"]]),
      ],
      120,
    );
    expect(people.map((person) => person.name)).toEqual(["Dave", "You"]);
    expect(rows.every((row) => row.cells.length === people.length)).toBe(true);
  });

  it("empties the cell of somebody sitting the run out, rather than dropping it", () => {
    const { rows } = gridFor(
      [
        R("1", "Lotus", [
          ["Bishop", "You"],
          ["Nightlord", "Dave"],
        ]),
        R("2", "Damien", [["Bishop", "You"]]),
      ],
      120,
    );
    // Dave is the first column, and the second run is not his.
    expect(rows[1]?.cells[0]).toEqual({ character: null, switched: false });
  });

  it("flags the cell somebody changed character to, and not the run before it", () => {
    const { rows } = gridFor(
      [R("1", "Lotus", [["Bishop", "You"]]), R("2", "Damien", [["Kanna", "You"]])],
      120,
    );
    expect(rows[0]?.cells[0]).toEqual({ character: "Bishop", switched: false });
    expect(rows[1]?.cells[0]).toEqual({ character: "Kanna", switched: true });
  });

  it("holds no column for somebody the plan never uses", () => {
    const { people } = gridFor(
      [R("1", "Lotus", [["Bishop", "You"]]), R("2", "Damien", [["Nightlord", "Dave"]])],
      30,
    );
    expect(people.map((person) => person.name)).toEqual(["You"]);
  });
});

describe("parseOffset", () => {
  it("takes all four spellings, because all four get typed", () => {
    expect(parseOffset("3.5")).toBe(210);
    expect(parseOffset("+3.5")).toBe(210);
    expect(parseOffset("3:30")).toBe(210);
    expect(parseOffset("+3:30")).toBe(210);
  });

  it("takes a bare hour, and a decimal that is not a half", () => {
    expect(parseOffset("3")).toBe(180);
    expect(parseOffset("2.25")).toBe(135);
    expect(parseOffset(" +2 ")).toBe(120);
  });

  it("takes the hours before reset, which is half of what gets said", () => {
    expect(parseOffset("-2")).toBe(-120);
    expect(parseOffset("-0:30")).toBe(-30);
    expect(parseOffset("-1.5")).toBe(-90);
    expect(parseOffset("-12:00")).toBe(-720);
  });

  it("refuses past twelve either way, rather than wrapping it to the far side", () => {
    // "+25" is a typo far more often than it is half past one tomorrow, and wrapping it silently
    // to "+1" is the confident wrong number. Refusing makes it a question.
    expect(parseOffset("+25:30")).toBeNull();
    expect(parseOffset("+13")).toBeNull();
    expect(parseOffset("-13")).toBeNull();
  });

  it("refuses what is not a time rather than guessing at it", () => {
    for (const bad of ["", "+", "-", "soon", "3:60", "99", "3:5", "--2"]) {
      expect(parseOffset(bad)).toBeNull();
    }
  });
});

describe("formatOffset", () => {
  it("writes it on the clock, not as the decimal it was typed as", () => {
    expect(formatOffset(210)).toBe("+3:30");
    expect(formatOffset(0)).toBe("+0:00");
  });

  it("says the hours before reset as before, not as almost a whole day after", () => {
    // The bug this replaced: a quarter to midnight UTC drew "+23:45", and a night defaulting to
    // the next half hour from it started at "+24:00" and finished at "+28:00".
    expect(formatOffset(-15)).toBe("-0:15");
    expect(formatOffset(1425)).toBe("-0:15");
    expect(formatOffset(1440)).toBe("+0:00");
    expect(formatOffset(1680)).toBe("+4:00");
  });

  it("pads the minutes, so a column of times is a column", () => {
    expect(formatOffset(125)).toBe("+2:05");
    expect(formatOffset(-125)).toBe("-2:05");
  });

  it("gives noon UTC one spelling, and it is the negative one", () => {
    expect(formatOffset(720)).toBe("-12:00");
    expect(formatOffset(-720)).toBe("-12:00");
  });

  it("survives the round trip for every time a box can hold", () => {
    for (let minutes = -720; minutes < 720; minutes += 5) {
      expect(parseOffset(formatOffset(minutes))).toBe(minutes);
    }
  });
});

// The spelling a party actually uses. It may only ever SHORTEN a time, never round one, which is
// the whole reason both spellings exist.
describe("formatOffsetShort", () => {
  it("says the half hours the way they get said out loud", () => {
    expect(formatOffsetShort(240)).toBe("+4");
    expect(formatOffsetShort(270)).toBe("+4.5");
    expect(formatOffsetShort(0)).toBe("+0");
    expect(formatOffsetShort(-90)).toBe("-1.5");
    expect(formatOffsetShort(-720)).toBe("-12");
  });

  it("falls back to the clock rather than rounding a time that is not on the half hour", () => {
    // The failure this exists to prevent: a run stack landing on +4:55 drawn as "+5", which is a
    // five minute lie on the one number somebody turns up for.
    expect(formatOffsetShort(295)).toBe("+4:55");
    expect(formatOffsetShort(247)).toBe("+4:07");
    expect(formatOffsetShort(-125)).toBe("-2:05");
  });

  it("never says a time it was not given", () => {
    for (let minutes = -720; minutes < 720; minutes += 1) {
      expect(parseOffset(formatOffsetShort(minutes))).toBe(minutes);
    }
  });

  it("gives noon UTC the same one spelling the long form does", () => {
    expect(formatOffsetShort(720)).toBe("-12");
    expect(formatOffsetShort(-720)).toBe("-12");
  });
});

describe("runTicks", () => {
  const at = (startsAt: number, approx = false): RunTime => ({
    at: "",
    startsAt,
    approx,
    waitingFor: [],
  });

  it("opens a rule on the first run of each half hour and not again inside it", () => {
    expect(runTicks([at(240), at(255), at(270), at(300)])).toEqual(["+4", null, "+4.5", "+5"]);
  });

  it("files a run under the half hour it starts in, never the nearest one", () => {
    // +4:55 is four minutes short of +5 and belongs under +4.5 regardless.
    expect(runTicks([at(295)])).toEqual(["+4.5"]);
  });

  it("skips a half hour nobody starts in rather than drawing an empty rule", () => {
    // A 90 minute run swallows two blocks whole. The row's own length is what says so.
    expect(runTicks([at(240), at(330)])).toEqual(["+4", "+5.5"]);
  });

  it("marks a rule reached by adding up guesses, the same as the time was", () => {
    expect(runTicks([at(240), at(270, true)])).toEqual(["+4", "~+4.5"]);
  });

  it("draws nothing for a night that is not on the clock", () => {
    expect(runTicks([])).toEqual([]);
  });
});

describe("offsetNow", () => {
  it("is where now sits against reset, which is 00:00 UTC", () => {
    expect(offsetNow(Date.UTC(2026, 7, 5, 0, 0))).toBe(0);
    expect(offsetNow(Date.UTC(2026, 7, 5, 3, 30))).toBe(210);
  });

  it("counts the last hours of the day down to reset rather than up from it", () => {
    expect(offsetNow(Date.UTC(2026, 7, 5, 23, 45))).toBe(-15);
    expect(offsetNow(Date.UTC(2026, 7, 5, 22, 0))).toBe(-120);
  });

  it("drops the seconds, so two reads in one render agree", () => {
    expect(offsetNow(Date.UTC(2026, 7, 5, 3, 30, 59))).toBe(210);
  });
});

describe("nextHalfHour", () => {
  it("rounds up to the next half hour", () => {
    expect(nextHalfHour(0)).toBe(0);
    expect(nextHalfHour(1)).toBe(30);
    expect(nextHalfHour(31)).toBe(60);
  });

  it("starts the night at reset rather than a day past it", () => {
    // The bug, end to end. A quarter to midnight UTC is -0:15, whose next half hour is reset
    // itself. Counting up from reset it was 1425, whose next half hour was 1440, drawn "+24:00",
    // and a two hour night off that finished at "+26:00".
    const quarterTo = offsetNow(Date.UTC(2026, 7, 5, 23, 45));
    expect(formatOffset(nextHalfHour(quarterTo))).toBe("+0:00");
    expect(formatOffset(nextHalfHour(quarterTo) + 120)).toBe("+2:00");
  });

  it("stays put on a time that is already a half hour", () => {
    expect(nextHalfHour(-30)).toBe(-30);
    expect(formatOffset(nextHalfHour(-30))).toBe("-0:30");
  });
});

describe("spanBetween", () => {
  it("is the plain difference for a night that stays one side of reset", () => {
    expect(spanBetween(120, 240)).toBe(120);
    expect(spanBetween(-120, -60)).toBe(60);
  });

  it("runs forwards through reset instead of backwards around the clock", () => {
    // A night from -1:00 to +1:00 is two hours, not minus twenty two.
    expect(spanBetween(-60, 60)).toBe(120);
    expect(spanBetween(660, -540)).toBe(240);
  });

  it("reads its own drawn end back as the night it drew", () => {
    // The page shows the end as formatOffset(start + budget) and lets you type in that box, so
    // what it draws has to parse back to what it drew. Across the wrap it did not: +11:00 with
    // four hours draws "-9:00", and subtracting gave a night of minus twenty hours, which clamped
    // to zero and emptied the plan the moment you touched the box.
    const start = parseOffset("+11:00") as number;
    const drawn = formatOffset(start + 240);
    expect(drawn).toBe("-9:00");
    expect(spanBetween(start, parseOffset(drawn) as number)).toBe(240);
  });

  it("refuses an end typed before the start rather than calling it most of a day", () => {
    expect(spanBetween(120, 60)).toBe(0);
    expect(spanBetween(0, -30)).toBe(0);
  });

  it("is nothing when the two are the same time", () => {
    expect(spanBetween(120, 120)).toBe(0);
  });
});

describe("runTimes", () => {
  const ME = { id: "me", name: "You" };
  const DAVE = { id: "dave", name: "Dave" };

  const E = (
    id: string,
    minutes: number,
    assumed: boolean,
    seats: [string, string][],
  ): EligibleRun => ({
    id,
    bossKey: id,
    bossName: id,
    difficulty: null,
    minutes,
    assumed,
    seats: seats.map(([character, personId]) => ({ character, personId })),
  });

  it("counts from the night's start, on the reset clock", () => {
    const { best } = planNight(
      [E("a", 30, false, [["Bishop", "me"]]), E("b", 30, false, [["Bishop", "me"]])],
      { minutes: 120 },
    );
    expect(runTimes(best, [ME], 120).map((time) => time.at)).toEqual(["+2:00", "+2:30"]);
  });

  it("marks a time it only reached by adding up a guess", () => {
    const { best } = planNight(
      [E("a", 30, true, [["Bishop", "me"]]), E("b", 30, false, [["Bishop", "me"]])],
      { minutes: 120 },
    );
    const times = runTimes(best, [ME], 120);
    // The first is the start that was typed in. The second is that plus a guessed half hour.
    expect(times[0]?.approx).toBe(false);
    expect(times[1]?.approx).toBe(true);
  });

  it("stops guessing at a time somebody stated out loud", () => {
    // Both runs are the same size on purpose. Party size outranks the clock, so a two-seat run
    // beside a one-seat one is ordered on size and this stops testing what it says it tests.
    const { best } = planNight(
      [
        E("a", 30, true, [
          ["Bishop", "me"],
          ["Night", "erin"],
        ]),
        E("b", 30, true, [
          ["Kanna", "me"],
          ["Hero", "dave"],
        ]),
      ],
      { minutes: 180, available: { dave: { from: 60 } } },
    );
    const times = runTimes(best, [ME, DAVE, { id: "erin", name: "Erin" }], 120);

    expect(times[1]?.at).toBe("+3:00");
    // Both runs are guesses, but the night sat until Dave said he was free, so the clock is his
    // number rather than a total of theirs.
    expect(times[1]?.approx).toBe(false);
    expect(times[1]?.waitingFor.map((person) => person.name)).toEqual(["Dave"]);
  });
});
