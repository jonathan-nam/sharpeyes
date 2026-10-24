import { describe, expect, it } from "vitest";
import {
  EXACT_LIMIT,
  planParties,
  plannerDifficulties,
  runMinutes,
  snapStrength,
  SOLO,
  strengthTicks,
  type Plan,
  type Want,
} from "@/lib/party-planner";

let next = 0;
const want = (personId: string, strength: number, extra: Partial<Want> = {}): Want => ({
  id: `w${next++}`,
  character: `${personId}-${next}`,
  personId,
  world: "Kronos",
  bossKey: "kaling",
  difficulty: "HARD",
  strength,
  maxParty: null,
  ...extra,
});

/** Each party as its members' strengths, strongest first, parties in a stable order. */
const shape = (plan: Plan, wants: Want[]) => {
  const strength = new Map(wants.map((w) => [w.id, w.strength]));
  return plan.parties
    .map((p) => p.seats.map((s) => strength.get(s.wantId)!).sort((a, b) => b - a))
    .sort((a, b) => (b[0] ?? 0) - (a[0] ?? 0) || b.length - a.length);
};

describe("which bosses a plan may ask for", () => {
  it("takes Black Mage at Extreme only, and nothing below Seren", () => {
    expect(plannerDifficulties("black-mage", ["HARD", "EXTREME"])).toEqual(["EXTREME"]);
    expect(plannerDifficulties("kaling", ["EASY", "NORMAL"])).toEqual(["EASY", "NORMAL"]);
    expect(plannerDifficulties("darknell", ["NORMAL", "HARD"])).toEqual([]);
  });
});

describe("the strength slider", () => {
  it("ticks at each fraction of a full party", () => {
    expect(strengthTicks(6)).toEqual([10, 20, 30, 40, 50]);
    expect(strengthTicks(3)).toEqual([20, 40]);
  });

  it("snaps near a tick and stays put between them", () => {
    expect(snapStrength(21, 3)).toBe(20);
    expect(snapStrength(30, 3)).toBe(30);
    expect(snapStrength(59, 6)).toBe(SOLO);
  });

  it("reads a solo clear as thirty minutes and twice that strength as fifteen", () => {
    expect(runMinutes(SOLO)).toBe(30);
    expect(runMinutes(2 * SOLO)).toBe(15);
  });
});

describe("planParties", () => {
  it("has a soloer carry somebody nobody else can take, keeping the loot", () => {
    // The Hard Limbo report: a soloer at Any Size and a character doing no damage.
    const solo = want("a", SOLO);
    const passenger = want("b", 0);
    const plan = planParties([solo, passenger]);
    expect(plan.unplaced).toEqual([]);
    const [carry] = plan.parties;
    expect(carry?.seats.map((s) => s.shares)).toEqual([1, 0]);
    expect(carry?.minutes).toBe(30);
  });

  it("never has a soloer set to Solo carry anybody", () => {
    const solo = want("a", SOLO, { maxParty: 1 });
    const weak = want("b", 20);
    const plan = planParties([solo, weak]);
    expect(shape(plan, [solo, weak])).toEqual([[SOLO]]);
    expect(plan.unplaced).toEqual([{ wantId: weak.id, reason: "alone" }]);
  });

  it("carries only who no other party could take, and never pairs two soloers", () => {
    const soloA = want("a", SOLO);
    const soloB = want("b", SOLO);
    const pair = [want("c", 30), want("d", 30)];
    const plan = planParties([soloA, soloB, ...pair]);
    expect(shape(plan, [soloA, soloB, ...pair])).toEqual([[SOLO], [SOLO], [30, 30]]);
  });

  it("leaves a soloer's room for the passenger who can ride with nobody else", () => {
    // The stuck passenger shares a player with the other soloer, so only one soloer can take it.
    // First come first served let three passengers who could ride with anyone fill that one first.
    const onlyHost = want("thornwick", SOLO);
    const otherHost = want("pellmoor", SOLO);
    const anyone = [want("quillsby", 0), want("ravensoot", 0), want("ambergast", 0)];
    const stuck = want("pellmoor", 0);
    const plan = planParties([onlyHost, otherHost, ...anyone, stuck]);
    expect(plan.unplaced).toEqual([]);
    const withOnlyHost = plan.parties.find((p) => p.seats[0]?.wantId === onlyHost.id);
    expect(withOnlyHost?.seats.map((s) => s.wantId)).toContain(stuck.id);
  });

  it("spreads passengers over the soloers before doubling any up", () => {
    const solos = [want("a", SOLO), want("b", SOLO)];
    const riders = [want("c", 0), want("d", 0)];
    const plan = planParties([...solos, ...riders]);
    expect(plan.parties.map((p) => p.seats.length)).toEqual([2, 2]);
  });

  it("makes as many parties as clear, the most loot and the smallest runs", () => {
    const wants = [want("a", 50), want("b", 40), want("c", 20), want("d", 10)];
    expect(shape(planParties(wants), wants)).toEqual([
      [50, 10],
      [40, 20],
    ]);
  });

  it("places everybody before it makes another party", () => {
    const wants = [want("a", 40), want("b", 30), want("c", 30), want("d", 0)];
    const plan = planParties(wants);
    expect(plan.unplaced).toEqual([]);
    expect(plan.parties).toHaveLength(1);
  });

  it("splits by strength, so a member doing nothing takes nothing", () => {
    const wants = [want("a", 40), want("b", 20), want("c", 0)];
    const [party] = planParties(wants).parties;
    expect(party?.seats.map((s) => s.shares)).toEqual([2, 1, 0]);
    expect(party?.minutes).toBe(30);
  });

  it("never seats two of one person's characters together", () => {
    const wants = [want("a", 30), want("a", 30)];
    const plan = planParties(wants);
    expect(plan.parties).toEqual([]);
    expect(plan.unplaced.map((u) => u.reason)).toEqual(["alone", "alone"]);
  });

  it("holds to the boss's size and to each character's own", () => {
    const four = ["a", "b", "c", "d"].map((p) => want(p, 15, { bossKey: "limbo" }));
    expect(planParties(four).parties).toEqual([]);

    const capped = [want("a", 30, { maxParty: 2 }), want("b", 15), want("c", 15)];
    expect(planParties(capped).parties).toEqual([]);
  });

  it("never seats two Lynns together", () => {
    const lynns = [want("a", 30, { job: "Lynn" }), want("b", 30, { job: "Lynn" })];
    expect(planParties(lynns).parties).toEqual([]);
    const mixed = [want("a", 30, { job: "Lynn" }), want("b", 30, { job: "Adele" })];
    expect(planParties(mixed).parties).toHaveLength(1);
  });

  it("never has a soloing Lynn carry another Lynn", () => {
    const plan = planParties([want("a", SOLO, { job: "Lynn" }), want("b", 0, { job: "Lynn" })]);
    expect(plan.unplaced.map((u) => u.reason)).toEqual(["alone"]);
  });

  it("keeps apart the people asked to be kept apart", () => {
    const wants = [want("a", 30), want("b", 30), want("c", 30)];
    const plan = planParties(wants, { apart: [["a", "b"]] });
    const people = plan.parties.map((p) => p.seats.map((s) => s.personId));
    expect(people).toHaveLength(1);
    expect(people[0]).toContain("c");
    expect(people[0]).not.toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("refuses a party that cannot clear inside the thirty minutes", () => {
    expect(planParties([want("a", 30), want("b", 29)]).parties).toEqual([]);
    expect(planParties([want("a", 30), want("b", 30)]).parties).toHaveLength(1);
  });

  it("never mixes worlds or modes", () => {
    const wants = [
      want("a", 30),
      want("b", 30, { world: "Hyperion" }),
      want("c", 30, { difficulty: "NORMAL" }),
    ];
    expect(planParties(wants).parties).toEqual([]);
  });

  it("says when a want could clear but was crowded out", () => {
    // Either of b or c finishes a's party, and only one of them can.
    const wants = [want("a", 40), want("b", 20, { maxParty: 2 }), want("c", 20, { maxParty: 2 })];
    const plan = planParties(wants);
    expect(plan.unplaced.map((u) => u.reason)).toEqual(["crowded"]);
  });

  it("refuses the same character wanting a boss twice", () => {
    const one = want("a", 30);
    expect(() => planParties([one, { ...one, id: "again" }])).toThrow();
  });

  it("groups a crowd greedily, and every party it makes still clears in time", () => {
    const strengths = [55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 10, 5, 5, 0, 0, 30, 20];
    const wants = strengths.map((s, i) => want(`p${i}`, s));
    expect(wants.length).toBeGreaterThan(EXACT_LIMIT);
    const plan = planParties(wants);
    expect(plan.exact).toBe(false);
    for (const p of plan.parties) {
      expect(p.minutes).toBeLessThanOrEqual(30);
      expect(p.seats.length).toBeLessThanOrEqual(6);
    }
    const seated = plan.parties.flatMap((p) => p.seats.map((s) => s.wantId));
    expect(new Set(seated).size).toBe(seated.length);
    expect(seated.length + plan.unplaced.length).toBe(wants.length);
  });
});
