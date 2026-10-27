import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatOffset,
  formatOffsetShort,
  type NightPerson,
  nextHalfHour,
  offsetNow,
  parseOffset,
  planAsText,
  planGrid,
  rosterFrom,
  rosterOfSwitchers,
  runsFromParties,
  runTicks,
  runTimes,
  spanBetween,
  stillToRun,
} from "@/lib/boss-night";
import { type EligibleRun, type Plan, planNight } from "@/lib/boss-run-plan";
import { committedGolden, goldenCases, goldenText, seeded } from "@/lib/golden";
import { type NightInputs, nightOf, searchNight, type WindowText } from "@/lib/night-search";
import type { Boss } from "@/types/boss";
import type { Party, PartyMember } from "@/types/party";

// boss-night's and night-search's answers for the Kotlin port (shared/planning). See lib/golden.ts.

const SOURCE = "frontend/lib/boss-night.golden.test.ts";

const BOSS_KEYS = [
  "lotus",
  "lucid",
  "chosen-seren",
  "malefic-star",
  "will",
  "first-adversary",
  "kalos-the-guardian",
];
const BOSSES: Boss[] = BOSS_KEYS.slice(0, 5).map((bossKey, i) => ({
  bossKey,
  name: `Boss ${i}`,
  reset: "WEEKLY",
  iconUrl: null,
  difficulties: ["NORMAL", "HARD"],
}));

// Names in several shapes, because the roster is sorted with localeCompare and the paste pads by
// length: mixed case, accents, and a tab and a byte order mark that the table has to strip.
const NAMES = ["Thornwick", "pellmoor", "Ásgrove", "Quillon", "marrowby", "Vant\tress", "﻿Ollowen"];

function partiesOf(random: () => number): Party[] {
  const pick = (n: number) => Math.floor(random() * n);
  const people = ["you", "p-bren", "p-sela", "p-dax"].slice(0, 2 + pick(3));
  return Array.from({ length: 1 + pick(9) }, (_, i) => {
    const seated = people.filter(() => random() < 0.7);
    const members: PartyMember[] = seated.map((person, j) => {
      const mine = person === "you";
      // Now and then a seat nobody has claimed, which keeps the whole config out of the night.
      const unclaimed = !mine && random() < 0.1;
      return {
        id: `m${i}-${j}`,
        name: `${NAMES[pick(NAMES.length)]}${pick(3)}`,
        personId: mine || unclaimed ? null : person,
        personName: mine || unclaimed || random() < 0.2 ? null : NAMES[pick(NAMES.length)]!,
        characterId: mine ? `c-${i}` : null,
        linkedCharacterId: null,
        spriteImgUrl: null,
        guest: false,
        shares: 1,
        pieceShares: 1,
      };
    });
    const difficulty = random() < 0.3 ? null : "HARD";
    return {
      id: `party-${i}`,
      slug: `party-${i}`,
      characterId: `c-${i}`,
      solo: false,
      oneOff: false,
      retired: false,
      worldType: "INTERACTIVE",
      bossKey: BOSS_KEYS[pick(BOSS_KEYS.length)]!,
      difficulty,
      ...(random() < 0.2 ? { weekDifficulty: random() < 0.5 ? null : "NORMAL" } : {}),
      minutes: random() < 0.3 ? null : [10, 20, 30, 45][pick(4)]!,
      members,
      seats: members,
      usualRoster: true,
      skippedThisPeriod: false,
      pendingLoot: 0,
      awaitingPayout: 0,
      settledLoot: 0,
      cleared: random() < 0.3 ? true : random() < 0.5 ? false : null,
      clearedByHand: false,
      createdAt: "",
      updatedAt: "",
    };
  });
}

type RosterInput = { parties: Party[]; people?: string[]; ticked: string[] };

function rosters(): RosterInput[] {
  const random = seeded(20261030);
  return Array.from({ length: 60 }, () => {
    const parties = partiesOf(random);
    return {
      parties,
      ...(random() < 0.5
        ? { people: ["you", "p-bren", "p-sela"].filter(() => random() < 0.6) }
        : {}),
      ticked: parties.filter(() => random() < 0.3).map((p) => p.id),
    };
  });
}

function rostered(input: RosterInput) {
  const people = input.people === undefined ? undefined : new Set(input.people);
  return {
    rosterFrom: rosterFrom(input.parties),
    rosterOfSwitchers: rosterOfSwitchers(input.parties),
    runs: runsFromParties(input.parties, BOSSES, people),
    stillToRun: stillToRun(input.parties, new Set(input.ticked)).map((p) => p.id),
  };
}

type ClockInput = { minutes: number; text: string; from: number; to: number; at: number };

const TEXTS = [
  "3.5",
  "+3.5",
  "-0:30",
  "3:30",
  "+12",
  "+12:00",
  "-12:00",
  "12:01",
  "+25",
  "0",
  "-0",
  " +4 ",
  "﻿+2",
  " +2.25",
  "4.",
  ".5",
  "+4:5",
  "+4:60",
  "1.999999999999999999",
  "+٣",
  "3\u0085",
  "+3\n",
  "",
  "abc",
  "+1.05",
  "-11.99",
];

function clocks(): ClockInput[] {
  const random = seeded(20261031);
  const cases: ClockInput[] = [];
  for (let i = 0; i < 120; i++) {
    const minutes = Math.floor(random() * 3000) - 1500 + (random() < 0.3 ? 0.5 : 0);
    cases.push({
      minutes,
      text: TEXTS[i % TEXTS.length]!,
      from: Math.floor(random() * 1440) - 720,
      to: Math.floor(random() * 1440) - 720,
      at: Math.floor(random() * 4e12),
    });
  }
  return cases;
}

function clocked(input: ClockInput) {
  const whole = Math.round(input.minutes);
  return {
    formatOffset: formatOffset(input.minutes),
    formatOffsetShort: formatOffsetShort(input.minutes),
    formatDuration: formatDuration(Math.abs(whole)),
    nextHalfHour: nextHalfHour(whole),
    parseOffset: parseOffset(input.text),
    spanBetween: spanBetween(input.from, input.to),
    offsetNow: offsetNow(input.at),
  };
}

type TextInput = { plan: Plan; roster: NightPerson[]; startAt: number; only?: string[] };

function texts(): TextInput[] {
  const random = seeded(20261101);
  const pick = (n: number) => Math.floor(random() * n);
  return Array.from({ length: 40 }, () => {
    const parties = partiesOf(random);
    const runs = runsFromParties(parties, BOSSES).map((run) => ({
      ...run,
      seats: run.seats.map((seat) => ({ ...seat, personId: seat.personId! })),
    })) as EligibleRun[];
    const roster = rosterFrom(parties);
    const available =
      random() < 0.4 && roster[1] !== undefined ? { [roster[1].id]: { from: 15 * pick(4) } } : {};
    const plan = planNight(runs, { minutes: [60, 120, Infinity][pick(3)]!, available }).best;
    return {
      plan,
      roster,
      startAt: Math.floor(random() * 1440) - 720,
      ...(random() < 0.3
        ? { only: plan.runs.filter(() => random() < 0.5).map((p) => p.run.id) }
        : {}),
    };
  });
}

function texted(input: TextInput) {
  const times = runTimes(input.plan, input.roster, input.startAt);
  const grid = planGrid(input.plan, input.roster);
  return {
    times,
    ticks: runTicks(times),
    grid: {
      people: grid.people,
      rows: grid.rows.map((row) => ({ id: row.planned.run.id, cells: row.cells })),
    },
    text: planAsText(input.plan, input.roster, input.only ? new Set(input.only) : undefined),
  };
}

type SearchInput = { inputs: NightInputs; parties: Party[]; answered: string[] };

function searches(): SearchInput[] {
  const random = seeded(20261102);
  const pick = (n: number) => Math.floor(random() * n);
  return Array.from({ length: 40 }, () => {
    const parties = partiesOf(random);
    const windows: Record<string, WindowText> = {};
    for (const id of ["p-bren", "p-sela", "p-nobody"]) {
      if (random() < 0.4)
        windows[id] = {
          from: ["+1", "", "+0.5", "x"][pick(4)]!,
          until: ["+3", "", "-11"][pick(3)]!,
        };
    }
    return {
      inputs: {
        budget: [60, 90, 120][pick(3)]!,
        openOnly: random() < 0.7,
        everyoneOn: random() < 0.4,
        away: random() < 0.3 ? ["p-sela"] : [],
        startAt: [0, 30, -60][pick(3)]!,
        windows,
        timed: random() < 0.7,
      },
      parties,
      answered: parties.filter(() => random() < 0.2).map((p) => p.id),
    };
  });
}

function described(plan: Plan) {
  return {
    order: plan.runs.map((p) => ({ id: p.run.id, startsAt: p.startsAt, switched: p.switched })),
    switches: plan.switches,
    minutes: plan.minutes,
  };
}

function searched(input: SearchInput) {
  const switchers = new Set(rosterOfSwitchers(input.parties).map((p) => p.id));
  const night = nightOf(input.inputs, {
    running: input.parties,
    answered: new Set(input.answered),
    bosses: BOSSES,
    switchers,
  });
  const result = searchNight(night.search);
  const { search } = night;
  return {
    plannedParties: night.plannedParties.map((p) => p.id),
    hidden: [...night.hidden],
    onTonight: night.onTonight,
    searched: search.searched.map((run) => run.id),
    // Null is Infinity, which JSON cannot carry.
    night: search.night === Infinity ? null : search.night,
    available: search.available,
    allRuns: search.allRuns,
    hereAll: search.hereAll,
    minutes: result.minutes === Infinity ? null : result.minutes,
    byCount: result.byCount.map(described),
  };
}

describe("boss-night golden fixtures", () => {
  const cases = [
    ["night-roster.json", () => goldenCases(rosters(), rostered)],
    ["reset-clock.json", () => goldenCases(clocks(), clocked)],
    ["night-text.json", () => goldenCases(texts(), texted)],
    ["night-search.json", () => goldenCases(searches(), searched)],
  ] as const;

  for (const [name, record] of cases) {
    it(`${name} is what boss-night answers today`, () => {
      const text = goldenText(SOURCE, record());
      expect(committedGolden(name, text, "planning") === text, "run with UPDATE_GOLDEN=1").toBe(
        true,
      );
    });
  }
});
