// What a drop picker may offer, and what it posts.
//
// Held apart from the component because four screens carry the picker now, and the two filters here
// are the rules that can produce a wrong pool: offering an Interactive-only drop in a Heroic world,
// or a vestige coupon on Chaos Kalos, is offering to log one that cannot happen.

import { dropExistsIn, isPerMember } from "./world";
import type { BossDrop } from "@/types/drop";
import type { AddLootBody } from "@/types/loot";
import type { WorldType } from "./world";

/** "Type it instead". Not a drop key, so nothing in the catalog can collide with it. */
export const OTHER = "__other__";

/**
 * Whether this drop falls at this mode.
 *
 * A boss's table is per boss, not per (boss, difficulty), so most rows have nothing to answer with
 * and stay on the list: an option nobody picks costs nothing, and one that is missing is a drop
 * that cannot be entered at all. See the note above `tables` in catalog/drops.yaml.
 *
 * The counted rows are the exception, and they are the ones people get wrong. `pieces` carries a
 * figure for exactly the (world, difficulty) pairs the drop falls at, since build.py drops a zero
 * rather than seeding it, so Kalos's coupons are on Extreme and not on Chaos. Only that world's
 * own map is read: a world with no figures at all is the catalog saying nothing about the pair,
 * which is not a claim that nothing drops.
 */
export function dropsAtDifficulty(
  drop: BossDrop,
  difficulty: string | null | undefined,
  world: WorldType,
): boolean {
  if (!difficulty) return true;
  const counted = drop.pieces?.[world];
  if (!counted || Object.keys(counted).length === 0) return true;
  return (counted[difficulty] ?? 0) > 0;
}

/**
 * Only what drops where this party plays, at the mode it runs. See dropExistsIn and
 * dropsAtDifficulty.
 *
 * No difficulty narrows nothing, for a caller with no config to read one off.
 */
export function pickableDrops(
  table: BossDrop[] | undefined,
  world: WorldType,
  difficulty?: string | null,
): BossDrop[] {
  return (table ?? []).filter(
    (drop) => dropExistsIn(drop.worlds, world) && dropsAtDifficulty(drop, difficulty, world),
  );
}

/**
 * What the count box opens with, as text, or empty when nothing is known.
 *
 * Empty rather than a guess in three cases: a drop the tables carry no amount for, a difficulty that
 * drops none of it, and a caller with no difficulty to read (a config nobody has set a mode on). A
 * filled-in number is one people accept without looking, so it comes only from the catalog's own
 * figure for that exact pair.
 */
export function defaultQuantity(
  drop: BossDrop | undefined,
  difficulty: string | null | undefined,
  world: string,
): string {
  if (!drop || !difficulty) return "";
  // Both keys, and typed as a number rather than passed straight to String(): the world was added
  // above the difficulty, and String() on the map that used to be a count returns "[object Object]"
  // without the typechecker saying a word.
  const pieces: number | undefined = drop.pieces?.[world]?.[difficulty];
  return pieces === undefined ? "" : String(pieces);
}

/** The name, and whether everyone walks away with one. */
export function dropOptionLabel(drop: BossDrop, world: WorldType): string {
  return isPerMember(drop.perMember, world) ? `${drop.name} (one each)` : drop.name;
}

/** The most of one drop a row may hold, matching the column's own CHECK. */
export const MAX_QUANTITY = 1_000_000;

/**
 * How many fell, as typed: blank is one, and anything unreadable is null.
 *
 * Null rather than a fallback of 1, because "18O" quietly logged as a single coupon is the wrong
 * count wearing the right drop's name. A count of 180 off one Extreme Kalos is the case this is for.
 */
export function parseQuantity(input: string): number | null {
  const cleaned = input.trim().replace(/[,_\s]/g, "");
  if (cleaned === "") return 1;
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value >= 1 && value <= MAX_QUANTITY ? value : null;
}

/**
 * What the picker would post, or null while it is not a complete answer.
 *
 * The submit button reads its enabled state off this same function, so the two cannot disagree.
 * They were separate expressions before, which is how a button ends up enabled on a rule the body
 * does not hold to and posts a drop with no name.
 *
 * No boss is not an answer either. It used to be sent as null, from a caller that always had one
 * anyway; the Drop Log asks for the boss, and a drop filed under none is one nothing can find or
 * count. The field stays nullable because the API accepts a drop that names no boss.
 *
 * `droppedOn` is deliberately absent: the server stamps today. A caller that let you add to a week
 * it is not currently in would have to send one, and none may.
 */
export function addDropBody(
  bossKey: string,
  dropKey: string,
  customName: string,
  quantity = "",
): AddLootBody | null {
  if (bossKey === "") return null;
  const count = parseQuantity(quantity);
  if (count === null) return null;
  if (dropKey === OTHER) {
    const typed = customName.trim();
    return typed === "" ? null : { bossKey, dropKey: null, customName: typed, quantity: count };
  }
  return dropKey === "" ? null : { bossKey, dropKey, customName: null, quantity: count };
}
