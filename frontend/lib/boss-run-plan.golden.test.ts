import { describe, expect, it } from "vitest";
import {
  type Availability,
  type CandidateRun,
  type EligibleRun,
  type Plan,
  planNight,
  screenRuns,
  shuffledIds,
  shuffledPlan,
  sourcesByCount,
  tradeOffs,
} from "@/lib/boss-run-plan";
import { committedGolden, goldenCases, goldenText, seeded } from "@/lib/golden";

// boss-run-plan's answers for the Kotlin port (shared/planning). See lib/golden.ts.

const SOURCE = "frontend/lib/boss-run-plan.golden.test.ts";

/** One night as Run Order searches it: everything planNight, shuffledPlan and the restrictions read. */
type NightInput = {
  runs: EligibleRun[];
  /** Null is Infinity, which JSON cannot carry: a night not run to the clock. */
  minutes: number | null;
  /** The clock the hidden runs are restricted against, as Run Order's `night`. */
  shownMinutes: number | null;
  available: Record<string, Availability>;
  prefer?: string[];
  beamWidth?: number;
  seed?: number;
  hidden: string[];
};

type DescribedPlan = {
  order: { id: string; startsAt: number; switched: string[]; waitingFor: string[] }[];
  switches: number;
  minutes: number;
};

function described(plan: Plan): DescribedPlan {
  return {
    order: plan.runs.map((planned) => ({
      id: planned.run.id,
      startsAt: planned.startsAt,
      switched: planned.switched,
      waitingFor: planned.waitingFor,
    })),
    switches: plan.switches,
    minutes: plan.minutes,
  };
}

const infinite = (minutes: number | null) => minutes ?? Infinity;

function planned(input: NightInput) {
  const options = {
    minutes: infinite(input.minutes),
    available: input.available,
    ...(input.prefer ? { prefer: input.prefer } : {}),
    ...(input.beamWidth ? { beamWidth: input.beamWidth } : {}),
  };
  // Every length reordered, where the page reorders only the one on screen, so the port is held to
  // shuffledPlan on all of them.
  const { seed } = input;
  const plain = planNight(input.runs, options).byCount;
  const byCount =
    seed === undefined ? plain : plain.map((plan) => shuffledPlan(plan, options, seed));
  const sources = sourcesByCount(byCount, new Set(input.hidden), {
    minutes: infinite(input.shownMinutes),
    available: input.available,
  });
  const shown = sources.map((source) => source.shown);
  return {
    byCount: byCount.map(described),
    shown: shown.map(described),
    shownFrom: sources.map((source) => source.from),
    tradeOffs: tradeOffs(shown).map(described),
  };
}

// Ids in several shapes, because the last tie-break compares them with localeCompare: UUIDs as the
// configs have, and short mixed-case and punctuated ones, where ICU and a plain compare part ways.
function idOf(random: () => number, i: number): string {
  const hex = () => Math.floor(random() * 16).toString(16);
  switch (Math.floor(random() * 3)) {
    case 0:
      return `${Array.from({ length: 8 }, hex).join("")}-${Array.from({ length: 4 }, hex).join("")}-${i}`;
    case 1:
      return `${["Run", "run", "RUN", "r_un", "r-un"][Math.floor(random() * 5)]}${i}`;
    default:
      return `r${i}`;
  }
}

function nights(): NightInput[] {
  const random = seeded(20261027);
  const pick = (n: number) => Math.floor(random() * n);
  const out: NightInput[] = [];
  for (let n = 0; n < 80; n++) {
    const people = 2 + pick(6);
    const runs: EligibleRun[] = Array.from({ length: 3 + pick(12) }, (_, i) => {
      const seated = new Set<number>();
      const size = 1 + pick(5);
      while (seated.size < Math.min(size, people)) seated.add(pick(people));
      return {
        id: idOf(random, i),
        bossKey: `boss${pick(6)}`,
        bossName: `Boss ${i}`,
        difficulty: random() < 0.5 ? null : "hard",
        minutes: [10, 15, 20, 30, 45][pick(5)]!,
        ...(random() < 0.2 ? { assumed: true } : {}),
        seats: [...seated].map((p) => ({ character: `p${p}c${pick(3)}`, personId: `p${p}` })),
      };
    });

    const available: Record<string, Availability> = {};
    for (let p = 0; p < people; p++) {
      if (random() < 0.3) {
        const window: Availability = {};
        if (random() < 0.6) window.from = [0, 15, 30, 60][pick(4)]!;
        if (random() < 0.6) window.until = [45, 60, 90, 120][pick(4)]!;
        available[`p${p}`] = window;
      }
    }

    const night: number | null = [60, 90, 120, 180, null][pick(5)] ?? null;
    const hidden = random() < 0.3 ? runs.filter(() => random() < 0.3).map((r) => r.id) : [];
    const hiddenMinutes = runs
      .filter((run) => hidden.includes(run.id))
      .reduce((sum, run) => sum + run.minutes, 0);
    const ids = runs.map((run) => run.id);

    out.push({
      runs,
      minutes: night === null ? null : night + hiddenMinutes,
      shownMinutes: night,
      available,
      ...(random() < 0.3 ? { prefer: ids.filter(() => random() < 0.7).reverse() } : {}),
      // Narrow beams cut hardest, which is where a tie broken differently changes the night.
      ...(random() < 0.4 ? { beamWidth: [3, 10, 50][pick(3)]! } : {}),
      ...(random() < 0.5 ? { seed: 1 + pick(0x7ffffffe) } : {}),
      hidden,
    });
  }
  return out;
}

type ScreenInput = {
  runs: CandidateRun[];
  available: string[];
  everyoneOn: boolean;
  everyone?: string[];
};

function screens(): ScreenInput[] {
  const random = seeded(20261028);
  const pick = (n: number) => Math.floor(random() * n);
  const out: ScreenInput[] = [];
  for (let n = 0; n < 60; n++) {
    const people = 2 + pick(5);
    const runs: CandidateRun[] = Array.from({ length: 1 + pick(8) }, (_, i) => ({
      id: `r${i}`,
      bossKey: `boss${pick(4)}`,
      bossName: `Boss ${i}`,
      difficulty: null,
      minutes: 20,
      // Repeats a person now and then, and leaves a seat unclaimed, so every refusal is reached.
      seats: Array.from({ length: 1 + pick(4) }, () => ({
        character: `c${pick(9)}`,
        personId: random() < 0.1 ? null : `p${pick(people)}`,
      })),
    }));
    const available = Array.from({ length: people }, (_, p) => `p${p}`).filter(
      () => random() < 0.8,
    );
    out.push({
      runs,
      available,
      everyoneOn: random() < 0.5,
      ...(random() < 0.3 ? { everyone: available.filter(() => random() < 0.6) } : {}),
    });
  }
  return out;
}

function screened(input: ScreenInput) {
  const { eligible, rejected } = screenRuns(input.runs, input.available, {
    everyoneOn: input.everyoneOn,
    ...(input.everyone ? { everyone: input.everyone } : {}),
  });
  return {
    eligible: eligible.map((run) => run.id),
    rejected: rejected.map((r) => ({ id: r.run.id, reason: r.reason, detail: r.detail })),
  };
}

type ShuffleInput = { ids: string[]; seed: number };

function shuffles(): ShuffleInput[] {
  const random = seeded(20261029);
  return Array.from({ length: 40 }, (_, n) => ({
    ids: Array.from({ length: n % 12 }, (_, i) => `r${i}`),
    seed: [1, 0x7ffffffe, 1 + Math.floor(random() * 0x7ffffffe)][n % 3]!,
  }));
}

describe("boss-run-plan golden fixtures", () => {
  const cases = [
    ["run-plan.json", () => goldenCases(nights(), planned)],
    ["run-screen.json", () => goldenCases(screens(), screened)],
    [
      "shuffled-ids.json",
      () => goldenCases(shuffles(), (input: ShuffleInput) => shuffledIds(input.ids, input.seed)),
    ],
  ] as const;

  for (const [name, record] of cases) {
    it(`${name} is what boss-run-plan answers today`, () => {
      const text = goldenText(SOURCE, record());
      expect(committedGolden(name, text, "planning") === text, "run with UPDATE_GOLDEN=1").toBe(
        true,
      );
    });
  }
});
