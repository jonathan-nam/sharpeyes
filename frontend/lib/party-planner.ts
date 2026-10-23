// Proposing permanent parties for a list of characters who each want a boss.
//
// Strength is one rough number per (character, boss, difficulty): how much of the boss the
// character takes off alone in a thirty-minute run, in sixtieths. 60 is a solo clear. Sixtieths
// because 60 divides by every party size up to six, so the slider ticks at 1/3 and 1/6 of the boss
// are whole numbers, and a share count built from them stays under MAX_SHARES. Strengths add: a
// party at 120 is assumed to take fifteen minutes. That is the whole model, and it is only as good
// as the sliders, which is why the plan goes to every member for review before anything is made.
//
// A character who can solo runs its own party, never one with another soloer, and keeps its whole
// loot over seating a weaker character. It carries only somebody no other party could take, and
// only when its party size allows: "Solo" (1) never carries, any other size will.
//
// Everyone else is grouped per (world, boss, difficulty), ranked in order by:
//
//   1. the most characters placed
//   2. the most parties, which is the most loot in total and the smallest parties for Liberation
//   3. the smallest largest party
//   4. the fewest minutes spent, summed over everyone in a run
//
// Each seat's share count is its strength, divided down by what the party has in common, so the
// split follows the damage: a member doing nothing takes nothing.

import { BOSS_MAX_PARTY } from "@/lib/boss-hp";
import { DEFAULT_MINUTES } from "@/lib/boss-minutes";

/** A solo clear inside the thirty minutes, in strength units. */
export const SOLO = 60;

/** The bosses a plan may ask for, with the modes it may ask for them at. Null is every mode. */
export const PLANNER_BOSSES: Record<string, string[] | null> = {
  "chosen-seren": null,
  "kalos-the-guardian": null,
  "first-adversary": null,
  kaling: null,
  "malefic-star": null,
  limbo: null,
  baldrix: null,
  jupiter: null,
  "black-mage": ["EXTREME"],
};

/** The modes of a boss a plan may ask for, from the boss's own list. Empty is not plannable. */
export function plannerDifficulties(bossKey: string, difficulties: string[]): string[] {
  const only = PLANNER_BOSSES[bossKey];
  if (only === undefined) return [];
  return only === null ? difficulties : difficulties.filter((d) => only.includes(d));
}

/** The slider's ticks: one per fraction of a full party, short of a solo. */
export function strengthTicks(maxParty: number): number[] {
  const ticks: number[] = [];
  for (let k = 1; k < maxParty; k++) ticks.push((k * SOLO) / maxParty);
  return ticks;
}

/** A slider value pulled onto the nearest tick within `reach` units, or left where it was put. */
export function snapStrength(value: number, maxParty: number, reach = 2): number {
  const marks = [0, ...strengthTicks(maxParty), SOLO];
  const nearest = marks.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a));
  return Math.abs(nearest - value) <= reach ? nearest : value;
}

/** How long a run at this combined strength is assumed to take, in whole minutes. */
export function runMinutes(strength: number): number {
  return Math.ceil((SOLO * DEFAULT_MINUTES) / strength);
}

/** One character wanting one boss. */
export type Want = {
  id: string;
  character: string;
  /** Whoever plays it. Two characters of one person are never in the same run. */
  personId: string;
  /** Null when the character's world is not known. Parties never cross a world. */
  world: string | null;
  bossKey: string;
  difficulty: string;
  /** 0 to SOLO. */
  strength: number;
  /** The biggest party this character will join, or null for any the boss admits. */
  maxParty: number | null;
};

export type PlanSettings = {
  /** The longest a run of two or more may take, 10 to 30. */
  maxMinutes: number;
  /** Pairs of people who are not to be seated together. */
  apart?: Array<[string, string]>;
};

export type PlannedSeat = { wantId: string; character: string; personId: string; shares: number };

export type PlannedParty = {
  world: string | null;
  bossKey: string;
  difficulty: string;
  seats: PlannedSeat[];
  minutes: number;
};

/**
 * Why a want has no party. `alone`: no party it could be in clears in time. `crowded`: one could,
 * but seating it cost more characters elsewhere than it placed.
 */
export type Unplaced = { wantId: string; reason: "alone" | "crowded" };

export type Plan = {
  parties: PlannedParty[];
  unplaced: Unplaced[];
  /** False when some boss had too many characters to search, and was grouped greedily instead. */
  exact: boolean;
};

/** Above this many characters on one boss, every grouping is too many to try. 3^14 is ~4.8M. */
export const EXACT_LIMIT = 14;

export function planParties(wants: Want[], settings: PlanSettings): Plan {
  const seen = new Set<string>();
  for (const w of wants) {
    const key = `${w.character}\n${w.world}\n${w.bossKey}`;
    if (seen.has(key)) throw new Error(`${w.character} wants ${w.bossKey} twice`);
    seen.add(key);
    if (!(w.strength >= 0 && w.strength <= SOLO)) throw new Error(`strength out of range: ${w.id}`);
  }

  const groups = new Map<string, { bossKey: string; group: Want[] }>();
  for (const w of wants) {
    const key = `${w.world}\n${w.bossKey}\n${w.difficulty}`;
    const found = groups.get(key) ?? { bossKey: w.bossKey, group: [] };
    found.group.push(w);
    groups.set(key, found);
  }

  const plan: Plan = { parties: [], unplaced: [], exact: true };
  for (const { bossKey, group } of groups.values()) {
    const rules = groupRules(bossKey, settings);
    const solos = group.filter((w) => w.strength >= SOLO).map((w) => [w]);
    const rest = group.filter((w) => w.strength < SOLO);
    const found = rest.length <= EXACT_LIMIT ? searchExact(rest, rules) : searchGreedy(rest, rules);
    if (rest.length > EXACT_LIMIT) plan.exact = false;
    const placed = new Set(found.flat().map((w) => w.id));
    for (const w of rest) {
      if (placed.has(w.id)) continue;
      // Nobody else could take them, so a soloer who will carry does, the emptiest first. Party
      // size is the soloer's say: "Solo" (1) never carries. Not timed, since a carry is no slower.
      const host = solos
        .filter((members) => rules.mayJoin([...members, w]))
        .sort((a, b) => a.length - b.length)[0];
      if (host) {
        host.push(w);
        continue;
      }
      plan.unplaced.push({
        wantId: w.id,
        reason: canJoinAny(w, rest, rules) ? "crowded" : "alone",
      });
    }
    for (const members of [...solos, ...found]) plan.parties.push(party(members));
  }
  return plan;
}

type Rules = {
  /** Whether these may sit together, however long they would take. */
  mayJoin: (members: Want[]) => boolean;
  /** Whether these may sit together and clear in time. */
  fits: (members: Want[]) => boolean;
};

function groupRules(bossKey: string, settings: PlanSettings): Rules {
  const bossCap = BOSS_MAX_PARTY[bossKey] ?? 6;
  const apart = new Set((settings.apart ?? []).flatMap(([a, b]) => [`${a}\n${b}`, `${b}\n${a}`]));
  const mayJoin = (members: Want[]) => {
    const cap = Math.min(bossCap, ...members.map((m) => m.maxParty ?? bossCap));
    if (members.length > cap) return false;
    const people = members.map((m) => m.personId);
    if (new Set(people).size !== people.length) return false;
    for (const a of people) for (const b of people) if (apart.has(`${a}\n${b}`)) return false;
    return true;
  };
  return {
    mayJoin,
    fits(members) {
      if (members.length < 2 || !mayJoin(members)) return false;
      const strength = members.reduce((sum, m) => sum + m.strength, 0);
      return strength * settings.maxMinutes >= SOLO * DEFAULT_MINUTES;
    },
  };
}

function party(members: Want[]): PlannedParty {
  const [first] = members;
  if (!first) throw new Error("a party with nobody in it");
  const strength = members.reduce((sum, m) => sum + m.strength, 0);
  const common = members.reduce((g, m) => gcd(g, m.strength), 0);
  return {
    world: first.world,
    bossKey: first.bossKey,
    difficulty: first.difficulty,
    seats: members.map((m) => ({
      wantId: m.id,
      character: m.character,
      personId: m.personId,
      shares: m.strength / common,
    })),
    minutes: runMinutes(strength),
  };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Whether any party this want could sit in clears, ignoring everyone else's claims on it. */
function canJoinAny(want: Want, group: Want[], rules: Rules): boolean {
  const others = group.filter((w) => w.id !== want.id);
  const n = others.length;
  for (let mask = 1; mask < 1 << n && n <= EXACT_LIMIT; mask++) {
    const members = [want, ...others.filter((_, i) => mask & (1 << i))];
    if (rules.fits(members)) return true;
  }
  if (n > EXACT_LIMIT) return greedyFill(want, others, rules) !== null;
  return false;
}

/** Placed, parties, largest party (negated), person-minutes (negated). Bigger is better. */
type Score = [number, number, number, number];

function better(a: Score, b: Score): boolean {
  for (const [i, x] of a.entries()) {
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** An index the loop above has already filled. */
function at<T>(xs: ArrayLike<T>, i: number): T {
  const value = xs[i];
  if (value === undefined) throw new Error(`read ${i} before it was written`);
  return value;
}

function searchExact(group: Want[], rules: Rules): Want[][] {
  const n = group.length;
  const full = (1 << n) - 1;
  const fits = new Uint8Array(1 << n);
  const cost = new Float64Array(1 << n);
  const size = new Uint8Array(1 << n);
  for (let mask = 1; mask <= full; mask++) {
    const members = group.filter((_, i) => mask & (1 << i));
    size[mask] = members.length;
    if (!rules.fits(members)) continue;
    fits[mask] = 1;
    cost[mask] = runMinutes(members.reduce((s, m) => s + m.strength, 0)) * members.length;
  }

  const best: Score[] = [[0, 0, 0, 0]];
  const choice = new Int32Array(full + 1);
  for (let mask = 1; mask <= full; mask++) {
    const low = mask & -mask;
    const rest = mask ^ low;
    // Leave the lowest want out, then try every party that seats it.
    let top = at(best, rest);
    let pick = 0;
    for (let sub = rest; ; sub = (sub - 1) & rest) {
      const chosen = sub | low;
      if (at(fits, chosen)) {
        const [placed, parties, largest, minutes] = at(best, mask ^ chosen);
        const score: Score = [
          placed + at(size, chosen),
          parties + 1,
          Math.min(largest, -at(size, chosen)),
          minutes - at(cost, chosen),
        ];
        if (better(score, top)) {
          top = score;
          pick = chosen;
        }
      }
      if (sub === 0) break;
    }
    best[mask] = top;
    choice[mask] = pick;
  }

  const parties: Want[][] = [];
  for (let mask = full; mask !== 0;) {
    const chosen = at(choice, mask);
    if (chosen === 0) {
      mask ^= mask & -mask;
      continue;
    }
    parties.push(group.filter((_, i) => chosen & (1 << i)));
    mask ^= chosen;
  }
  return parties;
}

/**
 * Strongest first, each opening a party filled by greedyFill, then whoever is left joins the
 * smallest party with room. Not the best grouping, only a valid one.
 */
function searchGreedy(group: Want[], rules: Rules): Want[][] {
  const left = [...group].sort((a, b) => b.strength - a.strength);
  const parties: Want[][] = [];
  const stranded: Want[] = [];
  while (left.length > 0) {
    const lead = left.shift()!;
    const formed = greedyFill(lead, left, rules);
    if (formed === null) {
      stranded.push(lead);
      continue;
    }
    for (const m of formed.slice(1)) left.splice(left.indexOf(m), 1);
    parties.push(formed);
  }
  for (const w of stranded) {
    const room = parties
      .filter((p) => rules.fits([...p, w]))
      .sort((a, b) => a.length - b.length)[0];
    if (room) room.push(w);
  }
  return parties;
}

/**
 * A party around `lead`: the weakest candidate that would finish it, or failing that the strongest
 * who may join, until it clears or nobody more may join.
 */
function greedyFill(lead: Want, candidates: Want[], rules: Rules): Want[] | null {
  const members = [lead];
  while (!rules.fits(members)) {
    const open = candidates.filter((c) => !members.includes(c) && rules.mayJoin([...members, c]));
    if (open.length === 0) return null;
    const finishing = open.filter((c) => rules.fits([...members, c]));
    const pool = finishing.length > 0 ? finishing : open;
    const pick = pool.reduce((a, b) =>
      finishing.length > 0 ? (b.strength < a.strength ? b : a) : b.strength > a.strength ? b : a,
    );
    members.push(pick);
  }
  return members;
}
