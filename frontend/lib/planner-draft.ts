// The Party Planner's inputs, as kept between visits.
//
// In the browser until plans are stored server-side (docs/party-planner-plan.md, phase 2). Read
// defensively: an old tab or a hand-edited value must come back as a smaller draft, never as a
// throw or as a strength outside the slider.

import { SOLO, type Want } from "@/lib/party-planner";

export const DRAFT_KEY = "party-planner-draft";

/** You, in a draft. Anybody else is a People-page person id. */
export const YOU = "you";

export type DraftCharacter = { name: string; personId: string };

/** A boss row on a character. Blank boss or mode is a row still being filled in. */
export type DraftWant = {
  character: string;
  bossKey: string;
  difficulty: string;
  strength: number;
  maxParty: number | null;
};

export type Draft = {
  maxMinutes: number;
  characters: DraftCharacter[];
  wants: DraftWant[];
};

/** Characters you know of, grouped by who plays them. */
export type RosterGroup = { personId: string; label: string; names: string[] };

/** A typed IGN that is nobody's on record. Its own player, so no rule mistakes it for an alt. */
export function standaloneId(name: string): string {
  return `ign:${name.toLowerCase()}`;
}

/** The longest IGN the game allows. */
export const MAX_IGN = 12;

/**
 * What a typed name adds: a known character with its owner, else a standalone one, else nothing.
 *
 * Names match case-blind, as the game's do, and a known one comes back spelled as it is on record.
 * Null for a blank, an over-long name, or a character the draft already has.
 */
export function resolveCharacter(
  typed: string,
  roster: RosterGroup[],
  draft: Draft,
): DraftCharacter | null {
  const name = typed.trim();
  if (name === "" || name.length > MAX_IGN || /\s/.test(name)) return null;
  const key = name.toLowerCase();
  if (draft.characters.some((c) => c.name.toLowerCase() === key)) return null;
  for (const group of roster) {
    const known = group.names.find((n) => n.toLowerCase() === key);
    if (known) return { name: known, personId: group.personId };
  }
  return { name, personId: standaloneId(name) };
}

export const MIN_MINUTES = 10;
export const MAX_MINUTES = 30;

export const EMPTY_DRAFT: Draft = { maxMinutes: MAX_MINUTES, characters: [], wants: [] };

export function readDraft(text: string | null): Draft {
  if (!text) return EMPTY_DRAFT;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return EMPTY_DRAFT;
  }
  if (typeof raw !== "object" || raw === null) return EMPTY_DRAFT;
  const r = raw as Record<string, unknown>;
  const minutes = Number(r.maxMinutes);
  const characters = (Array.isArray(r.characters) ? r.characters : []).filter(
    (c): c is DraftCharacter => typeof c?.name === "string" && typeof c?.personId === "string",
  );
  const names = new Set(characters.map((c) => c.name));
  const wants = (Array.isArray(r.wants) ? r.wants : []).filter(
    (w): w is DraftWant =>
      typeof w?.character === "string" &&
      names.has(w.character) &&
      typeof w.bossKey === "string" &&
      typeof w.difficulty === "string" &&
      Number.isInteger(w.strength) &&
      w.strength >= 0 &&
      w.strength <= SOLO &&
      (w.maxParty === null || (Number.isInteger(w.maxParty) && w.maxParty >= 1)),
  );
  return {
    maxMinutes:
      Number.isInteger(minutes) && minutes >= MIN_MINUTES && minutes <= MAX_MINUTES
        ? minutes
        : MAX_MINUTES,
    characters,
    wants,
  };
}

/** The rows that are filled in, as the planner takes them. */
export function draftWants(draft: Draft): Want[] {
  const owner = new Map(draft.characters.map((c) => [c.name, c.personId]));
  return draft.wants
    .filter((w) => w.bossKey !== "" && w.difficulty !== "")
    .map((w) => ({
      id: `${w.character}\n${w.bossKey}`,
      character: w.character,
      personId: owner.get(w.character)!,
      world: null,
      bossKey: w.bossKey,
      difficulty: w.difficulty,
      strength: w.strength,
      maxParty: w.maxParty,
    }));
}
