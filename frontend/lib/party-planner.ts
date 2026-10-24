// Proposing permanent parties for a list of characters who each want a boss.
//
// Strength is one rough number per (character, boss, difficulty): how much of the boss the
// character takes off alone in a thirty-minute run, in sixtieths. 60 is a solo clear, and up to 120
// is a character that solos faster (120 in fifteen minutes). Sixtieths because 60 divides by every
// party size up to six, so the slider ticks at 1/3 and 1/6 of the boss are whole numbers. Strengths
// add: a party at 120 is assumed to take fifteen minutes. That is the whole model, and it is only
// as good as the sliders, which is why the plan goes to every member for review before anything is
// made.
//
// A character who can solo runs its own party, never one with another soloer, and keeps its whole
// loot over seating a weaker character. It carries only somebody no other party could take, and
// only when its party size allows: "Solo" (1) never carries, any other size will. A passenger who
// could ride with several soloers rides with the slowest, where its damage saves the most time.
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

/** The top of the slider: a solo in fifteen minutes. */
export const MAX_STRENGTH = 2 * SOLO;

/** The most a seat may take, matching lib/shares.ts. */
const MAX_SHARES = 99;

/** Jobs a party never has two of: two Lynns never share a party. */
export const ONE_PER_PARTY = ["Lynn"];

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
  const marks = [0, ...strengthTicks(maxParty), SOLO, (SOLO * 3) / 2, MAX_STRENGTH];
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
  /** 0 to MAX_STRENGTH. SOLO and up clears alone. */
  strength: number;
  /** The biggest party this character will join, or null for any the boss admits. */
  maxParty: number | null;
  /** The character's job, where known. See ONE_PER_PARTY. */
  job?: string | null;
};

export type PlanSettings = {
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

export function planParties(wants: Want[], settings: PlanSettings = {}): Plan {
  const seen = new Set<string>();
  for (const w of wants) {
    const key = `${w.character}\n${w.world}\n${w.bossKey}`;
    if (seen.has(key)) throw new Error(`${w.character} wants ${w.bossKey} twice`);
    seen.add(key);
    if (!(w.strength >= 0 && w.strength <= MAX_STRENGTH)) {
      throw new Error(`strength out of range: ${w.id}`);
    }
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
    // Nobody else could take them, so soloers who will carry do. Party size is the soloer's say:
    // "Solo" (1) never carries. Not timed, since a carry is no slower than the solo.
    const carried = carry(
      rest.filter((w) => !placed.has(w.id)),
      solos,
      rules,
    );
    for (const w of rest) {
      if (placed.has(w.id) || carried.has(w.id)) continue;
      // A soloer who could have carried them counts too: they lost the room, not the strength.
      const couldRide = solos.some(([host]) => host !== undefined && rules.mayJoin([host, w]));
      plan.unplaced.push({
        wantId: w.id,
        reason: couldRide || canJoinAny(w, rest, rules) ? "crowded" : "alone",
      });
    }
    for (const members of [...solos, ...found]) plan.parties.push(party(members));
  }
  return plan;
}

/** A run's length in minutes, unrounded, so two close runs still compare. */
function runTime(members: Want[]): number {
  return (
    (SOLO * DEFAULT_MINUTES) /
    Math.max(
      1,
      members.reduce((sum, m) => sum + m.strength, 0),
    )
  );
}

/** Most seated, then least strength carried (the soloers' loot), then the least time, then spread. */
function betterCarry(
  a: { count: number; carried: number; minutes: number; largest: number },
  b: { count: number; carried: number; minutes: number; largest: number },
): boolean {
  if (a.count !== b.count) return a.count > b.count;
  if (a.carried !== b.carried) return a.carried < b.carried;
  if (Math.abs(a.minutes - b.minutes) > 1e-9) return a.minutes < b.minutes;
  return a.largest < b.largest;
}

/** Above this many passengers, carries are handed out greedily. 9 passengers over 6 soloers is ~40M. */
const CARRY_EXACT_LIMIT = 8;

/**
 * Seats passengers with soloers, as many as can be, and returns their ids. Hosts are added to.
 *
 * Every assignment is tried, not first come first served: a passenger who could ride with anyone
 * must not take the one soloer another passenger can use, such as a passenger whose only other
 * soloer is the same player.
 * Ties go to the plan carrying the least strength, so a soloer keeps the most loot (a passenger
 * doing nothing costs it none), then to the fastest runs overall, which puts a passenger with the
 * slowest soloer, then to the one whose biggest party is smallest. Above the limit, the passengers
 * with the fewest hosts choose first, the weakest of them first, each to the slowest soloer.
 */
function carry(passengers: Want[], hosts: Want[][], rules: Rules): Set<string> {
  const hostsOf = (w: Want) => hosts.filter((h) => rules.mayJoin([...h, w])).length;
  const order = [...passengers].sort((a, b) => hostsOf(a) - hostsOf(b) || a.strength - b.strength);
  if (order.length > CARRY_EXACT_LIMIT) {
    const seated = new Set<string>();
    for (const w of order) {
      const host = hosts
        .filter((h) => rules.mayJoin([...h, w]))
        .sort((a, b) => runTime(b) - runTime(a) || a.length - b.length)[0];
      if (host) {
        host.push(w);
        seated.add(w.id);
      }
    }
    return seated;
  }

  type Best = {
    count: number;
    carried: number;
    minutes: number;
    largest: number;
    seats: [Want, Want[]][];
  };
  let best: Best | null = null;
  const seats: [Want, Want[]][] = [];
  const search = (i: number) => {
    if (best !== null && seats.length + (order.length - i) < best.count) return;
    if (i === order.length) {
      const score: Omit<Best, "seats"> = {
        count: seats.length,
        carried: seats.reduce((sum, [w]) => sum + w.strength, 0),
        minutes: hosts.reduce((sum, h) => sum + runTime(h), 0),
        largest: Math.max(0, ...hosts.map((h) => h.length)),
      };
      if (best === null || betterCarry(score, best)) best = { ...score, seats: [...seats] };
      return;
    }
    const w = order[i]!;
    for (const host of hosts) {
      if (!rules.mayJoin([...host, w])) continue;
      host.push(w);
      seats.push([w, host]);
      search(i + 1);
      seats.pop();
      host.pop();
    }
    search(i + 1);
  };
  search(0);

  const chosen = (best as Best | null)?.seats ?? [];
  for (const [w, host] of chosen) host.push(w);
  return new Set(chosen.map(([w]) => w.id));
}

type Rules = {
  /** Whether these may sit together, however long they would take. */
  mayJoin: (members: Want[]) => boolean;
  /** Whether these may sit together and clear inside the thirty minutes. */
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
    for (const job of ONE_PER_PARTY) {
      if (members.filter((m) => m.job === job).length > 1) return false;
    }
    for (const a of people) for (const b of people) if (apart.has(`${a}\n${b}`)) return false;
    return true;
  };
  return {
    mayJoin,
    fits(members) {
      if (members.length < 2 || !mayJoin(members)) return false;
      return members.reduce((sum, m) => sum + m.strength, 0) >= SOLO;
    },
  };
}

function party(members: Want[]): PlannedParty {
  const [first] = members;
  if (!first) throw new Error("a party with nobody in it");
  const strength = members.reduce((sum, m) => sum + m.strength, 0);
  const common = members.reduce((g, m) => gcd(g, m.strength), 0);
  const counts = members.map((m) => m.strength / common);
  // A soloer above SOLO can leave a count past what a seat holds: scaled down, nobody to nothing.
  const top = Math.max(...counts);
  const shares =
    top <= MAX_SHARES
      ? counts
      : counts.map((c) => (c === 0 ? 0 : Math.max(1, Math.round((c * MAX_SHARES) / top))));
  return {
    world: first.world,
    bossKey: first.bossKey,
    difficulty: first.difficulty,
    seats: members.map((m, i) => ({
      wantId: m.id,
      character: m.character,
      personId: m.personId,
      shares: shares[i] ?? 0,
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
