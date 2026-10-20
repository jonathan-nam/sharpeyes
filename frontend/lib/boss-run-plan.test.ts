import { describe, expect, it } from "vitest";

import {
  bestOf,
  type CandidateRun,
  type EligibleRun,
  type Plan,
  planNight,
  screenRuns,
  tradeOffs,
  withoutRuns,
  withoutRunsByCount,
} from "./boss-run-plan";

function run(
  id: string,
  bossKey: string,
  minutes: number,
  seats: [string, string | null][],
): CandidateRun {
  return {
    id,
    bossKey,
    bossName: bossKey,
    difficulty: null,
    minutes,
    seats: seats.map(([character, personId]) => ({ character, personId })),
  };
}

function eligible(
  id: string,
  bossKey: string,
  minutes: number,
  seats: [string, string][],
): EligibleRun {
  return {
    id,
    bossKey,
    bossName: bossKey,
    difficulty: null,
    minutes,
    seats: seats.map(([character, personId]) => ({ character, personId })),
  };
}

const order = (plan: { runs: { run: { id: string } }[] }) => plan.runs.map((r) => r.run.id);

/** How many unbroken same-character stretches a sequence falls into. */
const blocks = (characters: string[]) =>
  characters.filter((character, i) => character !== characters[i - 1]).length;

describe("screenRuns", () => {
  it("keeps a run whose every seat is somebody who turned up", () => {
    const { eligible: kept, rejected } = screenRuns(
      [
        run("a", "lotus", 10, [
          ["Mechy", "me"],
          ["Creed", "chris"],
        ]),
      ],
      ["me", "chris"],
    );
    expect(kept.map((r) => r.id)).toEqual(["a"]);
    expect(rejected).toEqual([]);
  });

  it("refuses a party holding two characters of the same person", () => {
    const { eligible: kept, rejected } = screenRuns(
      [
        run("a", "lotus", 10, [
          ["Mechy", "me"],
          ["Creed", "chris"],
          ["Dwight", "chris"],
        ]),
      ],
      ["me", "chris"],
    );
    expect(kept).toEqual([]);
    expect(rejected[0]?.reason).toBe("person-twice");
    // Names both of the seats, so the UI can say which pair collided.
    expect(rejected[0]?.detail).toEqual(["Creed", "Dwight"]);
  });

  it("refuses a party holding two of YOUR characters, which is the same collision", () => {
    const { rejected } = screenRuns(
      [
        run("a", "lotus", 10, [
          ["Mechy", "me"],
          ["Otherme", "me"],
        ]),
      ],
      ["me"],
    );
    expect(rejected[0]?.reason).toBe("person-twice");
  });

  it("drops a run whose seat belongs to somebody who is not on", () => {
    const { eligible: kept, rejected } = screenRuns(
      [
        run("a", "lotus", 10, [
          ["Mechy", "me"],
          ["Creed", "chris"],
        ]),
      ],
      ["me"],
    );
    expect(kept).toEqual([]);
    expect(rejected[0]?.reason).toBe("person-unavailable");
    expect(rejected[0]?.detail).toEqual(["chris"]);
  });

  it("will not schedule a seat nobody has been attributed to", () => {
    const { eligible: kept, rejected } = screenRuns(
      [
        run("a", "lotus", 10, [
          ["Mechy", "me"],
          ["Stranger", null],
        ]),
      ],
      ["me"],
    );
    expect(kept).toEqual([]);
    expect(rejected[0]?.reason).toBe("unattributed-seat");
    expect(rejected[0]?.detail).toEqual(["Stranger"]);
  });

  it("drops the smaller versions of a party when everyone has to be on", () => {
    const trio = run("trio", "lotus", 10, [
      ["Mechy", "me"],
      ["Creed", "chris"],
      ["Sable", "mel"],
    ]);
    const duo = run("duo", "lucid", 10, [
      ["Mechy", "me"],
      ["Creed", "chris"],
    ]);
    const solo = run("solo", "will", 10, [["Mechy", "me"]]);

    const { eligible: kept, rejected } = screenRuns([trio, duo, solo], ["me", "chris", "mel"], {
      everyoneOn: true,
    });

    expect(kept.map((r) => r.id)).toEqual(["trio"]);
    // Named, so it is whoever would have been sitting out and not just "excluded".
    expect(rejected.map((r) => [r.reason, r.detail])).toEqual([
      ["leaves-somebody-out", ["mel"]],
      ["leaves-somebody-out", ["chris", "mel"]],
    ]);
  });

  it("keeps the smaller versions when it is off, which is what it did before", () => {
    const duo = run("duo", "lucid", 10, [
      ["Mechy", "me"],
      ["Creed", "chris"],
    ]);
    expect(screenRuns([duo], ["me", "chris", "mel"]).eligible.map((r) => r.id)).toEqual(["duo"]);
  });

  it("still refuses a party seating somebody who is away, however full it is", () => {
    const trio = run("trio", "lotus", 10, [
      ["Mechy", "me"],
      ["Creed", "chris"],
      ["Dwight", "dave"],
    ]);
    const { eligible: kept, rejected } = screenRuns([trio], ["me", "chris", "mel"], {
      everyoneOn: true,
    });
    expect(kept).toEqual([]);
    expect(rejected[0]?.reason).toBe("person-unavailable");
  });

  it("can be told who everyone is, apart from who is available", () => {
    // Run Order screens cleared runs as well, and somebody only in those is not on tonight.
    const duo = run("duo", "lucid", 10, [
      ["Mechy", "me"],
      ["Creed", "chris"],
    ]);
    const options = { everyoneOn: true, everyone: ["me", "chris"] };
    expect(screenRuns([duo], ["me", "chris", "mel"], options).eligible).toHaveLength(1);
  });

  it("reports the double-booking ahead of the absence, because it is broken either way", () => {
    const { rejected } = screenRuns(
      [
        run("a", "lotus", 10, [
          ["Creed", "chris"],
          ["Dwight", "chris"],
        ]),
      ],
      [],
    );
    expect(rejected[0]?.reason).toBe("person-twice");
  });
});

describe("planNight", () => {
  it("returns an empty plan when nothing fits", () => {
    const { best, byCount } = planNight([eligible("a", "lotus", 40, [["Mechy", "me"]])], {
      minutes: 30,
    });
    expect(best.runs).toEqual([]);
    expect(byCount).toEqual([]);
  });

  it("keeps one person on one character by putting that character's runs together", () => {
    // Alternating Mechy/Kanna/Mechy/Kanna would cost three switches. Grouping costs one.
    const runs = [
      eligible("lotus", "lotus", 10, [["Mechy", "me"]]),
      eligible("damien", "damien", 10, [["Kanna", "me"]]),
      eligible("lucid", "lucid", 10, [["Mechy", "me"]]),
      eligible("will", "will", 10, [["Kanna", "me"]]),
    ];
    const { best } = planNight(runs, { minutes: 120 });

    expect(best.runs).toHaveLength(4);
    expect(best.switches).toBe(1);
    // Which character goes first is a coin flip between two equally good plans, so the assertion
    // is on the shape: each character's runs are one unbroken block.
    const characters = best.runs.map((r) => r.run.seats[0]?.character ?? "");
    expect(blocks(characters)).toEqual(new Set(characters).size);
  });

  it("counts a switch per person, not per run", () => {
    const runs = [
      eligible("a", "lotus", 10, [
        ["Mechy", "me"],
        ["Creed", "chris"],
      ]),
      eligible("b", "damien", 10, [
        ["Kanna", "me"],
        ["Dwight", "chris"],
      ]),
    ];
    const { best } = planNight(runs, { minutes: 120 });
    expect(best.switches).toBe(2);
    expect(best.runs[1]?.switched.sort()).toEqual(["chris", "me"]);
  });

  it("bills the budget for runs and nothing else", () => {
    // A switch between them, and the two runs still add up to exactly 20. The window is spent on
    // bosses, so a night of 30-minute runs fills a 2 hour window with four of them and not three.
    const runs = [
      eligible("a", "lotus", 10, [["Mechy", "me"]]),
      eligible("b", "damien", 10, [["Kanna", "me"]]),
    ];
    const { best } = planNight(runs, { minutes: 20 });
    expect(best.runs).toHaveLength(2);
    expect(best.switches).toBe(1);
    expect(best.minutes).toBe(20);
  });

  it("does not make somebody log in twice for a run they sit out", () => {
    // Chris is only in run b, which goes first for being the biggest. Sitting out the other two
    // does not park him anywhere new, so the whole night costs ME one switch and CHRIS none.
    const runs = [
      eligible("a", "lotus", 10, [["Mechy", "me"]]),
      eligible("b", "damien", 10, [
        ["Kanna", "me"],
        ["Creed", "chris"],
      ]),
      eligible("c", "lucid", 10, [["Mechy", "me"]]),
    ];
    const { best } = planNight(runs, { minutes: 120 });
    expect(best.runs).toHaveLength(3);
    expect(best.switches).toBe(1);
    expect(order(best)).toEqual(["b", "a", "c"]);
  });

  it("runs the fullest parties first", () => {
    const runs = [
      eligible("solo", "lotus", 10, [["Mechy", "me"]]),
      eligible("trio", "damien", 10, [
        ["Mechy", "me"],
        ["Creed", "chris"],
        ["Dwight", "dave"],
      ]),
      eligible("duo", "lucid", 10, [
        ["Mechy", "me"],
        ["Creed", "chris"],
      ]),
    ];
    const { best } = planNight(runs, { minutes: 120 });
    expect(order(best)).toEqual(["trio", "duo", "solo"]);
  });

  it("keeps somebody's handful of runs together instead of spread across the night", () => {
    // Chris and Dave are in two runs each, and me in all four on one character. Alternating them
    // costs nobody a switch and still leaves both sitting out a boss in the middle of their night.
    const runs = [
      eligible("a", "lotus", 10, [
        ["Mechy", "me"],
        ["Creed", "chris"],
      ]),
      eligible("b", "damien", 10, [
        ["Mechy", "me"],
        ["Dwight", "dave"],
      ]),
      eligible("c", "lucid", 10, [
        ["Mechy", "me"],
        ["Creed", "chris"],
      ]),
      eligible("d", "will", 10, [
        ["Mechy", "me"],
        ["Dwight", "dave"],
      ]),
    ];
    const { best } = planNight(runs, { minutes: 120 });

    expect(best.switches).toBe(0);
    const partners = best.runs.map((r) => r.run.seats[1]?.personId ?? "");
    expect(blocks(partners)).toBe(2);
  });

  it("does not strand somebody in the middle to save a switch", () => {
    // My two characters split chris and dave down the middle. Running a, b, c, d parks me on
    // Mechy then Kanna for one switch all night, and leaves BOTH of them sitting out a boss
    // between their two. Pairing each of them up instead costs a second switch and no waiting.
    const runs = [
      eligible("a", "lotus", 10, [
        ["Mechy", "me"],
        ["Creed", "chris"],
      ]),
      eligible("b", "damien", 10, [
        ["Mechy", "me"],
        ["Dwight", "dave"],
      ]),
      eligible("c", "lucid", 10, [
        ["Kanna", "me"],
        ["Creed", "chris"],
      ]),
      eligible("d", "will", 10, [
        ["Kanna", "me"],
        ["Dwight", "dave"],
      ]),
    ];
    const { best } = planNight(runs, { minutes: 120 });

    const partners = best.runs.map((r) => r.run.seats[1]?.personId ?? "");
    expect(blocks(partners)).toBe(2);
    expect(best.switches).toBe(2);
  });

  it("finishes off the person who is only in a handful of a long night", () => {
    // The night this was reported on. Jared is in four of sixteen runs and used to be given two at
    // the start and two at the eleventh hour, sitting out nine in between, because waiting is only
    // charged when somebody comes BACK: until then a half-built night that had stranded him ranked
    // exactly like one that had not, and every better continuation was pruned before the bill
    // arrived. Nothing pays for it, the same sixteen runs at the same ten switches.
    const night: [string, [string, string][]][] = [
      [
        "limbo",
        [
          ["onetwothreeo", "me"],
          ["Freeballynn", "bro"],
          ["CourseLair", "jared"],
        ],
      ],
      [
        "adversary",
        [
          ["onetwothreeo", "me"],
          ["iPhone69C", "bro"],
          ["CourseLair", "jared"],
        ],
      ],
      [
        "kalos",
        [
          ["warrior2020", "me"],
          ["iPhone69C", "bro"],
        ],
      ],
      [
        "kaling",
        [
          ["acornacorn", "me"],
          ["iPhone69C", "bro"],
        ],
      ],
      [
        "blackmage",
        [
          ["acornacorn", "me"],
          ["iPhone69C", "bro"],
        ],
      ],
      [
        "star",
        [
          ["acornacorn", "me"],
          ["CreedBratton", "bro"],
        ],
      ],
      [
        "baldrix",
        [
          ["HuskyxKenshi", "me"],
          ["CreedBratton", "bro"],
        ],
      ],
      [
        "kalosx",
        [
          ["HuskyxKenshi", "me"],
          ["CreedBratton", "bro"],
        ],
      ],
      [
        "adversaryx",
        [
          ["mechyfechy", "me"],
          ["CreedBratton", "bro"],
        ],
      ],
      [
        "kalosx",
        [
          ["mechyfechy", "me"],
          ["Freeballynn", "bro"],
        ],
      ],
      [
        "blackmage",
        [
          ["onetwothreeo", "me"],
          ["Freeballynn", "bro"],
        ],
      ],
      [
        "star",
        [
          ["onetwothreeo", "me"],
          ["CourseLair", "jared"],
        ],
      ],
      [
        "limbo",
        [
          ["HuskyxKenshi", "me"],
          ["DemonSlays20", "jared"],
        ],
      ],
      [
        "kaling",
        [
          ["HuskyxKenshi", "me"],
          ["Freeballynn", "bro"],
        ],
      ],
      [
        "seren",
        [
          ["HuskyxKenshi", "me"],
          ["Freeballynn", "bro"],
        ],
      ],
      [
        "star",
        [
          ["HuskyxKenshi", "me"],
          ["Freeballynn", "bro"],
        ],
      ],
    ];
    const runs = night.map(([boss, seats], i) => eligible(`r${i}`, boss, 30, seats));
    const { best } = planNight(runs, { minutes: night.length * 30 });

    expect(best.runs).toHaveLength(16);
    expect(best.switches).toBe(10);

    const jaredAt = best.runs.flatMap((planned, i) =>
      planned.run.seats.some((seat) => seat.personId === "jared") ? [i] : [],
    );
    expect(jaredAt).toEqual([0, 1, 2, 3]);
  });

  it("puts a fuller party first even when that costs a switch", () => {
    // Kanna's two runs would group for free, but that leaves the three-person boss until last,
    // by which time somebody has gone to bed. One relog is the cheaper thing to spend.
    const runs = [
      eligible("a", "lotus", 10, [["Kanna", "me"]]),
      eligible("b", "damien", 10, [["Kanna", "me"]]),
      eligible("c", "lucid", 10, [
        ["Mechy", "me"],
        ["Creed", "chris"],
        ["Dwight", "dave"],
      ]),
    ];
    const { best } = planNight(runs, { minutes: 120 });
    expect(order(best)).toEqual(["c", "a", "b"]);
    expect(best.switches).toBe(1);
  });

  it("never books one character onto the same boss twice", () => {
    // Two configs for Lotus that share Mechy. Mechy clears Lotus once, so only one can run.
    const runs = [
      eligible("a", "lotus", 10, [
        ["Mechy", "me"],
        ["Creed", "chris"],
      ]),
      eligible("b", "lotus", 10, [
        ["Mechy", "me"],
        ["Dwight", "dave"],
      ]),
    ];
    const { best } = planNight(runs, { minutes: 120 });
    expect(best.runs).toHaveLength(1);
  });

  it("allows the same boss twice on different characters", () => {
    const runs = [
      eligible("a", "lotus", 10, [["Mechy", "me"]]),
      eligible("b", "lotus", 10, [["Kanna", "me"]]),
    ];
    const { best } = planNight(runs, { minutes: 120 });
    expect(best.runs).toHaveLength(2);
  });

  it("takes more bosses over fewer switches, and hands back the shorter plan too", () => {
    // Three runs fit. Adding the third costs a switch, so the 2-run plan is switch-free.
    const runs = [
      eligible("a", "lotus", 10, [["Mechy", "me"]]),
      eligible("b", "damien", 10, [["Mechy", "me"]]),
      eligible("c", "lucid", 10, [["Kanna", "me"]]),
    ];
    const { best, byCount } = planNight(runs, { minutes: 120 });

    expect(best.runs).toHaveLength(3);
    expect(best.switches).toBe(1);
    expect(byCount).toHaveLength(3);
    expect(byCount[1]?.runs).toHaveLength(2);
    expect(byCount[1]?.switches).toBe(0);
  });

  it("starts each run where the one before it ended, switch or no switch", () => {
    const runs = [
      eligible("a", "lotus", 30, [["Mechy", "me"]]),
      eligible("b", "damien", 30, [["Kanna", "me"]]),
      eligible("c", "lucid", 30, [["Kanna", "me"]]),
    ];
    const { best } = planNight(runs, { minutes: 120 });
    expect(best.runs.map((r) => r.startsAt)).toEqual([0, 30, 60]);
    expect(best.minutes).toBe(90);
    expect(best.switches).toBe(1);
  });

  it("gives the same plan back for the same input", () => {
    const runs = [
      eligible("a", "lotus", 10, [["Mechy", "me"]]),
      eligible("b", "damien", 10, [["Kanna", "me"]]),
      eligible("c", "lucid", 10, [["Mechy", "me"]]),
      eligible("d", "will", 10, [["Kanna", "me"]]),
    ];
    const first = order(planNight(runs, { minutes: 120 }).best);
    const again = order(planNight([...runs].reverse(), { minutes: 120 }).best);
    expect(first).toEqual(again);
  });

  it("finds the switch-free order in a party of four with tangled characters", () => {
    // Every person has two characters; each run names one of each. A careless order relogs
    // everybody repeatedly. There is an order that costs nothing until the halfway turn.
    const runs = [
      eligible("r1", "lotus", 10, [
        ["MeA", "me"],
        ["ChrisA", "chris"],
      ]),
      eligible("r2", "damien", 10, [
        ["MeA", "me"],
        ["ChrisA", "chris"],
      ]),
      eligible("r3", "lucid", 10, [
        ["MeB", "me"],
        ["ChrisB", "chris"],
      ]),
      eligible("r4", "will", 10, [
        ["MeB", "me"],
        ["ChrisB", "chris"],
      ]),
    ];
    const { best } = planNight(runs, { minutes: 200 });
    expect(best.runs).toHaveLength(4);
    // One turn: both people move from their A character to their B character, once.
    expect(best.switches).toBe(2);
  });
});

describe("tradeOffs", () => {
  const plan = (runs: number, switches: number) =>
    ({ runs: Array.from({ length: runs }), switches, minutes: runs * 10 }) as unknown as Plan;

  it("offers the full plan on its own when nothing shorter saves a switch", () => {
    // Every length costs the same two switches, so there is no trade to make.
    expect(tradeOffs([plan(1, 2), plan(2, 2), plan(3, 2)])).toHaveLength(1);
  });

  it("offers a shorter plan that genuinely costs fewer switches", () => {
    const offered = tradeOffs([plan(1, 0), plan(2, 0), plan(3, 2)]);
    expect(offered.map((p) => p.switches)).toEqual([2, 0]);
    // The 2-run plan, not the 1-run one: both cost nothing, so the longer wins.
    expect(offered[1]?.runs).toHaveLength(2);
  });

  it("puts the longest plan first, which is the one on screen by default", () => {
    expect(tradeOffs([plan(1, 0), plan(2, 1), plan(3, 4)])[0]?.runs).toHaveLength(3);
  });

  it("has nothing to offer when there is no plan at all", () => {
    expect(tradeOffs([])).toEqual([]);
  });
});

describe("bestOf", () => {
  // The beam cut. It replaced a full sort, so what has to hold is that it keeps the same k and
  // names the same winner: a selection quietly keeping the wrong k would change the plan on some
  // inputs and not others, and no test downstream of it could tell which.
  const ascending = (a: number, b: number) => a - b;

  /** What it replaced, which is the definition of right. */
  const bySorting = (items: number[], k: number) => [...items].sort(ascending).slice(0, k);

  function seeded(seed: number) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("keeps the same set as a sort, and the same best one first", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = seeded(seed);
      const size = 1 + Math.floor(rand() * 60);
      // Deliberately narrow, so duplicates are common: ties are where a partition goes wrong.
      const items = Array.from({ length: size }, () => Math.floor(rand() * 12));
      const k = 1 + Math.floor(rand() * size);

      const got = bestOf([...items], k, ascending);
      const want = bySorting(items, k);

      expect([...got].sort(ascending)).toEqual(want);
      expect(got[0]).toBe(want[0]);
      expect(got).toHaveLength(Math.min(k, size));
    }
  });

  it("holds for input that is already sorted, and for its reverse", () => {
    const up = Array.from({ length: 500 }, (_, i) => i);
    const down = [...up].reverse();
    for (const items of [up, down]) {
      const got = bestOf([...items], 100, ascending);
      expect([...got].sort(ascending)).toEqual(bySorting(items, 100));
      expect(got[0]).toBe(0);
    }
  });

  it("returns everything when k is past the end, and nothing when it is zero", () => {
    expect(bestOf([3, 1, 2], 9, ascending).sort(ascending)).toEqual([1, 2, 3]);
    expect(bestOf([3, 1, 2], 9, ascending)[0]).toBe(1);
    expect(bestOf([3, 1, 2], 0, ascending)).toEqual([]);
    expect(bestOf([], 5, ascending)).toEqual([]);
  });
});

describe("availability", () => {
  it("puts a run before the cutoff of somebody in it", () => {
    const runs = [
      eligible("a", "lotus", 30, [["Bishop", "me"]]),
      eligible("b", "damien", 30, [
        ["Kanna", "me"],
        ["Hero", "dave"],
      ]),
    ];
    // Dave has other bossing 45 minutes in, so the run he is in has to be the one that goes first.
    const { best } = planNight(runs, { minutes: 120, available: { dave: { until: 45 } } });
    expect(order(best)).toEqual(["b", "a"]);
  });

  it("drops the boss rather than run it past a cutoff", () => {
    const runs = [
      eligible("a", "lotus", 30, [["Bishop", "me"]]),
      eligible("b", "damien", 30, [["Kanna", "me"]]),
      eligible("c", "lucid", 30, [
        ["Hero", "me"],
        ["Shade", "dave"],
      ]),
    ];
    // Dave is gone at 20 and every run is 30, so his cannot happen even first. A cutoff is hard:
    // the boss goes, and the leftovers on screen are where it turns up.
    const { best } = planNight(runs, { minutes: 120, available: { dave: { until: 20 } } });
    expect(best.runs).toHaveLength(2);
    expect(order(best)).not.toContain("c");
  });

  it("waits for somebody who is not on yet, and says whose wait it is", () => {
    const runs = [
      eligible("a", "lotus", 30, [
        ["Bishop", "me"],
        ["Night", "erin"],
      ]),
      eligible("b", "damien", 30, [
        ["Kanna", "me"],
        ["Hero", "dave"],
      ]),
    ];
    const { best } = planNight(runs, { minutes: 180, available: { dave: { from: 60 } } });

    expect(order(best)).toEqual(["a", "b"]);
    expect(best.runs[1]?.startsAt).toBe(60);
    expect(best.runs[1]?.waitingFor).toEqual(["dave"]);
    // The idle half hour is in the length, because it is time the night takes.
    expect(best.minutes).toBe(90);
  });

  it("names only the person the wait is actually for", () => {
    const runs = [
      eligible("a", "lotus", 30, [
        ["Bishop", "me"],
        ["Hero", "dave"],
        ["Shade", "erin"],
      ]),
    ];
    // Erin is free at 40 and Dave at 60, so the run starts at 60 and it is Dave being waited on.
    const { best } = planNight(runs, {
      minutes: 180,
      available: { dave: { from: 60 }, erin: { from: 40 } },
    });
    expect(best.runs[0]?.waitingFor).toEqual(["dave"]);
  });

  it("leaves waitingFor empty when nobody held anything up", () => {
    const runs = [eligible("a", "lotus", 30, [["Bishop", "me"]])];
    const { best } = planNight(runs, { minutes: 60, available: { me: { from: 0, until: 60 } } });
    expect(best.runs[0]?.waitingFor).toEqual([]);
    expect(best.runs[0]?.startsAt).toBe(0);
  });
});

describe("withoutRuns", () => {
  // The night that was reported: two duos, each person on three characters.
  const night = [
    eligible("a-kalos", "kalos-x", 30, [
      ["mechyfechy", "jon"],
      ["Freeballynn", "ben"],
    ]),
    eligible("b-adversary", "adversary", 30, [
      ["mechyfechy", "jon"],
      ["CreedBratton", "ben"],
    ]),
    eligible("c-star", "star", 30, [
      ["acornacorn", "jon"],
      ["CreedBratton", "ben"],
    ]),
    eligible("d-kaling", "kaling", 30, [
      ["acornacorn", "jon"],
      ["iPhone69C", "ben"],
    ]),
    eligible("e-seren", "seren", 30, [
      ["acornacorn", "jon"],
      ["iPhone69C", "ben"],
    ]),
    eligible("0-kalos-c", "kalos-c", 30, [
      ["warrior2020", "jon"],
      ["iPhone69C", "ben"],
    ]),
  ];

  it("keeps what is left of a night in the order the whole night had it", () => {
    const full = planNight(night, { minutes: Infinity });
    const cleared = new Set(order(full.best).slice(0, 2));
    const rest = order(full.best).slice(2);

    // What the page used to do, and why it moved: the four left tie, and the tie-break differs.
    const alone = night.filter((r) => !cleared.has(r.id));
    expect(order(planNight(alone, { minutes: Infinity }).best)).not.toEqual(rest);

    const hidden = withoutRuns(full.best, cleared, { minutes: Infinity });
    expect(order(hidden)).toEqual(rest);
  });

  it("starts what is left at the start of the night", () => {
    const plan = planNight(night.slice(0, 3), { minutes: 90 }).best;
    const hidden = withoutRuns(plan, new Set([order(plan)[0] as string]), { minutes: 90 });
    expect(hidden.runs.map((r) => r.startsAt)).toEqual([0, 30]);
    expect(hidden.minutes).toBe(60);
  });

  it("still waits for somebody who is not here yet", () => {
    const available = { ben: { from: 45 } };
    const plan = planNight(night.slice(0, 2), { minutes: 200, available }).best;
    const hidden = withoutRuns(plan, new Set([order(plan)[0] as string]), {
      minutes: 200,
      available,
    });
    expect(hidden.runs[0]?.startsAt).toBe(45);
    expect(hidden.runs[0]?.waitingFor).toEqual(["ben"]);
  });

  it("drops a run that does not fit the clock it is given", () => {
    const plan = planNight(night.slice(0, 3), { minutes: 90 }).best;
    expect(withoutRuns(plan, new Set(), { minutes: 60 }).runs).toHaveLength(2);
  });

  it("keeps one plan per length, from the longest search", () => {
    const { byCount } = planNight(night, { minutes: Infinity });
    const cleared = new Set(order(byCount[5] as Plan).slice(0, 2));
    const lengths = withoutRunsByCount(byCount, cleared, { minutes: Infinity }).map(
      (p) => p.runs.length,
    );
    expect(lengths).toEqual([...new Set(lengths)].sort((a, b) => a - b));
    expect(lengths.at(-1)).toBe(4);
  });
});

describe("planNight's prefer", () => {
  // A real night (2026-10-20), ids shortened from the configs' UUIDs, whose order is what decided
  // the tie. The trios cost five switches in any of the best orders; the duos after them are what
  // picked one with "Exclude Party Member Subsets" off.
  const trios = [
    eligible("48f7-adv-a", "adversary", 15, [
      ["onetwothreeo", "you"],
      ["CourseLair", "jared"],
      ["iPhone69C", "bro"],
    ]),
    eligible("911f-adv-b", "adversary", 15, [
      ["warrior2020", "you"],
      ["DemonSlays20", "jared"],
      ["Freeballynn", "bro"],
    ]),
    eligible("65b7-limbo-b", "limbo", 20, [
      ["onetwothreeo", "you"],
      ["Freeballynn", "bro"],
      ["CourseLair", "jared"],
    ]),
    eligible("505d-limbo-a", "limbo", 20, [
      ["warrior2020", "you"],
      ["iPhone69C", "bro"],
      ["Challynnger", "jared"],
    ]),
    eligible("de93-star-a", "star", 20, [
      ["warrior2020", "you"],
      ["iPhone69C", "bro"],
      ["Challynnger", "jared"],
    ]),
  ];
  const offOrder = ["505d-limbo-a", "de93-star-a", "48f7-adv-a", "65b7-limbo-b", "911f-adv-b"];

  it("keeps the preferred order when it costs no more", () => {
    const alone = planNight(trios, { minutes: Infinity }).best;
    expect(order(alone)).not.toEqual(offOrder);

    const kept = planNight(trios, { minutes: Infinity, prefer: offOrder }).best;
    expect(order(kept)).toEqual(offOrder);
    expect(kept.switches).toBe(alone.switches);
  });

  it("never pays a switch for it", () => {
    // Every run here changes characters from the one before it: eleven switches against five.
    const costly = ["505d-limbo-a", "65b7-limbo-b", "de93-star-a", "48f7-adv-a", "911f-adv-b"];
    const alone = planNight(trios, { minutes: Infinity }).best;
    const kept = planNight(trios, { minutes: Infinity, prefer: costly }).best;
    expect(kept.switches).toBe(alone.switches);
    expect(order(kept)).not.toEqual(costly);
  });
});

describe("withoutRuns' switch marks", () => {
  it("marks against the row above on screen, not the hidden runs between", () => {
    // A real night (2026-10-20), in the order it was planned, the two cleared trios in the middle.
    const night = [
      eligible("adv-a", "adversary", 15, [
        ["onetwothreeo", "you"],
        ["iPhone69C", "bro"],
        ["CourseLair", "jared"],
      ]),
      eligible("limbo-b", "limbo", 20, [
        ["onetwothreeo", "you"],
        ["Freeballynn", "bro"],
        ["CourseLair", "jared"],
      ]),
      eligible("adv-b", "adversary", 15, [
        ["warrior2020", "you"],
        ["Freeballynn", "bro"],
        ["DemonSlays20", "jared"],
      ]),
      eligible("limbo-a", "limbo", 20, [
        ["warrior2020", "you"],
        ["iPhone69C", "bro"],
        ["Challynnger", "jared"],
      ]),
    ];
    const planned: Plan = {
      runs: night.map((run) => ({ run, switched: ["planned"], startsAt: 0, waitingFor: [] })),
      switches: 4,
      minutes: 0,
    };

    const shown = withoutRuns(planned, new Set(["limbo-b", "adv-b"]), { minutes: Infinity });
    expect(shown.runs.map((r) => r.switched)).toEqual([[], ["you", "jared"]]);
    expect(shown.switches).toBe(2);
  });
});
