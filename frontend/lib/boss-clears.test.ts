import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bandCount,
  bandFill,
  cadenceLabel,
  cellState,
  cellStateLabel,
  clearOfCell,
  clearProgress,
  clearStateLabel,
  columnFullyCleared,
  formatPeriod,
  formatWeekStart,
  indexClears,
  indexSkips,
  nextClear,
  nextSkips,
  bossBands,
  progressLabel,
  progressMark,
  weekEndExclusive,
  weekLabel,
  rowFullyCleared,
  rowNobodyRuns,
} from "./boss-clears";
import type { BossClear } from "@/types/boss";

const clear = (bossKey: string, cleared: boolean): BossClear => ({
  bossKey,
  cleared,
  periodStart: "2026-07-16",
  capturedAt: "2026-07-18T12:00:00Z",
});

describe("nextClear", () => {
  it("ticks an unreported cell to cleared rather than to not-cleared", () => {
    // The first click on a cell nothing has been said about is somebody saying they killed it.
    // Writing "not cleared" instead would put a claim on screen that nobody made.
    expect(nextClear(null)).toBe(true);
  });

  it("ticks and un-ticks between the two answers", () => {
    expect(nextClear(false)).toBe(true);
    expect(nextClear(true)).toBe(false);
  });

  it("never writes its way back to unreported", () => {
    // Two answers out of three states, on purpose: a click always leaves an answer. Only a capture
    // or a new period puts a cell back to having said nothing. The matrix and the party card share
    // this function so they cannot drift on it.
    for (const from of [null, false, true]) {
      expect(typeof nextClear(from)).toBe("boolean");
    }
  });
});

describe("clearOfCell", () => {
  it("keeps unseen apart from not-cleared when a cell state becomes a clear", () => {
    expect(clearOfCell("unseen")).toBeNull();
    expect(clearOfCell("pending")).toBe(false);
    expect(clearOfCell("cleared")).toBe(true);
  });
});

describe("cellState", () => {
  it("separates a boss that was not cleared from one nothing was said about", () => {
    // The distinction the whole matrix rests on. A planner capture reports every boss the
    // character runs, so cleared=false is real information: it was seen, and it is not done.
    // A boss with no row at all was never reported, and calling that "not cleared" invents an
    // answer for a character whose planner may simply never have been captured.
    const clears = indexClears([clear("lotus", true), clear("damien", false)]);

    expect(cellState(clears, "lotus")).toBe("cleared");
    expect(cellState(clears, "damien")).toBe("pending");
    expect(cellState(clears, "lucid")).toBe("unseen");
  });

  it("treats a character with no clears at all as unseen, not as cleared nothing", () => {
    expect(cellState(indexClears(undefined), "lotus")).toBe("unseen");
    expect(cellState(indexClears([]), "lotus")).toBe("unseen");
    expect(cellState(undefined, "lotus")).toBe("unseen");
  });

  it("separates a boss nobody has answered for from one this character never runs", () => {
    // The reason the fourth state exists. Both are a missing clear row, and before the mark they
    // drew the same dash, so a boss only one character runs read as a roster that was behind on it.
    const clears = indexClears([clear("lotus", true)]);
    const skips = new Set(["jupiter"]);

    expect(cellState(clears, "jupiter", skips)).toBe("skipped");
    expect(cellState(clears, "lucid", skips)).toBe("unseen");
  });

  it("lets a clear outrank the mark, which is how a one-off run shows up", () => {
    // A character who does not normally run Jupiter but did this week. The tick shows, and the
    // routine is untouched, so next period the cell is back to "doesn't run". Nothing rewrites
    // what the user said about the character on the strength of one week.
    const clears = indexClears([clear("jupiter", true)]);

    expect(cellState(clears, "jupiter", new Set(["jupiter"]))).toBe("cleared");
  });

  it("keeps the mark over a pending row, since a planner listing a boss is not a claim to run it", () => {
    const clears = indexClears([clear("jupiter", false)]);

    expect(cellState(clears, "jupiter", new Set(["jupiter"]))).toBe("skipped");
  });
});

describe("clearStateLabel", () => {
  it("names the three states, and never calls silence a clear either way", () => {
    expect(clearStateLabel(true)).toBe("cleared");
    expect(clearStateLabel(false)).toBe("not cleared");
    expect(clearStateLabel(null)).toBe("not reported");
  });

  it("says the same words for the matrix's cell states", () => {
    expect(cellStateLabel("cleared")).toBe("cleared");
    expect(cellStateLabel("pending")).toBe("not cleared");
    expect(cellStateLabel("unseen")).toBe("not reported");
    expect(cellStateLabel("skipped")).toBe("doesn't run");
  });

  it("does not turn a boss nobody runs into an answer about clearing it", () => {
    // "doesn't run" is not a third answer to "was it cleared", it is the question not applying.
    // Calling it not-cleared is what put fifteen characters behind on Jupiter.
    expect(clearOfCell("skipped")).toBeNull();
  });
});

// The party view once said "done" and "still to do" for the states the filter tabs called
// "Cleared" and "Not Cleared". Nothing broke, so nothing caught it. The words are pinned here
// because they are the only thing that says which of three states a tick is in.
describe("the views name clear states through one place", () => {
  const source = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");
  // These draw a state themselves, so they must take the words from boss-clears.
  const namers = [
    ["components", "party-card.tsx"],
    ["components", "boss-matrix.tsx"],
    ["components", "planner-dock.tsx"],
  ];
  // Party View draws none of its own: every state on it is a row's, through PartyCard. What it may
  // still not do is spell one by hand, which is what the second assertion is for.
  const files = [...namers, ["app", "bosses", "parties", "page.tsx"]];

  for (const parts of namers) {
    it(`${parts.at(-1)} labels states from boss-clears`, () => {
      expect(source(...parts)).toMatch(/\b(clearStateLabel|cellStateLabel)\(/);
    });
  }

  for (const parts of files) {
    it(`${parts.at(-1)} does not spell a state by hand`, () => {
      expect(source(...parts)).not.toMatch(/still to do|not yet cleared/);
    });
  }
});

describe("rowFullyCleared", () => {
  // The matrix dims a row on this, and a dimmed row is read as "nothing left to do". Every case
  // below is one where saying true would hide a run somebody still has to make.
  const roster = ["ann", "bob", "cass"];
  const index = (entries: Record<string, BossClear[]>) =>
    new Map(Object.entries(entries).map(([id, clears]) => [id, indexClears(clears)]));

  it("is true only when every character has cleared it", () => {
    const byCharacter = index({
      ann: [clear("lotus", true)],
      bob: [clear("lotus", true)],
      cass: [clear("lotus", true)],
    });

    expect(rowFullyCleared(byCharacter, roster, "lotus")).toBe(true);
  });

  it("is false while one character has it reported and not done", () => {
    const byCharacter = index({
      ann: [clear("lotus", true)],
      bob: [clear("lotus", false)],
      cass: [clear("lotus", true)],
    });

    expect(rowFullyCleared(byCharacter, roster, "lotus")).toBe(false);
  });

  it("does not count silence as a clear", () => {
    // cass ran a planner capture that mentioned another boss, so there is no lotus row for her.
    // She has not said she cleared it, and the row must not claim she did.
    const byCharacter = index({
      ann: [clear("lotus", true)],
      bob: [clear("lotus", true)],
      cass: [clear("damien", true)],
    });

    expect(rowFullyCleared(byCharacter, roster, "lotus")).toBe(false);
  });

  it("does not count a character with no capture at all as a clear", () => {
    const byCharacter = index({ ann: [clear("lotus", true)], bob: [clear("lotus", true)] });

    expect(rowFullyCleared(byCharacter, roster, "lotus")).toBe(false);
  });

  it("is false for an empty roster rather than vacuously true", () => {
    // every() on nothing is true, which would dim every row on a page with no characters on it.
    expect(rowFullyCleared(new Map(), [], "lotus")).toBe(false);
  });

  it("ignores the characters who do not run it, which is the point of saying so", () => {
    // Only ann runs Jupiter. Before the mark this row could never dim, because bob and cass sat on
    // a dash forever, so the one row with real work left looked like the fifteen without any.
    const byCharacter = index({ ann: [clear("jupiter", true)] });
    const skips = indexSkips({ bob: ["jupiter"], cass: ["jupiter"] });

    expect(rowFullyCleared(byCharacter, roster, "jupiter", skips)).toBe(true);
  });

  it("still counts a runner who has said nothing", () => {
    // cass does not run it, but bob does and has not answered. Dimming here would hide bob's run.
    const byCharacter = index({ ann: [clear("jupiter", true)] });
    const skips = indexSkips({ cass: ["jupiter"] });

    expect(rowFullyCleared(byCharacter, roster, "jupiter", skips)).toBe(false);
  });

  it("is false when nobody runs it, rather than calling an untouched boss done", () => {
    // Vacuously true otherwise. "Everyone who runs it is done" and "nobody runs it" both quieten
    // the row, but they are different facts and only one of them is a week's work being finished.
    const skips = indexSkips({ ann: ["jupiter"], bob: ["jupiter"], cass: ["jupiter"] });

    expect(rowFullyCleared(new Map(), roster, "jupiter", skips)).toBe(false);
    expect(rowNobodyRuns(roster, "jupiter", skips)).toBe(true);
  });
});

describe("columnFullyCleared", () => {
  // The matrix dims a character's sprite on this, and a dimmed sprite is read as "they are done
  // for the week". Every case below is one where saying true would hide a run they still owe.
  const bossOf = (bossKey: string, reset = "WEEKLY") => ({
    bossKey,
    name: bossKey,
    reset,
    iconUrl: null,
    difficulties: [],
  });
  const bosses = [bossOf("lotus"), bossOf("damien"), bossOf("zakum", "DAILY")];

  it("is true when every boss they run is cleared", () => {
    const clears = indexClears([clear("lotus", true), clear("damien", true), clear("zakum", true)]);

    expect(columnFullyCleared(clears, bosses)).toBe(true);
  });

  it("is false while one is reported and not done", () => {
    const clears = indexClears([
      clear("lotus", true),
      clear("damien", false),
      clear("zakum", true),
    ]);

    expect(columnFullyCleared(clears, bosses)).toBe(false);
  });

  it("does not count silence as a clear", () => {
    // The capture mentioned two of the three, so nobody has said anything about Damien.
    const clears = indexClears([clear("lotus", true), clear("zakum", true)]);

    expect(columnFullyCleared(clears, bosses)).toBe(false);
  });

  it("does not dim a character who has reported nothing at all", () => {
    // Every character on a Thursday morning. An uncaptured week is unanswered, not finished.
    expect(columnFullyCleared(undefined, bosses)).toBe(false);
  });

  it("holds a finished week open while a daily is outstanding", () => {
    // The sprite is one figure over every band, so the weekly being done is not the answer.
    const clears = indexClears([clear("lotus", true), clear("damien", true)]);

    expect(columnFullyCleared(clears, bosses)).toBe(false);
    expect(
      columnFullyCleared(
        clears,
        bosses.filter((b) => b.reset === "WEEKLY"),
      ),
    ).toBe(true);
  });

  it("ignores the bosses they do not run, which is the point of saying so", () => {
    const clears = indexClears([clear("lotus", true)]);

    expect(columnFullyCleared(clears, bosses, new Set(["damien", "zakum"]))).toBe(true);
  });

  it("is false for a character who runs nothing, rather than vacuously true", () => {
    // every() on nothing is true, which would dim a character who has never been given a routine.
    expect(columnFullyCleared(undefined, bosses, new Set(["lotus", "damien", "zakum"]))).toBe(
      false,
    );
    expect(columnFullyCleared(undefined, [])).toBe(false);
  });
});

describe("rowNobodyRuns", () => {
  const roster = ["ann", "bob", "cass"];

  it("is false while one character still runs it", () => {
    expect(rowNobodyRuns(roster, "jupiter", indexSkips({ bob: ["jupiter"] }))).toBe(false);
  });

  it("is false for an empty roster, like rowFullyCleared", () => {
    expect(rowNobodyRuns([], "jupiter", indexSkips({}))).toBe(false);
  });

  it("is false when nothing has been marked at all", () => {
    // The default state of every account. Nobody having said anything is not everybody opting out.
    expect(rowNobodyRuns(roster, "jupiter", undefined)).toBe(false);
  });
});

describe("clearProgress", () => {
  it("counts the clears against the bosses that are run", () => {
    expect(clearProgress(["cleared", "cleared", "pending", "skipped"], true)).toEqual({
      cleared: 2,
      total: 3,
    });
  });

  it("counts a boss nobody has captured as one still to run", () => {
    // The trap this whole function exists around. Every period starts with every cell unseen, so
    // dropping them from the denominator would open each Thursday at 0/0, and 0/0 is a week with
    // nothing left in it. Overstating the work is the only safe direction to be wrong.
    expect(clearProgress(["unseen", "unseen", "unseen"], true)).toEqual({ cleared: 0, total: 3 });
  });

  it("keeps a routine off the denominator, which is the return on marking one", () => {
    const runsFour = clearProgress(
      ["cleared", "cleared", "cleared", "cleared", "skipped", "skipped"],
      true,
    );
    expect(runsFour).toEqual({ cleared: 4, total: 4 });
    expect(progressMark(runsFour)).toBe("4/4");
  });

  it("gives no denominator when the routine is not known, rather than counting every boss", () => {
    // A past week is served without routine marks, so the same states arrive with nothing marked
    // skipped. Reaching a denominator by that accident would state a past week's target as
    // confidently as a live one, and it would be the wrong number.
    expect(clearProgress(["cleared", "pending", "unseen"], false)).toEqual({
      cleared: 1,
      total: null,
    });
  });

  it("is empty, not complete, for a character who runs nothing in the band", () => {
    const runsNothing = clearProgress(["skipped", "skipped"], true);
    expect(runsNothing).toEqual({ cleared: 0, total: 0 });
    // 0/0 is a met target. This is the absence of one, and it says so in the matrix's own word.
    expect(progressMark(runsNothing)).toBe("·");
    expect(progressLabel(runsNothing)).toBe("none to run");
  });

  it("counts nothing at all as nothing to run", () => {
    expect(clearProgress([], true)).toEqual({ cleared: 0, total: 0 });
  });
});

describe("progressLabel", () => {
  it("says what the number is, since a heading has room for the word", () => {
    expect(progressLabel({ cleared: 8, total: 12 })).toBe("8/12 cleared");
  });

  it("drops the denominator without dropping the count", () => {
    expect(progressLabel({ cleared: 12, total: null })).toBe("12 cleared");
    expect(progressMark({ cleared: 12, total: null })).toBe("12");
  });
});

describe("bandCount", () => {
  it("drops the word, the band's name being on the line above it", () => {
    expect(bandCount({ cleared: 8, total: 12 })).toBe("8/12");
    expect(bandCount({ cleared: 12, total: null })).toBe("12");
  });

  it("says an empty band in words, having no column head to read a glyph against", () => {
    expect(bandCount({ cleared: 0, total: 0 })).toBe("none to run");
  });
});

describe("bandFill", () => {
  it("is the fraction, said as a width", () => {
    expect(bandFill({ cleared: 6, total: 12 }).width).toBe("50%");
    expect(bandFill({ cleared: 17, total: 17 }).width).toBe("100%");
  });

  // The floor under it is 12px, which on the 198px track a band gets reads as about 6%. Anything
  // that took the floor at zero would draw that 6% for a band with no clears in it, contradicting
  // the count on the line above.
  it("refuses the floor to a band with nothing cleared", () => {
    expect(bandFill({ cleared: 0, total: 49 })).toEqual({ width: "0%", nonzero: false });
    expect(bandFill({ cleared: 1, total: 49 }).nonzero).toBe(true);
  });

  it("draws nothing where there is nothing to run, rather than dividing by it", () => {
    expect(bandFill({ cleared: 0, total: 0 })).toEqual({ width: "0%", nonzero: false });
    expect(bandFill({ cleared: 12, total: null })).toEqual({ width: "0%", nonzero: false });
  });
});

describe("formatPeriod", () => {
  it("reads the date as written rather than through a timezone", () => {
    // new Date("2026-07-16") is UTC midnight, so anyone behind UTC would see "15 Jul" for a
    // period that starts on the 16th. The label exists to say which period this is.
    expect(formatPeriod("2026-07-16")).toBe("16 Jul");
    expect(formatPeriod("2026-01-01")).toBe("1 Jan");
    expect(formatPeriod("2026-12-31")).toBe("31 Dec");
  });

  it("passes anything it cannot parse straight through rather than inventing a date", () => {
    expect(formatPeriod("")).toBe("");
    expect(formatPeriod("not-a-date")).toBe("not-a-date");
    expect(formatPeriod("2026-13-01")).toBe("2026-13-01");
  });
});

describe("cadenceLabel", () => {
  it("says the cadence without shouting it", () => {
    expect(cadenceLabel("WEEKLY")).toBe("Weekly");
    expect(cadenceLabel("MONTHLY")).toBe("Monthly");
    expect(cadenceLabel("DAILY")).toBe("Daily");
  });
});

describe("formatWeekStart", () => {
  it("reads the date as written rather than through a timezone", () => {
    expect(formatWeekStart("2026-07-16")).toBe("July 16");
    expect(formatWeekStart("2026-01-01")).toBe("January 1");
    expect(formatWeekStart("2026-12-31")).toBe("December 31");
  });

  it("passes anything it cannot parse straight through rather than inventing a date", () => {
    expect(formatWeekStart("not-a-date")).toBe("not-a-date");
    expect(formatWeekStart("")).toBe("");
    expect(formatWeekStart("2026-13-01")).toBe("2026-13-01");
  });
});

describe("weekEndExclusive", () => {
  it("steps to the next reset day", () => {
    expect(weekEndExclusive("2026-07-16")).toBe("2026-07-23");
    expect(weekEndExclusive("2026-07-23")).toBe("2026-07-30");
  });

  it("crosses a month, a year and a leap day without a calendar of its own", () => {
    expect(weekEndExclusive("2026-07-30")).toBe("2026-08-06");
    expect(weekEndExclusive("2026-12-31")).toBe("2027-01-07");
    expect(weekEndExclusive("2028-02-24")).toBe("2028-03-02");
  });

  it("stays on the day it was given rather than the viewer's", () => {
    // The pin for the UTC arithmetic: a local-time step lands a day out for anyone behind UTC, and
    // this label decides which configs a past week admits.
    const tz = process.env.TZ;
    process.env.TZ = "Pacific/Auckland";
    try {
      expect(weekEndExclusive("2026-07-16")).toBe("2026-07-23");
    } finally {
      process.env.TZ = tz;
    }
  });

  it("passes anything it cannot parse straight through rather than inventing a week", () => {
    expect(weekEndExclusive("not-a-date")).toBe("not-a-date");
    expect(weekEndExclusive("")).toBe("");
  });
});

describe("weekLabel", () => {
  it("names the week in progress on the live view", () => {
    // weekStart is null when nothing has been stepped to, and then the week being shown is the
    // one in progress. Party View only ever has this case.
    expect(weekLabel({ weekStart: null, currentWeekStart: "2026-07-23" })).toBe("Week of July 23");
  });

  it("names the week stepped to, not the one in progress", () => {
    expect(weekLabel({ weekStart: "2026-07-16", currentWeekStart: "2026-07-23" })).toBe(
      "Week of July 16",
    );
  });

  it("is one function so two pages cannot word the same week differently", () => {
    // The stepper on the Individual View and the standing label on Party View both read this.
    const view = { weekStart: null, currentWeekStart: "2026-01-01" };
    expect(weekLabel(view)).toBe(weekLabel({ ...view }));
    expect(weekLabel(view)).toBe("Week of January 1");
  });
});

// The routine PUT sends the whole set, so a tick queued behind another has to build on it. Two ticks
// derived from the same render would have the second undo the first, and nothing on screen would say
// so: the page would draw the set it asked for while the server held one boss less.
describe("nextSkips", () => {
  it("un-ticks a boss into the set", () => {
    expect(Array.from(nextSkips(null, new Set(), "lotus", false))).toEqual(["lotus"]);
  });

  it("ticks one back out of it", () => {
    expect(Array.from(nextSkips(null, new Set(["lotus", "damien"]), "lotus", true))).toEqual([
      "damien",
    ]);
  });

  it("builds on the tick still in flight, not on the set on screen", () => {
    const onScreen = new Set<string>();
    const inFlight = nextSkips(null, onScreen, "lotus", false);
    const second = nextSkips(inFlight, onScreen, "damien", false);
    expect(Array.from(second).sort()).toEqual(["damien", "lotus"]);
  });

  it("goes back to the set on screen once nothing is outstanding", () => {
    // Which is what a refusal and a change of character both do: the server's set is the truth.
    expect(Array.from(nextSkips(null, new Set(["lotus"]), "damien", false)).sort()).toEqual([
      "damien",
      "lotus",
    ]);
  });

  it("does not touch what it was given", () => {
    const asked = new Set(["lotus"]);
    nextSkips(asked, new Set(), "damien", false);
    expect(Array.from(asked)).toEqual(["lotus"]);
  });
});

/**
 * The band figures the head row draws, end to end.
 *
 * A past week used to be given no denominator, on the grounds that the routine describes today.
 * The routine is now served for a past week as it stood at the END of that week (bossSkipsFor
 * takes an asOf), so there is a target and the bar can be drawn. What this pins is that the two
 * readings agree: the same skips that leave the denominator are the ones the cells draw as not
 * run, and a band's total is the sum of its characters'.
 */
describe("bossBands, over a past week", () => {
  const WEEKLY = {
    bossKey: "lotus",
    name: "Lotus",
    reset: "WEEKLY",
    iconUrl: null,
    difficulties: [],
  };
  const OTHER = {
    bossKey: "damien",
    name: "Damien",
    reset: "WEEKLY",
    iconUrl: null,
    difficulties: [],
  };
  const MONTHLY = {
    bossKey: "bm",
    name: "Black Mage",
    reset: "MONTHLY",
    iconUrl: null,
    difficulties: [],
  };
  const bosses = [MONTHLY, WEEKLY, OTHER];
  const characters = [{ id: "c1", name: "Aria", spriteImgUrl: null }];
  const clearsByCharacter = {
    c1: [{ bossKey: "lotus", cleared: true, periodStart: "2026-08-27", capturedAt: "2026-08-28" }],
  };

  it("measures a past week against the routine it is served with", () => {
    const { bands } = bossBands({
      bosses,
      characters,
      clearsByCharacter,
      skipsByCharacter: { c1: ["damien"] },
      historyWeek: "2026-08-27",
    });

    // Only the weekly band: a week cannot answer for a monthly boss. See the cadence filter.
    expect(bands.map((b) => b.cadence)).toEqual(["WEEKLY"]);
    // Two weekly bosses, one of them not run that week, so the target is one and it was met.
    expect(bands[0]?.progress).toEqual({ cleared: 1, total: 1 });
  });

  it("counts a boss out of the target only when the week was told about it", () => {
    // The same week with no routine served for it. Nothing is skipped, so both bosses count: the
    // week reads 1 of 2 rather than 1 of 1. Understating what was done is the safe direction, and
    // it is the one an un-skipped boss lands in, since nothing records a withdrawal.
    const { bands } = bossBands({
      bosses,
      characters,
      clearsByCharacter,
      skipsByCharacter: {},
      historyWeek: "2026-08-27",
    });

    expect(bands[0]?.progress).toEqual({ cleared: 1, total: 2 });
  });

  it("gives the live week a denominator too, by the same rule", () => {
    const { bands } = bossBands({
      bosses,
      characters,
      clearsByCharacter,
      skipsByCharacter: { c1: ["damien"] },
      historyWeek: null,
    });

    expect(bands.map((b) => b.cadence)).toEqual(["MONTHLY", "WEEKLY"]);
    for (const band of bands) {
      expect(band.progress.total).not.toBeNull();
    }
  });
});
